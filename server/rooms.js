/* =======================================
   SALAS Y PARTIDAS ONLINE

   El servidor es el árbitro: elige los destinos, recibe solo el RUMBO
   de cada jugador, calcula él mismo si acierta y reparte los puntos.

   Ciclo de una sala:
     lobby ──(anfitrión pulsa Empezar)──▶ playing ──(última ronda)──▶ finished
                                                     └─(se van todos)──▶ abandoned

   Cada ronda:
     1. "round"        → todos reciben el mismo destino a la vez
     2. "shot"         ← cada jugador manda su rumbo (o se le acaba el tiempo)
     3. "roundResult"  → cuando han disparado todos, resultados de la ronda
     4. "next"         ← cuando todos pulsan "Siguiente" (o pasa el tiempo), vuelta al 1
   ======================================= */
const game = require("./game");
const store = require("./db");

const CFG = {
  ROUNDS: 10,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  SHOT_TIMEOUT_MS: 15_000, // tiempo para apuntar en cada ronda
  NEXT_TIMEOUT_MS: 30_000, // tiempo viendo resultados antes de pasar solo
  RECONNECT_GRACE_MS: 120_000, // si se va todo el mundo, la sala aguanta esto
  LOBBY_IDLE_MS: 30 * 60_000,
  MAX_ROOMS: 500,
  MAX_ROOMS_PER_IP: 3, // salas abiertas a la vez creadas desde una misma IP
};

const rooms = new Map(); // code -> room

// Sin I, O, 0 ni 1 para que no se confundan al dictar el código
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

/* ---------- Envío de mensajes ---------- */
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const p of room.players.values()) send(p.ws, msg);
}

// A los demás nunca se les manda el playerId de nadie, solo su alias (pub)
const pubOf = (room, id) => (room.players.get(id) || {}).pub;

function publicRoom(room) {
  return {
    code: room.code,
    region: room.region,
    ranked: room.ranked,
    hostId: pubOf(room, room.hostId),
    status: room.status,
    round: room.round,
    totalRounds: CFG.ROUNDS,
    minPlayers: CFG.MIN_PLAYERS,
    maxPlayers: CFG.MAX_PLAYERS,
    players: [...room.players.values()].map((p) => ({
      id: p.pub,
      name: p.name,
      ready: !!p.location,
      connected: !!p.ws,
      score: p.score,
      hits: p.hits,
      rank: p.rank,
    })),
  };
}

function sendRoom(room) {
  broadcast(room, { t: "room", room: publicRoom(room) });
}

function standings(room) {
  const list = [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: p.score, hits: p.hits }))
    .sort((a, b) => b.score - a.score || b.hits - a.hits);
  // Empates comparten puesto
  list.forEach((p, i) => {
    p.position =
      i > 0 && p.score === list[i - 1].score && p.hits === list[i - 1].hits
        ? list[i - 1].position
        : i + 1;
  });
  return list;
}

// La clasificación tal y como se envía a los móviles (con alias en vez de playerId)
function publicStandings(room, list) {
  return list.map(({ id, ...rest }) => ({ id: pubOf(room, id), ...rest }));
}

function clearTimers(room) {
  clearTimeout(room.timer);
  room.timer = null;
}

