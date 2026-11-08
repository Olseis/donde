/* =======================================
   MODO ONLINE

   El móvil se conecta al servidor por WebSocket (una conexión que
   se queda abierta, así el servidor puede avisar a todos a la vez).

   Reparto del trabajo:
   - Servidor: crea la sala, elige los 10 destinos, recibe tu RUMBO,
     calcula si aciertas y cuántos puntos te llevas, y lo guarda en la BD.
   - Móvil: brújula, mapa y pantallas. El rayo del mapa se dibuja aquí,
     pero los puntos que cuentan son los que dice el servidor.

   Este archivo se carga DESPUÉS de app.js y usa sus variables
   globales (state, UI, showScreen, dictionary...).
   ======================================= */

// Dónde está el servidor.
// - Si el juego se abre desde tu propio servidor (https://217.72.207.119), usa ese mismo.
// - Desde la app (Android/iOS) o en local, usa SERVER_URL.
const SERVER_URL = window.DONDE_SERVER_URL || "https://217.72.207.119";
const ONLINE_BASE =
  location.protocol === "https:" && location.hostname !== "localhost"
    ? location.origin
    : SERVER_URL;
const ONLINE_WS = ONLINE_BASE.replace(/^http/, "ws") + "/ws";

/* ---------- Parte legal ----------
   LEGAL_VERSION es la fecha de los textos de www/legal.html. Si cambian en algo importante,
   se sube la fecha aquí y allí, y el juego vuelve a pedir la aceptación antes de jugar online. */
const LEGAL_VERSION = "2026-11-08";
const LEGAL_KEY = "dondeQueda_legalAccepted";

const PLAYER_ID_KEY = "dondeQueda_playerId";
const SECRET_KEY = "dondeQueda_secret"; // clave que da el servidor: solo la tiene este móvil
const ONLINE_NAME_KEY = "dondeQueda_onlineName";
const NAME_REGEX = /^[\p{L}\p{N} _.\-]{1,20}$/u;

// Identificador anónimo de este móvil: así el servidor te reconoce aunque cambies de nombre
function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

function getSecret() {
  return localStorage.getItem(SECRET_KEY) || undefined;
}

// Si el servidor no acepta nuestra clave (otra persona se quedó con este identificador),
// este móvil empieza una cuenta nueva
function resetIdentity() {
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(SECRET_KEY);
}

// Mi alias en las salas: el servidor no enseña a nadie el playerId de los demás
function isMe(publicId) {
  return !!Online.publicId && publicId === Online.publicId;
}

const Online = {
  ws: null,
  name: "",
  room: null, // última info de la sala que mandó el servidor
  round: null, // ronda en curso { round, total, target, deadline }
  pending: null, // qué estamos esperando tras pulsar un botón: 'create' | 'join'
  wantConnected: false,
  publicId: null,
  identityReset: false,
  retries: 0,
  timerInterval: null,
  lastResult: null,
  lastHeard: 0, // cuándo llegó el último mensaje del servidor
  heartbeat: null,
  wakeLock: null,

  /* ---------- Conexión ---------- */
  connect() {
    this.wantConnected = true;
    if (this.ws && this.ws.readyState <= 1) return this.ready;

    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(ONLINE_WS);
      this.ws = ws;
      const failTimer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 8000);

      ws.onopen = () => {
        clearTimeout(failTimer);
        this.retries = 0;
        this.lastHeard = Date.now();
        this.startHeartbeat();
        this.send({ t: "hello", playerId: getPlayerId(), secret: getSecret(), name: this.name, terms: acceptedTerms() });
      };
      ws.onmessage = (ev) => {
        this.lastHeard = Date.now();
        const msg = JSON.parse(ev.data);
        if (msg.t === "pong") return;
        if (msg.t === "welcome") {
          this.publicId = msg.publicId;
          if (msg.secret) localStorage.setItem(SECRET_KEY, msg.secret);
          resolve();
          // Si se cortó la conexión estando en una sala, volvemos a entrar
          if (this.room) this.send({ t: "join", code: this.room.code, ranked: this.room.ranked });
        }
        if (msg.t === "error" && msg.code === "bad_secret" && !this.identityReset) {
          this.identityReset = true;
          resetIdentity();
          this.send({ t: "hello", playerId: getPlayerId(), name: this.name });
          return;
        }
        this.handle(msg);
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(failTimer);
        reject(new Error("closed"));
        if (this.wantConnected) this.scheduleReconnect();
      };
    });
    return this.ready;
  },

  scheduleReconnect() {
    setOnlineStatus("Conexión perdida. Reconectando...");
    const wait = Math.min(1000 * 2 ** this.retries++, 10000);
    setTimeout(() => {
      if (this.wantConnected) this.connect().then(() => setOnlineStatus("")).catch(() => {});
    }, wait);
  },

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  },

  /* ---------- Conexiones "zombis" (iPhone) ----------
     Cuando el iPhone bloquea la pantalla o la app pasa a segundo plano, iOS congela
     la conexión sin cerrarla: el móvil no se entera de que está muerta y se queda
     esperando (mismo país, contador en 0). Para detectarlo:
     - cada 5 s se manda un ping; si en 12 s no llega nada del servidor, se reconecta
     - al volver a la app, si la conexión no responde enseguida, se reconecta
     Al reconectar, el servidor manda la ronda o el resultado en el que va la sala. */
  startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (!this.wantConnected) return this.stopHeartbeat();
      if (this.ws && this.ws.readyState === 1 && Date.now() - this.lastHeard > 12000) return this.forceReconnect();
      this.send({ t: "ping" });
    }, 5000);
  },

  stopHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  },

  // Tira la conexión actual (aunque parezca abierta) y abre otra
  forceReconnect() {
    if (!this.wantConnected) return;
    const old = this.ws;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try { old.close(); } catch {}
    }
    this.ws = null;
    setOnlineStatus("Reconectando...");
    this.connect().then(() => setOnlineStatus("")).catch(() => this.scheduleReconnect());
  },

  // Al volver a la app: un ping y, si no contesta en 2 s, conexión nueva
  checkAlive() {
    if (!this.wantConnected) return;
    if (!this.ws || this.ws.readyState > 1) return this.forceReconnect();
    const asked = Date.now();
    this.send({ t: "ping" });
    setTimeout(() => {
      if (this.wantConnected && this.lastHeard < asked) this.forceReconnect();
    }, 2000);
  },

  // Que la pantalla no se apague durante la partida (si el navegador lo permite)
  async keepAwake() {
    try {
      if (!this.wakeLock && navigator.wakeLock && document.visibilityState === "visible") {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => (this.wakeLock = null));
      }
    } catch {}
  },

  releaseAwake() {
    try { if (this.wakeLock) this.wakeLock.release(); } catch {}
    this.wakeLock = null;
  },

  disconnect() {
    this.wantConnected = false;
    this.stopHeartbeat();
    this.releaseAwake();
    this.send({ t: "leave" });
    this.room = null;
    this.round = null;
    this.pending = null;
    this.locationSent = false;
    this.lastResult = null;
    this.finalStandings = null;
    document.getElementById("result-screen").classList.remove("online-results");
    stopRoundTimer();
    if (this.ws) this.ws.close();
    this.ws = null;
  },

  /* ---------- Acciones del jugador ---------- */
  async createRoom(region) {
    this.pending = "create";
    await this.connect();
    // Local = sala por diversión; Ranked = cuenta para la liga
    this.send({ t: "create", region, ranked: state.gameMode === "ranked" });
  },

  async joinRoom(code) {
    this.pending = "join";
    await this.connect();
    this.send({ t: "join", code, ranked: state.gameMode === "ranked" });
  },

  // Salir de la sala sin cerrar la conexión (p. ej. "Volver" desde la ubicación)
  leaveRoom() {
    this.send({ t: "leave" });
    this.room = null;
    this.pending = null;
    this.locationSent = false;
  },

  sendLocation(location) {
    this.locationSent = true;
    this.send({ t: "location", location });
  },

  start() {
    this.send({ t: "start" });
  },

  shoot(heading) {
    if (this.round) this.send({ t: "shot", round: this.round.round, heading });
  },

  next() {
    if (this.lastResult) this.send({ t: "next", round: this.lastResult.round });
  },

  isHost() {
    return this.room && isMe(this.room.hostId);
  },

  /* ---------- Mensajes del servidor ---------- */
  handle(msg) {
    switch (msg.t) {
      case "room":
        return this.onRoom(msg.room);
      case "round":
        return this.onRound(msg);
      case "shotAck":
        return onShotAck(msg);
      case "progress":
        return onProgress(msg);
      case "roundResult":
        return this.onRoundResult(msg);
      case "finished":
        return this.onFinished(msg);
      case "error":
        return this.onError(msg);
    }
  },

  async onRoom(room) {
    const first = !this.room || this.room.code !== room.code;
    this.room = room;
    renderWaitingRoom();

    // Tras una reconexión en la sala de espera, el servidor ya no tiene tu ubicación: se reenvía
    const me = room.players.find((p) => isMe(p.id));
    if (room.status === "lobby" && me && !me.ready && this.locationSent && state.userLocation) {
      this.sendLocation(state.userLocation);
    }

    // Acabamos de crear o entrar en la sala: toca elegir ubicación
    if (first && this.pending) {
      this.pending = null;
      state.continent = room.region;
      state.mode = room.region === "España" ? "spain" : "world";
      setOnlineStatus("");
      if (state.mode === "spain") prepareLocationScreen();
      else await loadAssetsAndPrepareLoc();
    }
  },

  async onRound(msg) {
    this.round = msg;
    this.lastResult = null;
    this.keepAwake();
    if (state.mode === "world" && !state.countriesGeoJSON) await loadCountries();
    showOnlineRound(msg);
  },

  onRoundResult(msg) {
    this.lastResult = msg;
    showOnlineRoundResult(msg);
  },

  onFinished(msg) {
    stopRoundTimer();
    this.round = null;
    this.finalStandings = msg.standings;
    if (!this.lastResult || !this.lastResult.last) showOnlineFinal();
    // Si está viendo los resultados de la última ronda, el botón le lleva a la clasificación
  },

  onError(msg) {
    const roomGone = msg.code === "not_found" && !this.pending && this.room;
    if (msg.code === "replaced" || msg.code === "expired" || roomGone) {
      this.room = null;
      alert(msg.message);
      returnToMenu();
      return;
    }
    if (this.pending) {
      this.pending = null;
      showScreen("online");
    }
    setOnlineStatus(msg.message);
    alert(msg.message);
  },
};