/* ---------- Ciclo de vida de la sala ---------- */
// ranked = true: cuenta para la liga y se guarda en la BD.
// ranked = false (Local): se cuentan los puntos para anunciar al ganador, pero no se guarda nada.
function createRoom(player, region, ranked) {
  if (!game.REGIONS.includes(region)) throw userError("bad_region", "Región no válida.");
  if (rooms.size >= CFG.MAX_ROOMS) throw userError("full", "El servidor está lleno, prueba en un rato.");
  let fromIp = 0;
  for (const r of rooms.values()) if (r.ownerIp === player.ip && r.status !== "finished") fromIp++;
  if (fromIp >= CFG.MAX_ROOMS_PER_IP)
    throw userError("too_many_rooms", "Ya tienes varias salas abiertas. Cierra alguna antes de crear otra.");

  const room = {
    code: newCode(),
    region,
    ranked: !!ranked,
    hostId: player.id,
    ownerIp: player.ip,
    status: "lobby",
    players: new Map(),
    round: 0,
    targets: [],
    matchId: null,
    targetStats: [], // por ronda: { kind, key, name, shots, hits } (solo se guarda en Ranked)
    shots: new Map(), // playerId -> resultado de la ronda actual
    nextVotes: new Set(),
    timer: null,
    deadline: null,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  addPlayer(room, player);
  return room;
}

function addPlayer(room, player) {
  const existing = room.players.get(player.id);
  if (existing) {
    // Reconexión: mismo móvil que vuelve a la sala. Tiene que traer la misma clave.
    if (existing.secretHash !== player.secretHash)
      throw userError("in_use", "Ese jugador ya está en la sala desde otro móvil.");
    if (existing.ws && existing.ws !== player.ws) {
      send(existing.ws, { t: "error", code: "replaced", message: "Has entrado desde otra pantalla." });
      existing.ws.roomCode = null;
    }
    existing.ws = player.ws;
    existing.left = false;
    if (room.status === "lobby") existing.name = player.name;
    player.ws.roomCode = room.code;
    return existing;
  }
  if (room.status !== "lobby") throw userError("started", "Esa partida ya ha empezado.");
  if (room.players.size >= CFG.MAX_PLAYERS) throw userError("room_full", "La sala está llena.");

  const p = {
    id: player.id, pub: player.pub, secretHash: player.secretHash, termsVersion: player.termsVersion,
    name: player.name, ws: player.ws, location: null, score: 0, hits: 0,
    rank: room.ranked ? store.rankOf(player.id).label : null, // se enseña en la sala de espera
  };
  room.players.set(p.id, p);
  player.ws.roomCode = room.code;
  return p;
}

function joinRoom(player, code, ranked) {
  const room = rooms.get(String(code || "").toUpperCase().trim());
  if (!room) throw userError("not_found", "No existe ninguna sala con ese código.");
  // Un código de Ranked no vale desde Local, ni al revés (salvo para volver a tu propia sala)
  if (typeof ranked === "boolean" && ranked !== room.ranked && !room.players.has(player.id)) {
    throw userError(
      "wrong_mode",
      room.ranked ? "Ese código es de una sala Ranked. Entra desde Ranked." : "Ese código es de una sala Local. Entra desde Local.",
    );
  }
  addPlayer(room, player);
  room.lastActivity = Date.now();
  sendRoom(room);
  resendCurrentState(room, player.id);
  return room;
}

// Al reconectarse a mitad de partida, el móvil necesita saber en qué punto está
function resendCurrentState(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  if (room.status === "finished" && room.finishedMsg) {
    if (room.lastResult) send(p.ws, room.lastResult);
    send(p.ws, room.finishedMsg);
    return;
  }
  if (room.status !== "playing") return;
  if (room.phase === "aiming") {
    send(p.ws, roundMessage(room));
    const mine = room.shots.get(playerId);
    if (mine) send(p.ws, { t: "shotAck", round: room.round, result: mine });
  } else if (room.phase === "results") {
    send(p.ws, room.lastResult);
  }
}

function leaveRoom(ws) {
  const room = rooms.get(ws.roomCode);
  ws.roomCode = null;
  if (!room) return;
  const p = room.players.get(ws.playerId);
  if (!p) return;

  if (room.status === "lobby") {
    room.players.delete(p.id);
    if (room.players.size === 0) return destroyRoom(room);
    if (room.hostId === p.id) room.hostId = room.players.keys().next().value;
    sendRoom(room);
  } else if (room.status === "playing") {
    // Durante la partida se queda en la tabla (con lo que llevaba), pero ya no se le espera
    p.ws = null;
    p.left = true;
    sendRoom(room);
    if (activePlayers(room).length === 0) return abandon(room);
    checkRoundProgress(room);
  }
}

function onDisconnect(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = room.players.get(ws.playerId);
  if (!p || p.ws !== ws) return;
  p.ws = null;

  if (room.status === "lobby") {
    // En la sala de espera, una desconexión es como salir (puede volver a entrar con el código)
    leaveRoom(ws);
    return;
  }
  sendRoom(room);
  if ([...room.players.values()].every((x) => !x.ws)) {
    room.abandonTimer = setTimeout(() => {
      if ([...room.players.values()].every((x) => !x.ws)) abandon(room);
    }, CFG.RECONNECT_GRACE_MS);
  } else {
    checkRoundProgress(room);
  }
}

function setLocation(ws, location) {
  const room = rooms.get(ws.roomCode);
  if (!room) throw userError("no_room", "No estás en ninguna sala.");
  if (room.status !== "lobby") return;
  if (!validLocation(location)) throw userError("bad_location", "Ubicación no válida.");
  room.players.get(ws.playerId).location = [location[0], location[1]];
  room.lastActivity = Date.now();
  sendRoom(room);
}

function startMatch(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) throw userError("no_room", "No estás en ninguna sala.");
  if (room.hostId !== ws.playerId) throw userError("not_host", "Solo el anfitrión puede empezar.");
  if (room.status !== "lobby") return;

  const players = [...room.players.values()];
  if (players.length < CFG.MIN_PLAYERS)
    throw userError("few_players", `Hacen falta al menos ${CFG.MIN_PLAYERS} jugadores.`);
  if (players.some((p) => !p.location))
    throw userError("not_ready", "Falta que todos elijan su ubicación.");

  room.targets = game.pickTargets(room.region, players.map((p) => p.location), CFG.ROUNDS);
  if (room.targets.length < CFG.ROUNDS)
    throw userError("no_targets", "No hay destinos suficientes en esa región.");

  // Solo las Ranked se guardan (y es aquí cuando el jugador entra en la BD)
  room.matchId = room.ranked
    ? store.createMatch(room.code, room.region, CFG.ROUNDS,
      players.map((p) => ({ id: p.id, name: p.name, secretHash: p.secretHash, termsVersion: p.termsVersion })))
    : null;
  room.status = "playing";
  room.round = 0;
  sendRoom(room);
  startRound(room);
}