/* =======================================
   PANTALLAS
   ======================================= */
const OUI = {
  status: document.getElementById("online-status"),
  btnCreate: document.getElementById("btn-online-create"),
  inputCode: document.getElementById("input-room-code"),
  btnJoin: document.getElementById("btn-online-join"),
  btnBack: document.getElementById("btn-online-back"),

  roomCode: document.getElementById("room-code"),
  roomRegion: document.getElementById("room-region"),
  roomPlayers: document.getElementById("room-players"),
  roomHint: document.getElementById("room-hint"),
  btnStart: document.getElementById("btn-room-start"),
  btnShare: document.getElementById("btn-room-share"),
  btnLeave: document.getElementById("btn-room-leave"),

  roundList: document.getElementById("online-round-list"),
};

function setOnlineStatus(text) {
  if (OUI.status) OUI.status.textContent = text || "";
}

// Pantalla de sala (Local o Ranked): crear sala o unirse con código
function openOnlineLobby(name) {
  const title = document.getElementById("online-title");
  if (title) title.textContent = state.gameMode === "ranked" ? "Ranked" : "Local";
  const hint = document.getElementById("online-mode-hint");
  if (hint) {
    hint.textContent = state.gameMode === "ranked"
      ? "Cuenta para tu liga: ganas o pierdes LP según tu puesto."
      : "Por diversión: se anuncia al ganador, pero no se guarda nada.";
  }
  Online.name = name;
  localStorage.setItem(ONLINE_NAME_KEY, name);
  state.players = [{ name, score: 0, hits: 0 }];
  OUI.inputCode.value = "";
  setOnlineStatus("Conectando...");
  showScreen("online");
  Online.connect()
    .then(() => setOnlineStatus(""))
    .catch(() => setOnlineStatus("No se pudo conectar con el servidor. Revisa tu conexión."));
}

OUI.btnCreate.addEventListener("click", () => {
  // Primero se elige la región; al pulsarla se crea la sala (ver app.js)
  goToRegionSelect();
});

OUI.btnJoin.addEventListener("click", () => {
  const code = OUI.inputCode.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    setOnlineStatus("El código tiene 4 letras o números.");
    return;
  }
  setOnlineStatus("Entrando...");
  Online.joinRoom(code).catch(() => setOnlineStatus("No se pudo conectar con el servidor."));
});

OUI.inputCode.addEventListener("input", () => {
  OUI.inputCode.value = OUI.inputCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});