function roundMessage(room) {
  return {
    t: "round",
    round: room.round,
    total: CFG.ROUNDS,
    target: room.targets[room.round - 1],
    deadline: room.deadline,
  };
}

function startRound(room) {
  clearTimers(room);
  room.round += 1;
  room.phase = "aiming";
  room.shots = new Map();
  room.nextVotes = new Set();
  room.deadline = Date.now() + CFG.SHOT_TIMEOUT_MS;
  room.lastActivity = Date.now();
  broadcast(room, roundMessage(room));
  room.timer = setTimeout(() => closeRound(room), CFG.SHOT_TIMEOUT_MS + 500);
}

function handleShot(ws, round, heading) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.status !== "playing" || room.phase !== "aiming") return;
  if (round !== room.round) return; // disparo de una ronda vieja
  if (room.shots.has(ws.playerId)) return; // solo un disparo por ronda
  if (typeof heading !== "number" || !Number.isFinite(heading) || heading < 0 || heading > 360)
    throw userError("bad_heading", "Rumbo no válido.");

  const p = room.players.get(ws.playerId);
  const target = room.targets[room.round - 1];
  const result = game.judge(target, p.location, heading);

  room.shots.set(p.id, result);
  p.score += result.points;
  if (result.isHit) p.hits += 1;

  send(ws, { t: "shotAck", round: room.round, result });
  broadcast(room, { t: "progress", round: room.round, answered: [...room.shots.keys()].map((id) => pubOf(room, id)) });
  checkRoundProgress(room);
}

function activePlayers(room) {
  return [...room.players.values()].filter((p) => p.ws && !p.left);
}

// Avanza en cuanto todos los conectados han hecho lo que tocaba
function checkRoundProgress(room) {
  if (room.status !== "playing") return;
  const active = activePlayers(room);
  if (room.phase === "aiming" && active.every((p) => room.shots.has(p.id))) closeRound(room);
  else if (room.phase === "results" && active.every((p) => room.nextVotes.has(p.id))) advance(room);
}