OUI.btnBack.addEventListener("click", () => {
  Online.disconnect();
  showScreen("names");
});

// Sala de espera: código, jugadores y botón de empezar (solo el anfitrión)
function renderWaitingRoom() {
  const room = Online.room;
  if (!room) return;
  OUI.roomCode.textContent = room.code;
  OUI.roomRegion.textContent = REGION_NAMES[room.region] || room.region;

  OUI.roomPlayers.innerHTML = "";
  room.players.forEach((p) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent =
      p.name + (p.id === room.hostId ? " 👑" : "") + (isMe(p.id) ? " (tú)" : "") +
      (room.ranked && p.rank ? ` · ${shortRank(p.rank)}` : "");
    const status = document.createElement("span");
    status.textContent = !p.connected ? "desconectado" : p.ready ? "✓ listo" : "eligiendo ubicación…";
    status.className = "room-player-status";
    li.append(name, status);
    if (isMe(p.id)) li.classList.add("highlight-gold");
    OUI.roomPlayers.appendChild(li);
  });

  const enough = room.players.length >= room.minPlayers;
  const allReady = room.players.every((p) => p.ready);
  OUI.btnStart.style.display = Online.isHost() ? "" : "none";
  OUI.btnStart.disabled = !(enough && allReady);
  OUI.roomHint.textContent = !enough
    ? `Comparte el código. Hacen falta al menos ${room.minPlayers} jugadores.`
    : !allReady
      ? "Esperando a que todos elijan su ubicación…"
      : Online.isHost()
        ? "¡Todo listo! Pulsa Empezar."
        : "Esperando a que el anfitrión empiece…";
}

OUI.btnStart.addEventListener("click", () => Online.start());