function closeRound(room) {
  if (room.phase !== "aiming") return;
  clearTimers(room);
  room.phase = "results";

  // Quien no disparó a tiempo se lleva 0 puntos en esta ronda
  for (const p of room.players.values()) {
    if (!room.shots.has(p.id)) {
      room.shots.set(p.id, { isHit: false, points: 0, minDistanceKm: null, timedOut: true });
    }
  }

  // Estadística del destino: cuántos dispararon y cuántos acertaron (sin ubicaciones)
  const target = room.targets[room.round - 1];
  const fired = [...room.shots.values()].filter((r) => !r.timedOut);
  room.targetStats.push({
    kind: target.kind,
    key: target.id || target.name,
    name: target.name,
    shots: fired.length,
    hits: fired.filter((r) => r.isHit).length,
  });

  const last = room.round >= CFG.ROUNDS;
  room.lastResult = {
    t: "roundResult",
    round: room.round,
    total: CFG.ROUNDS,
    last,
    target: room.targets[room.round - 1],
    results: [...room.players.values()].map((p) => ({ id: p.pub, name: p.name, ...room.shots.get(p.id) })),
    standings: publicStandings(room, standings(room)),
    nextDeadline: last ? null : Date.now() + CFG.NEXT_TIMEOUT_MS,
  };
  broadcast(room, room.lastResult);

  if (last) finish(room);
  else room.timer = setTimeout(() => advance(room), CFG.NEXT_TIMEOUT_MS);
}

function voteNext(ws, round) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.phase !== "results" || round !== room.round) return;
  room.nextVotes.add(ws.playerId);
  checkRoundProgress(room);
}

function advance(room) {
  if (room.status !== "playing" || room.phase !== "results") return;
  startRound(room);
}

function finish(room) {
  clearTimers(room);
  room.status = "finished";
  room.phase = null;
  const final = standings(room);
  // Se guarda el resultado y se aplican MMR y LP. Cada jugador recibe su LP y su rango
  // antes y después (el MMR va también, pero el juego no lo enseña: es el número oculto)
  // En Local no se guarda nada: solo se anuncia la clasificación
  const res = room.ranked ? store.finishMatch(room.matchId, final, room.targetStats) : {};
  for (const s of final) {
    const r = res[s.id];
    if (!r) continue;
    Object.assign(s, {
      lpDelta: r.lpDelta,
      rankBefore: r.before,
      rankAfter: r.after,
      rankChange: r.change,
      placement: r.ladderAfter === null ? r.gamesPlayed : null,
      eloBefore: r.mmrBefore,
      eloAfter: r.mmrAfter,
      eloDelta: r.mmrAfter - r.mmrBefore,
    });
  }
  // Se guarda para quien vuelva a conectarse justo después (p. ej. un iPhone que estaba bloqueado)
  room.finishedMsg = { t: "finished", matchId: room.matchId, standings: publicStandings(room, final) };
  broadcast(room, room.finishedMsg);
  // La sala se borra al rato; los resultados ya están en la base de datos
  room.timer = setTimeout(() => destroyRoom(room), 60_000);
}

function abandon(room) {
  // Una Ranked que no se termina no cuenta para nadie y no se guarda
  if (room.matchId && room.status === "playing") store.discardMatch(room.matchId);
  destroyRoom(room);
}

function destroyRoom(room) {
  clearTimers(room);
  clearTimeout(room.abandonTimer);
  for (const p of room.players.values()) if (p.ws) p.ws.roomCode = null;
  rooms.delete(room.code);
}

// Limpieza de salas olvidadas
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === "lobby" && now - room.lastActivity > CFG.LOBBY_IDLE_MS) {
      broadcast(room, { t: "error", code: "expired", message: "La sala ha caducado." });
      destroyRoom(room);
    }
  }
}, 60_000).unref();

/* ---------- Utilidades ---------- */
function validLocation(loc) {
  return (
    Array.isArray(loc) &&
    loc.length >= 2 &&
    Number.isFinite(loc[0]) && Number.isFinite(loc[1]) &&
    loc[0] >= -180 && loc[0] <= 180 &&
    loc[1] >= -90 && loc[1] <= 90
  );
}

function userError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.isUserError = true;
  return e;
}

// Hook de reconexión: si un jugador vuelve antes de que caduque la sala
function cancelAbandon(room) {
  clearTimeout(room.abandonTimer);
  room.abandonTimer = null;
}

module.exports = {
  CFG,
  rooms,
  createRoom: (player, region, ranked) => {
    const room = createRoom(player, region, ranked);
    sendRoom(room);
    return room;
  },
  joinRoom: (player, code, ranked) => {
    const room = joinRoom(player, code, ranked);
    cancelAbandon(room);
    return room;
  },
  leaveRoom,
  onDisconnect,
  setLocation,
  startMatch,
  handleShot,
  voteNext,
  stats: () => ({
    rooms: rooms.size,
    playing: [...rooms.values()].filter((r) => r.status === "playing").length,
  }),
};