OUI.btnShare.addEventListener("click", async () => {
  const text = `¡Juega conmigo a ¿Dónde queda...? Código de sala: ${Online.room.code}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(Online.room.code);
      OUI.btnShare.textContent = "¡Copiado!";
      setTimeout(() => (OUI.btnShare.textContent = "Compartir código"), 1500);
    }
  } catch {}
});

OUI.btnLeave.addEventListener("click", async () => {
  if (await customConfirm("¿Seguro que quieres salir de la sala?")) returnToMenu();
});

// Al volver a la app o recuperar la red, comprobar que la conexión sigue viva
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  Online.checkAlive();
  if (Online.round) Online.keepAwake();
});
window.addEventListener("pageshow", () => Online.checkAlive());
window.addEventListener("online", () => Online.checkAlive());

/* ---------- Rondas ---------- */
async function loadCountries() {
  const res = await fetch("data/countries.geo.json");
  state.countriesGeoJSON = DondeShot.withMicrostates(turf, await res.json(), microstates);
}

function showOnlineRound(msg) {
  const { target } = msg;
  if (target.kind === "city") {
    state.targetData = { name: target.name, lat: target.lat, lng: target.lng };
    state.targetCenterLatLng = L.latLng(target.lat, target.lng);
  } else {
    state.targetData = state.countriesGeoJSON.features.find((f) => f.id === target.id);
    const c = turf.centroid(state.targetData).geometry.coordinates;
    state.targetCenterLatLng = L.latLng(c[1], c[0]);
  }
  state.turn = msg.round;

  document.getElementById("result-screen").classList.add("online-results");
  UI.targetName.textContent = target.name;
  UI.currentPlayerDisplay.textContent = Online.name;
  UI.currentPlayerDisplay.style.display = "block";
  UI.resultErrorDetails.style.display = "none";
  UI.turnPointsDisplay.style.display = "none";
  OUI.roundList.style.display = "none";
  document.getElementById("btn-confirm").disabled = false;
  showScreen("game");
  startRoundTimer(msg.deadline);
}

function startRoundTimer(deadline) {
  stopRoundTimer();
  Online.resyncAt = null;
  const tick = () => {
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    // Se acabó el tiempo hace 4 s y el servidor no ha mandado el resultado: la conexión está colgada
    if (Date.now() - deadline > 4000 && Online.round && !Online.lastResult && !Online.resyncAt) {
      Online.resyncAt = Date.now();
      Online.forceReconnect();
    }
    const me = myStanding();
    UI.roundInfo.textContent = `Ronda ${Online.round.round} de ${Online.round.total} · ${me ? me.score : 0} pts · ⏱ ${secs} s`;
  };
  tick();
  Online.timerInterval = setInterval(tick, 500);
}

function stopRoundTimer() {
  clearInterval(Online.timerInterval);
  Online.timerInterval = null;
}

function myStanding() {
  const list = (Online.lastResult && Online.lastResult.standings) || (Online.room && Online.room.players) || [];
  return list.find((p) => isMe(p.id));
}

// Lo llama app.js al pulsar "Comprobar" en modo online
function onlineShot(heading) {
  stopRoundTimer();
  Online.shoot(heading);
  UI.turnPointsDisplay.textContent = "Comprobando…";
  UI.turnPointsDisplay.style.display = "block";
  UI.btnRestart.textContent = "Esperando a los demás…";
  UI.btnRestart.disabled = true;
}

// El servidor confirma tu disparo con los puntos que de verdad cuentan
function onShotAck(msg) {
  const r = msg.result;
  UI.turnPointsDisplay.textContent = pointsText(r, r.points);
  UI.resultTitle.textContent = r.isHit ? "ACERTASTE ✅" : "FALLASTE ❌";
  UI.resultTitle.style.color = r.isHit ? "#4ade80" : "#f87171";
}

function onProgress(msg) {
  if (!Online.room || UI.btnRestart.disabled === false) return;
  const total = Online.room.players.filter((p) => p.connected).length;
  UI.btnRestart.textContent = `Esperando a los demás… (${msg.answered.length}/${total})`;
}

function showOnlineRoundResult(msg) {
  stopRoundTimer();
  const mine = msg.results.find((r) => isMe(r.id));

  // Si se acabó el tiempo sin disparar, pasamos directamente a la pantalla de resultado
  if (!document.getElementById("result-screen").classList.contains("active")) {
    showScreen("result");
    UI.resultTitle.textContent = "SE ACABÓ EL TIEMPO ⏱";
    UI.resultTitle.style.color = "#f87171";
    UI.resultErrorDetails.style.display = "none";
    const map = document.getElementById("map-wrapper");
    if (map) map.style.display = "none";
  }
  if (mine) {
    UI.turnPointsDisplay.textContent = mine.timedOut ? "+0 puntos" : pointsText(mine, mine.points);
    UI.turnPointsDisplay.style.display = "block";
  }

  // Tabla con lo que ha hecho cada uno en esta ronda y el total
  OUI.roundList.innerHTML = "";
  msg.standings.forEach((s) => {
    const r = msg.results.find((x) => x.id === s.id) || {};
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = `${s.position}. ${s.name}`;
    const right = document.createElement("span");
    right.textContent = `${r.timedOut ? "⏱" : r.isHit ? "✅" : "❌"} +${r.points || 0} · ${s.score}`;
    li.append(left, right);
    if (isMe(s.id)) li.classList.add("highlight-gold");
    OUI.roundList.appendChild(li);
  });
  OUI.roundList.style.display = "";

  UI.btnRestart.disabled = false;
  UI.btnRestart.textContent = msg.last ? "Ver clasificación" : "Siguiente ronda";
}

// Botón "Siguiente" de la pantalla de resultado en modo online
function onlineNext() {
  const map = document.getElementById("map-wrapper");
  if (map) map.style.display = "";
  if (Online.lastResult && Online.lastResult.last) {
    showOnlineFinal();
    return;
  }
  Online.next();
  UI.btnRestart.disabled = true;
  UI.btnRestart.textContent = "Esperando a los demás…";
}

function showOnlineFinal() {
  const standings = Online.finalStandings || (Online.lastResult && Online.lastResult.standings) || [];
  const winners = standings.filter((s) => s.position === 1);
  const me = standings.find((s) => isMe(s.id));
  state.players = me ? [{ name: me.name, score: me.score, hits: me.hits }] : state.players;

  if (UI.leaderboardWinnerTitle) {
    UI.leaderboardWinnerTitle.textContent =
      winners.length > 1
        ? "¡Empate!"
        : winners[0] && isMe(winners[0].id)
          ? "¡Has ganado! 🏆"
          : `¡Ha ganado ${winners[0] ? winners[0].name : "?"}!`;
    UI.leaderboardWinnerTitle.style.display = "block";
  }
  renderMatchStandings(standings);
  renderLeaderboard(true);
  showScreen("leaderboard");
  Online.disconnect();
}

// "Oro II · 45 LP" → "Oro II" (en la sala de espera no hace falta el LP)
function shortRank(label) {
  return String(label).split(" · ")[0];
}

const RANK_CHANGE_TEXT = {
  promoted: (r) => `⬆️ ¡Subes a ${shortRank(r)}!`,
  demoted: (r) => `⬇️ Bajas a ${shortRank(r)}`,
  placed: (r) => `🎖️ Clasificación terminada: ${shortRank(r)}`,
};

function renderMatchStandings(standings) {
  const list = document.getElementById("match-standings");
  if (!list) return;
  list.innerHTML = "";
  standings.forEach((s) => {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = `${s.position}. ${s.name}`;
    const right = document.createElement("span");
    // Puntos de la partida y cómo cambia su rango: +18 LP, o la clasificación 3/5
    let rank = "";
    if (s.placement) rank = ` · Clasif. ${s.placement}/5`;
    else if (s.rankChange === "placed") rank = ` · ${shortRank(s.rankAfter)}`;
    else if (s.lpDelta !== undefined) rank = ` · ${s.lpDelta >= 0 ? "+" : ""}${s.lpDelta} LP`;
    right.textContent = `${s.score} pts${rank}`;
    li.append(left, right);
    if (isMe(s.id)) li.classList.add("highlight-gold");
    list.appendChild(li);
  });

  // Tu rango después de la partida, y si has subido o bajado
  const me = standings.find((s) => isMe(s.id));
  const box = document.getElementById("match-rank");
  if (box) {
    box.textContent = "";
    if (me && me.rankAfter) {
      const line = document.createElement("div");
      line.className = "match-rank-now";
      line.textContent = me.rankAfter;
      box.appendChild(line);
      const change = RANK_CHANGE_TEXT[me.rankChange];
      if (change) {
        const note = document.createElement("div");
        note.className = `match-rank-change ${me.rankChange}`;
        note.textContent = change(me.rankAfter);
        box.appendChild(note);
      }
    }
  }
  document.getElementById("match-standings-box").style.display = standings.length ? "" : "none";
}

/* ---------- Ranking online: la tabla de TU división ---------- */
async function renderOnlineRanking(listEl) {
  const title = document.getElementById("online-table-title");
  listEl.innerHTML = "";
  const addLine = (text) => {
    const li = document.createElement("li");
    li.textContent = text;
    listEl.appendChild(li);
  };
  addLine("Cargando…");
  try {
    const res = await fetch(`${ONLINE_BASE}/api/online/ranking?limit=50&playerId=${encodeURIComponent(getPlayerId())}`);
    const { me, table, ranking } = await res.json();
    listEl.innerHTML = "";
    if (title) title.textContent = table ? `Ranked · ${table.name}` : "Ranked";

    if (!me || me.tier === "unranked") {
      const played = me && me.placement ? me.placement.played : 0;
      addLine(`Juega ${5 - played} partida${5 - played === 1 ? "" : "s"} online más para tener rango (${played}/5).`);
      return;
    }
    ranking.forEach((r) => {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.textContent = `${r.position}. ${r.name}${r.you ? " (tú)" : ""}`;
      const right = document.createElement("span");
      right.textContent = `${r.lp} LP · ${r.wins} 🏆`;
      li.append(left, right); // textContent: un nombre nunca se interpreta como HTML
      if (r.you) li.classList.add("highlight-gold");
      listEl.appendChild(li);
    });
  } catch {
    listEl.innerHTML = "";
    addLine("No se pudo cargar el ranking online.");
  }
}

/* =======================================
   PARTE LEGAL
   - Antes de la primera partida en sala: 14 años o más + condiciones y privacidad
   - Textos (legal.html) en una ventana dentro del juego
   - "Descargar mis datos" y "Borrar mis datos" (RGPD arts. 15, 17 y 20)
   ======================================= */
function acceptedTerms() {
  try { return localStorage.getItem(LEGAL_KEY) === LEGAL_VERSION ? LEGAL_VERSION : undefined; } catch { return undefined; }
}

// Devuelve true si ya estaban aceptadas o las acepta ahora; false si cancela
function ensureLegalAccepted() {
  if (acceptedTerms()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const overlay = document.getElementById("legal-consent");
    const check = document.getElementById("legal-accept");
    const ok = document.getElementById("btn-legal-ok");
    const cancel = document.getElementById("btn-legal-cancel");
    check.checked = false;
    ok.disabled = true;
    overlay.style.display = "flex";
    const onCheck = () => (ok.disabled = !check.checked);
    const done = (accepted) => {
      check.removeEventListener("change", onCheck);
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      overlay.style.display = "none";
      resolve(accepted);
    };
    const onOk = () => {
      if (!check.checked) return;
      try { localStorage.setItem(LEGAL_KEY, LEGAL_VERSION); } catch {}
      done(true);
    };
    const onCancel = () => done(false);
    check.addEventListener("change", onCheck);
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
  });
}

// Se descarga legal.html y se pinta dentro de la ventana con srcdoc. Así no le afecta la cabecera
// X-Frame-Options del servidor (que impide meter páginas en un iframe) y funciona igual en la web y en la app.
const LEGAL_URL_REMOTE = "https://217.72.207.119/legal.html";
async function openLegal(section) {
  const viewer = document.getElementById("legal-viewer");
  const frame = document.getElementById("legal-frame");
  const id = section || "aviso";
  let html;
  try {
    const res = await fetch("legal.html", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    html = await res.text();
  } catch {
    // Sin el archivo (p. ej. una app antigua): se abre la página del servidor en el navegador
    window.open(`${LEGAL_URL_REMOTE}#${id}`, "_blank");
    return;
  }
  // Las rutas relativas (fuentes, logo) tienen que apuntar a esta web
  const base = new URL(".", location.href).href;
  html = html.replace(/(href|src)="(?!https?:|mailto:|#)([^"]+)"/g, (m, attr, url) => `${attr}="${base}${url}"`);
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      doc.body.classList.add("embedded");
      // Enlaces internos (#privacidad...): desplazarse dentro de la ventana
      doc.addEventListener("click", (ev) => {
        const a = ev.target.closest('a[href^="#"]');
        if (!a) return;
        ev.preventDefault();
        doc.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView();
      });
      // Enlaces externos: en una pestaña nueva / el navegador del móvil
      doc.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
      doc.getElementById(id)?.scrollIntoView();
    } catch {}
  };
  frame.srcdoc = html;
  viewer.style.display = "flex";
}
document.getElementById("btn-legal-close").addEventListener("click", () => {
  document.getElementById("legal-viewer").style.display = "none";
});
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-legal]");
  if (!el) return;
  ev.preventDefault();
  openLegal(el.dataset.legal);
});

async function myDataRequest(path) {
  const res = await fetch(`${ONLINE_BASE}/api/online/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: getPlayerId(), secret: getSecret() }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
  return res.json();
}

document.getElementById("btn-my-data").addEventListener("click", async () => {
  const box = document.getElementById("my-data");
  const pre = document.getElementById("my-data-json");
  pre.textContent = "Cargando…";
  box.style.display = "flex";
  try {
    const data = await myDataRequest("me");
    // Lo que hay solo en este móvil también es tuyo: se enseña (sin la clave)
    data.this_device = {
      player_id: getPlayerId(),
      name: localStorage.getItem(ONLINE_NAME_KEY),
      terms_accepted: localStorage.getItem(LEGAL_KEY),
      secret: getSecret() ? "(guardada en este móvil, no se muestra)" : null,
    };
    pre.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    pre.textContent = "No se han podido descargar tus datos: " + e.message;
  }
});
document.getElementById("btn-my-data-close").addEventListener("click", () => {
  document.getElementById("my-data").style.display = "none";
});
document.getElementById("btn-my-data-copy").addEventListener("click", async () => {
  const text = document.getElementById("my-data-json").textContent;
  try {
    if (navigator.share) await navigator.share({ title: "Mis datos de ¿Dónde queda...?", text });
    else await navigator.clipboard.writeText(text);
  } catch {}
});

document.getElementById("btn-delete-data").addEventListener("click", async () => {
  const sure = await customConfirm(
    "Se borrarán para siempre tu cuenta, tu rango y tus partidas. Este móvil empezará con una cuenta nueva. ¿Seguro?",
  );
  if (!sure) return;
  try {
    await myDataRequest("delete");
    resetIdentity();
    try { localStorage.removeItem(ONLINE_NAME_KEY); } catch {}
    Online.disconnect();
    setOnlineStatus("Tus datos se han borrado.");
  } catch (e) {
    setOnlineStatus("No se han podido borrar: " + e.message + ". Escríbenos (Privacidad).");
  }
});
