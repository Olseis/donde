/* =======================================
   MODAL DE CONFIRMACIÓN PERSONALIZADO
   ======================================= */
function customConfirm(message) {
  return new Promise((resolve) => {
      const overlay = document.getElementById('custom-confirm');
      document.getElementById('confirm-message').textContent = message;
      overlay.style.display = 'flex';

      const btnOk = document.getElementById('btn-confirm-ok');
      const btnCancel = document.getElementById('btn-confirm-cancel');

      const cleanup = () => {
          btnOk.removeEventListener('click', onOk);
          btnCancel.removeEventListener('click', onCancel);
          overlay.style.display = 'none';
      };

      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };

      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
  });
}

/* =======================================
   CONFIGURACIÓN
   ======================================= */
const ROUNDS_PER_GAME = 10;
const PROGRESS_KEY = "dondeQueda_progress";
const LOCATION_KEY = "dondeQueda_savedLocation";

const REGION_NAMES = {
  Todos: "Todo el mundo",
  América: "América",
  Europa: "Europa",
  Asia: "Asia",
  África: "África",
  Oceanía: "Oceanía",
  España: "España", 
};

const LEVEL_TITLES = [
  "Turista", "Mochilero", "Viajero", "Explorador", "Navegante",
  "Cartógrafo", "Aventurero", "Trotamundos", "Leyenda",
];

const MARKER_STYLE = {
  radius: 5, fillColor: "#3b82f6", color: "#ffffff", weight: 2, fillOpacity: 1,
};

const COUNTRIES_STYLE = {
  fillColor: "#1e293b", weight: 1, color: "#334155", fillOpacity: 0.5,
};

/* =======================================
   ESTADO GLOBAL DEL JUEGO
   ======================================= */
const state = {
  gameMode: 'ranked',
  continent: "Todos",
  mode: 'world',
  userLocation: null,
  userCountryId: null,
  tempLocation: null,
  currentHeading: 0,
  targetData: null,
  targetCenterLatLng: null,
  countriesGeoJSON: null,
  lastHeading: null,
  totalRotation: 0, 
  single: { round: 1, score: 0, hits: 0 },
  players: [
    { name: "", score: 0, hits: 0 },
    { name: "", score: 0, hits: 0 },
  ],
  currentPlayerIdx: 0,
  turn: 1,
  selectionMap: null,
  selectionMarker: null,
  resultMap: null,
  resultMapLayers: null,
};

/* =======================================
   REFERENCIAS AL DOM
   ======================================= */
const screens = {
  start: document.getElementById("start-screen"),
  region: document.getElementById("region-screen"),
  credits: document.getElementById("credits-screen"),
  names: document.getElementById("names-screen"),
  leaderboard: document.getElementById("leaderboard-screen"),
  progress: document.getElementById("progress-screen"),
  location: document.getElementById("location-screen"),
  game: document.getElementById("game-screen"),
  result: document.getElementById("result-screen"),
  midgame: document.getElementById("midgame-screen"),
  summary: document.getElementById("summary-screen"),
  online: document.getElementById("online-screen"),
  waiting: document.getElementById("waiting-screen"),
};

const UI = {
  btnModeClassic: document.getElementById("btn-mode-classic"),
  btnModeRanked: document.getElementById("btn-mode-ranked"),
  btnModeLocal: document.getElementById("btn-mode-local"),
  btnModeOnline: document.getElementById("btn-mode-online"),
  btnShowProgress: document.getElementById("btn-show-progress"),
  btnShowScores: document.getElementById("btn-show-scores"),
  btnCredits: document.getElementById("btn-credits-float"),
  btnCreditsBack: document.getElementById("btn-back-credits"),

  regionSubtitle: document.getElementById("region-subtitle"),
  menuContainer: document.getElementById("menu-container"),
  startLoading: document.getElementById("start-loading-text"),
  btnBackRegion: document.getElementById("btn-back-region"),

  namesTitle: document.getElementById("names-title"),
  inputP1: document.getElementById("input-p1"),
  inputP2: document.getElementById("input-p2"),
  btnConfirmNames: document.getElementById("btn-confirm-names"),
  btnBackNames: document.getElementById("btn-back-names"),

  leaderboardWinnerTitle: document.getElementById("leaderboard-winner-title"),
  leaderboardGeneralTitle: document.getElementById("leaderboard-general-title"),
  leaderboardColLocal: document.getElementById("col-local"),
  leaderboardColOnline: document.getElementById("col-online"),
  leaderboardLocal: document.getElementById("leaderboard-list-local"),
  leaderboardOnline: document.getElementById("leaderboard-list-online"),
  endgameActions: document.getElementById("endgame-actions"),
  standardActions: document.getElementById("standard-actions"),
  btnBackLeaderboard: document.getElementById("btn-back-leaderboard"),
  btnClearScores: document.getElementById("btn-clear-scores"),
  btnVersusRestart: document.getElementById("btn-versus-restart"),
  btnVersusNew: document.getElementById("btn-versus-new"),
  btnVersusExit: document.getElementById("btn-versus-exit"),

  progressLevelName: document.getElementById("progress-level-name"),
  progressLevelFill: document.getElementById("progress-level-fill"),
  progressLevelText: document.getElementById("progress-level-text"),
  statGames: document.getElementById("stat-games"),
  statHits: document.getElementById("stat-hits"),
  statAccuracy: document.getElementById("stat-accuracy"),
  recordsList: document.getElementById("records-list"),
  btnBackProgress: document.getElementById("btn-back-progress"),
  btnResetProgress: document.getElementById("btn-reset-progress"),

  btnConfirmLoc: document.getElementById("btn-confirm-location"),
  btnBackLoc: document.getElementById("btn-back-loc"),
  locLoading: document.getElementById("location-loading-text"),

  currentPlayerDisplay: document.getElementById("current-player-display"),
  roundInfo: document.getElementById("round-info"),
  compassDial: document.getElementById("compass-dial"), 
  debugInfo: document.getElementById("debug-info"),
  targetName: document.getElementById("target-name"),

  resultTitle: document.getElementById("result-title"),
  turnPointsDisplay: document.getElementById("turn-points-display"),
  resultErrorDetails: document.getElementById("result-error-details"),
  btnRestart: document.getElementById("btn-restart"),
  btnChangeRegion: document.getElementById("btn-change-region"),
  
  midgameTitle: document.getElementById("midgame-title"),
  midgameDiff: document.getElementById("midgame-diff"),
  midgameList: document.getElementById("midgame-list"),
  btnMidgameContinue: document.getElementById("btn-midgame-continue"),
  btnMidgameEnd: document.getElementById("btn-midgame-end"),

  summaryRegion: document.getElementById("summary-region"),
  summaryScore: document.getElementById("summary-score"),
  summaryHits: document.getElementById("summary-hits"),
  summaryRecord: document.getElementById("summary-record"),
  summaryLevelName: document.getElementById("summary-level-name"),
  summaryXpGain: document.getElementById("summary-xp-gain"),
  summaryLevelFill: document.getElementById("summary-level-fill"),
  summaryLevelText: document.getElementById("summary-level-text"),
  summaryLevelUp: document.getElementById("summary-level-up"),
  btnSummaryAgain: document.getElementById("btn-summary-again"),
  btnSummaryRegion: document.getElementById("btn-summary-region"),
  btnSummaryMenu: document.getElementById("btn-summary-menu")
};

/* =======================================
   UBICACIÓN GUARDADA
   ======================================= */
function loadSavedLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_KEY));
    if (Array.isArray(saved) && saved.length === 2 && typeof saved[0] === "number" && typeof saved[1] === "number") {
      return saved;
    }
  } catch {}
  return null;
}

function saveLocation(loc) {
  if (!loc) return;
  localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
}

/* =======================================
   PROGRESO Y NIVELES
   ======================================= */
function emptyProgress() {
  return { xp: 0, gamesPlayed: 0, totalHits: 0, bestByRegion: {} };
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (saved) return { ...emptyProgress(), ...saved };
  } catch {}
  return emptyProgress();
}

function saveProgress(progress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

function xpForLevel(level) {
  return 250 * level * (level - 1);
}

function getLevelInfo(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    xpInLevel: xp - base,
    xpNeeded: next - base,
    progress: (xp - base) / (next - base),
  };
}

function renderLevelCard(nameEl, fillEl, textEl, info) {
  if(nameEl) nameEl.textContent = `Nivel ${info.level} · ${info.title}`;
  if(fillEl) fillEl.style.width = `${Math.round(info.progress * 100)}%`;
  if(textEl) textEl.textContent = `${info.xpInLevel} / ${info.xpNeeded} XP para el nivel ${info.level + 1}`;
}

function updateRegionBests() {
  const progress = loadProgress();
  document.querySelectorAll(".btn-menu").forEach((btn) => {
    let span = btn.querySelector(".region-best");
    if (!span) {
      span = document.createElement("span");
      span.className = "region-best";
      btn.appendChild(span);
    }
    const best = progress.bestByRegion[btn.dataset.region];
    span.textContent = (state.gameMode === 'ranked') && best ? `Récord: ${best.score}` : "";
    span.style.display = span.textContent ? "" : "none";
  });
}

function renderProgressScreen() {
  const progress = loadProgress();
  renderLevelCard(UI.progressLevelName, UI.progressLevelFill, UI.progressLevelText, getLevelInfo(progress.xp));

  if(UI.statGames) UI.statGames.textContent = progress.gamesPlayed;
  if(UI.statHits) UI.statHits.textContent = progress.totalHits;
  const totalRounds = progress.gamesPlayed * ROUNDS_PER_GAME;
  if(UI.statAccuracy) UI.statAccuracy.textContent = totalRounds ? `${Math.round((progress.totalHits / totalRounds) * 100)}%` : "0%";

  if(UI.recordsList) {
    UI.recordsList.innerHTML = "";
    Object.entries(REGION_NAMES).forEach(([key, name]) => {
      const best = progress.bestByRegion[key];
      const li = document.createElement("li");
      li.innerHTML = best
        ? `<span>${name}</span><span><b>${best.score}</b> pts · ${best.hits}/${ROUNDS_PER_GAME}</span>`
        : `<span>${name}</span><span class="record-empty">—</span>`;
      UI.recordsList.appendChild(li);
    });
  }
}

function animateLevelBar(fillEl, fromProgress, toProgress) {
  if(!fillEl) return;
  fillEl.style.transition = "none";
  fillEl.style.width = `${Math.round(fromProgress * 100)}%`;
  void fillEl.offsetWidth; 
  fillEl.style.transition = "";
  setTimeout(() => { fillEl.style.width = `${Math.round(toProgress * 100)}%`; }, 150);
}

function finishSingleGame() {
  const progress = loadProgress();
  const before = getLevelInfo(progress.xp);
  const { score, hits } = state.single;
  const region = state.continent;
  const prevBest = progress.bestByRegion[region];
  const isRecord = !prevBest || score > prevBest.score;

  progress.xp += score;
  progress.gamesPlayed++;
  progress.totalHits += hits;
  if (isRecord) {
    progress.bestByRegion[region] = { score, hits, date: new Date().toISOString() };
  }
  saveProgress(progress);

  const after = getLevelInfo(progress.xp);

  if(UI.summaryRegion) UI.summaryRegion.textContent = REGION_NAMES[region];
  if(UI.summaryScore) UI.summaryScore.textContent = score;
  if(UI.summaryHits) UI.summaryHits.textContent = `${hits} de ${ROUNDS_PER_GAME} aciertos`;

  if(UI.summaryRecord) {
    if (!prevBest) {
      UI.summaryRecord.textContent = "🏅 ¡Primer récord en esta región!";
    } else if (isRecord) {
      UI.summaryRecord.textContent = `🏆 ¡Nuevo récord! (antes: ${prevBest.score})`;
    } else {
      UI.summaryRecord.textContent = `Tu récord aquí: ${prevBest.score}`;
    }
    UI.summaryRecord.classList.toggle("is-record", isRecord);
  }

  renderLevelCard(UI.summaryLevelName, UI.summaryLevelFill, UI.summaryLevelText, after);
  if(UI.summaryXpGain) UI.summaryXpGain.textContent = `+${score} XP`;

  const leveledUp = after.level > before.level;
  animateLevelBar(UI.summaryLevelFill, leveledUp ? 0 : before.progress, after.progress);

  if(UI.summaryLevelUp) {
    if (leveledUp) {
      UI.summaryLevelUp.textContent = `⬆️ ¡Subes a nivel ${after.level}: ${after.title}!`;
      UI.summaryLevelUp.style.display = "";
    } else {
      UI.summaryLevelUp.style.display = "none";
    }
  }

  showScreen("summary");
}

function resetSingleGame() {
  state.single = { round: 1, score: 0, hits: 0 };
}

/* =======================================
   NAVEGACIÓN Y PANTALLAS
   ======================================= */
function showScreen(screenName) {
  Object.values(screens).forEach((s) => {
      if(s) s.classList.remove("active");
  });
  if(screens[screenName]) screens[screenName].classList.add("active");

  if(UI.btnCredits) UI.btnCredits.style.display = screenName === "start" ? "flex" : "none";
}

function returnToMenu() {
  if (state.gameMode === 'online' && typeof Online !== "undefined") Online.disconnect();
  state.gameMode = null;
  showScreen("start");
}

const goToRegionSelect = () => {
  if(UI.menuContainer) UI.menuContainer.style.display = "grid";
  if(UI.startLoading) UI.startLoading.style.display = "none";
  if(UI.btnBackRegion) UI.btnBackRegion.style.display = "";
  
  if (state.gameMode === 'local') {
      if(UI.regionSubtitle) UI.regionSubtitle.textContent = `Local: ${state.players[0].name} vs ${state.players[1].name}`;
  } else if (state.gameMode === 'online') {
      if(UI.regionSubtitle) UI.regionSubtitle.textContent = `Online: ${state.players[0].name}`;
  } else if (state.gameMode === 'ranked') {
      if(UI.regionSubtitle) UI.regionSubtitle.textContent = `Ranked · ${ROUNDS_PER_GAME} rondas`;
  } else {
      if(UI.regionSubtitle) UI.regionSubtitle.textContent = `Clásico · Infinito`;
  }
  
  updateRegionBests();
  showScreen("region");
}

/* =======================================
   BOTÓN DE RETROCESO FÍSICO DE ANDROID (CAPACITOR)
   ======================================= */
if (typeof window.Capacitor !== "undefined" && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', async () => {
        const activeScreen = document.querySelector('.screen.active');
        if (!activeScreen) return;

        const activeId = activeScreen.id;

        // 1. Si estamos en el menú principal, se cierra la app nativamente
        if (activeId === 'start-screen') {
            window.Capacitor.Plugins.App.exitApp();
        } 
        // 2. Si estamos en mitad de una partida (salvo modo libre), pide confirmación con modal personalizado
        else if (['game-screen', 'result-screen', 'midgame-screen', 'location-screen'].includes(activeId)) {
            if (state.gameMode === 'classic' || activeId === 'location-screen') {
                returnToMenu();
            } else {
                const wantsToExit = await customConfirm("¿Seguro que quieres abandonar la partida? Se perderá el progreso actual.");
                if (wantsToExit) {
                    returnToMenu();
                }
            }
        } 
        // 3. En cualquier otra pantalla, vuelve directo al inicio
        else {
            returnToMenu();
        }
    });
}

// Botones Modo
if(UI.btnModeClassic) UI.btnModeClassic.addEventListener("click", () => { state.gameMode = 'classic'; goToRegionSelect(); });
if(UI.btnModeRanked) UI.btnModeRanked.addEventListener("click", () => { state.gameMode = 'ranked'; goToRegionSelect(); });
if(UI.btnModeLocal) UI.btnModeLocal.addEventListener("click", () => {
  state.gameMode = 'local';
  if(UI.namesTitle) UI.namesTitle.textContent = "Nombres de los Jugadores";
  if(UI.inputP2) UI.inputP2.style.display = "block";
  if(UI.inputP1) UI.inputP1.value = "";
  if(UI.inputP2) UI.inputP2.value = "";
  showScreen("names");
});
if(UI.btnModeOnline) UI.btnModeOnline.addEventListener("click", () => {
  state.gameMode = 'online';
  if(UI.namesTitle) UI.namesTitle.textContent = "Tu Nombre (Online)";
  if(UI.inputP2) UI.inputP2.style.display = "none";
  const savedName = localStorage.getItem("dondeQueda_onlineName") || "";
  if(UI.inputP1) UI.inputP1.value = savedName;
  showScreen("names");
});

if(UI.btnShowProgress) UI.btnShowProgress.addEventListener("click", () => { renderProgressScreen(); showScreen("progress"); });
if(UI.btnShowScores) UI.btnShowScores.addEventListener("click", () => { renderLeaderboard(false); showScreen("leaderboard"); });
if(UI.btnCredits) UI.btnCredits.addEventListener("click", () => showScreen("credits"));
if(UI.btnCreditsBack) UI.btnCreditsBack.addEventListener("click", returnToMenu);
if(UI.btnBackProgress) UI.btnBackProgress.addEventListener("click", returnToMenu);

if(UI.btnResetProgress) UI.btnResetProgress.addEventListener("click", async () => {
  const confirmed = await customConfirm("¿Seguro que quieres borrar tu progreso? Perderás tu nivel y tus récords.");
  if (confirmed) {
    localStorage.removeItem(PROGRESS_KEY);
    renderProgressScreen();
  }
});

if(UI.btnConfirmNames) UI.btnConfirmNames.addEventListener("click", () => {
  const p1 = (UI.inputP1 ? UI.inputP1.value.trim() : "") || "Jugador 1";
  if (state.gameMode === 'local') {
      const p2 = (UI.inputP2 ? UI.inputP2.value.trim() : "") || "Jugador 2";
      if (p1.toLowerCase() === p2.toLowerCase()) {
          alert("Los nombres no pueden ser iguales.");
          if(UI.inputP2) UI.inputP2.focus();
          return;
      }
      state.players = [{ name: p1, score: 0, hits: 0 }, { name: p2, score: 0, hits: 0 }];
  } else if (state.gameMode === 'online') {
      if (!/^[\p{L}\p{N} _.\-]{1,20}$/u.test(p1)) {
          alert("Escribe un nombre de 1 a 20 letras o números.");
          if(UI.inputP1) UI.inputP1.focus();
          return;
      }
      state.currentPlayerIdx = 0; state.turn = 1;
      openOnlineLobby(p1); // online.js: crear sala o unirse con código
      return;
  }
  state.currentPlayerIdx = 0; state.turn = 1;
  goToRegionSelect();
});

if(UI.btnBackNames) UI.btnBackNames.addEventListener("click", returnToMenu);
if(UI.btnBackRegion) UI.btnBackRegion.addEventListener("click", () => {
  if (state.gameMode === 'online') showScreen("online");
  else if (state.gameMode === 'local') showScreen("names"); 
  else returnToMenu();
});

document.querySelectorAll(".btn-menu").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const region = e.currentTarget.dataset.region;
    if (!region) return;

    state.continent = region;

    // Online: la sala se crea en el servidor y él nos lleva a elegir ubicación (online.js)
    if (state.gameMode === 'online') {
      if(UI.regionSubtitle) UI.regionSubtitle.textContent = "Creando sala...";
      Online.createRoom(region).catch(() => {
        alert("No se pudo conectar con el servidor.");
        showScreen("online");
      });
      return;
    }

    if (state.gameMode === 'local') {
      state.players.forEach((p) => { p.score = 0; p.hits = 0; });
      state.currentPlayerIdx = 0; state.turn = 1;
    } else {
      resetSingleGame();
    }

    if (region === "España") {
        state.mode = 'spain';
        prepareLocationScreen();
    } else {
        state.mode = 'world';
        await loadAssetsAndPrepareLoc();
    }
  });
});

async function loadAssetsAndPrepareLoc() {
  if (!state.countriesGeoJSON) {
    if(UI.menuContainer) UI.menuContainer.style.display = "none";
    if(UI.btnBackRegion) UI.btnBackRegion.style.display = "none";
    if(UI.startLoading) UI.startLoading.style.display = "block";

    try {
      let geoRes = await fetch("https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json");
      // Se añaden los microestados (Andorra, Mónaco...), que no vienen en el mapa
      state.countriesGeoJSON = DondeShot.withMicrostates(turf, await geoRes.json(), microstates);
    } catch (error) {
      alert("Error al descargar mapas. Revisa tu conexión.");
      goToRegionSelect();
      return;
    }

    if(UI.menuContainer) UI.menuContainer.style.display = "grid";
    if(UI.btnBackRegion) UI.btnBackRegion.style.display = "";
    if(UI.startLoading) UI.startLoading.style.display = "none";
  }
  prepareLocationScreen();
}

if(UI.btnBackLeaderboard) UI.btnBackLeaderboard.addEventListener("click", returnToMenu);
if(UI.btnVersusExit) UI.btnVersusExit.addEventListener("click", returnToMenu);
if(UI.btnVersusNew) UI.btnVersusNew.addEventListener("click", () => {
    if (state.gameMode === 'local' || state.gameMode === 'online') showScreen("names");
});

if(UI.btnBackLoc) UI.btnBackLoc.addEventListener("click", () => {
  if (state.gameMode === 'online') { Online.leaveRoom(); showScreen("online"); }
  else goToRegionSelect();
});

if(UI.btnChangeRegion) UI.btnChangeRegion.addEventListener("click", async () => {
  if (state.gameMode === 'classic') { goToRegionSelect(); return; }
  
  const confirmed = await customConfirm("¿Seguro que quieres abandonar la partida? Se perderá el progreso actual.");
  if (confirmed) {
    if (state.gameMode === 'local' || state.gameMode === 'online') returnToMenu(); else goToRegionSelect();
  }
});

function showMidgameScreen() {
    const p1 = state.players[0], p2 = state.players[1];
    let diff = Math.abs(p1.score - p2.score);
    
    if(UI.midgameTitle) {
        if (p1.score > p2.score) UI.midgameTitle.textContent = `¡${p1.name} va ganando!`;
        else if (p2.score > p1.score) UI.midgameTitle.textContent = `¡${p2.name} va ganando!`;
        else UI.midgameTitle.textContent = `¡Están empatados!`;
    }
    if(UI.midgameDiff) UI.midgameDiff.textContent = `Diferencia: ${diff} pts`;
    
    if(UI.midgameList) {
        UI.midgameList.innerHTML = "";
        let sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
        let rounds = 3; 

        sortedPlayers.forEach((p, index) => {
            let accuracy = Math.round((p.hits / rounds) * 100) || 0;
            let li = document.createElement("li");
            // Se usa display:flex en columna para que quede bien alineado a la derecha sin solaparse
            li.innerHTML = `
                <span>${index + 1}. ${p.name}</span>
                <div style="text-align: right; display: flex; flex-direction: column;">
                    <span>${p.score} pts</span>
                    <span style="font-size: 0.85rem; color: #94a3b8; margin-top: 2px;">${p.hits}/${rounds} aciertos (${accuracy}%)</span>
                </div>
            `;
            if (index === 0 && sortedPlayers[0].score !== sortedPlayers[1].score) li.classList.add("highlight-gold");
            UI.midgameList.appendChild(li);
        });
    }
    showScreen("midgame");
}

if(UI.btnMidgameContinue) UI.btnMidgameContinue.addEventListener("click", () => {
    state.turn++; state.currentPlayerIdx = (state.currentPlayerIdx + 1) % 2; startNewRound();
});
if(UI.btnMidgameEnd) UI.btnMidgameEnd.addEventListener("click", endLocalGame);

function endLocalGame() {
    const p1 = state.players[0], p2 = state.players[1];
    if(UI.leaderboardWinnerTitle) {
        if (p1.score > p2.score) UI.leaderboardWinnerTitle.textContent = `¡Ha ganado ${p1.name}!`;
        else if (p2.score > p1.score) UI.leaderboardWinnerTitle.textContent = `¡Ha ganado ${p2.name}!`;
        else UI.leaderboardWinnerTitle.textContent = `¡Habéis empatado!`;
        UI.leaderboardWinnerTitle.style.display = "block";
    }
    saveScores('local'); renderLeaderboard(true); showScreen("leaderboard");
}

if(UI.btnSummaryAgain) UI.btnSummaryAgain.addEventListener("click", () => { resetSingleGame(); startNewRound(); });
if(UI.btnSummaryRegion) UI.btnSummaryRegion.addEventListener("click", goToRegionSelect);
if(UI.btnSummaryMenu) UI.btnSummaryMenu.addEventListener("click", returnToMenu);

/* =======================================
   PREPARACIÓN Y SELECCIÓN DE UBICACIÓN
   ======================================= */
function prepareLocationScreen() {
  showScreen("location");
  if (!state.tempLocation) state.tempLocation = loadSavedLocation();

  // Ajuste dinámico de centro y zoom para España y Todo el mundo
  const center = state.tempLocation ? [state.tempLocation[1], state.tempLocation[0]] : (state.mode === 'spain' ? [40.0, -3.0] : [20, 0]);
  const zoom = state.tempLocation ? (state.mode === 'spain' ? 5 : 4) : (state.mode === 'spain' ? 5 : 1);

  if (!state.selectionMap) {
    state.selectionMap = L.map("select-map-container", { zoomControl: false, attributionControl: false });
    state.selectionMap.on("click", (ev) => {
      state.tempLocation = [ev.latlng.lng, ev.latlng.lat];

      if (!state.selectionMarker) {
        state.selectionMarker = state.mode === 'spain'
            ? L.marker(ev.latlng).addTo(state.selectionMap)
            : L.circleMarker(ev.latlng, MARKER_STYLE).addTo(state.selectionMap);
      } else {
        state.selectionMarker.setLatLng(ev.latlng);
      }
      if(UI.btnConfirmLoc) UI.btnConfirmLoc.disabled = false;
    });
  } else {
    state.selectionMap.eachLayer((layer) => state.selectionMap.removeLayer(layer));
    state.selectionMarker = null;
  }

  state.selectionMap.setView(center, zoom);
  
  if (state.mode === 'spain') {
      L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(state.selectionMap);
  } else if (state.countriesGeoJSON) {
      L.geoJSON(state.countriesGeoJSON, { style: COUNTRIES_STYLE }).addTo(state.selectionMap);
  }

  if (state.tempLocation) {
    state.selectionMarker = state.mode === 'spain'
        ? L.marker([state.tempLocation[1], state.tempLocation[0]]).addTo(state.selectionMap)
        : L.circleMarker([state.tempLocation[1], state.tempLocation[0]], MARKER_STYLE).addTo(state.selectionMap);
    if(UI.btnConfirmLoc) UI.btnConfirmLoc.disabled = false;
  } else {
    if(UI.btnConfirmLoc) UI.btnConfirmLoc.disabled = true;
  }

  setTimeout(() => state.selectionMap.invalidateSize(), 200);
}

/* =======================================
   INICIALIZACIÓN SESIÓN / GPS / BRÚJULA
   ======================================= */
async function initializeGameSession(source) {
  if(UI.locLoading) UI.locLoading.style.display = "block";

  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        alert("Debes permitir el acceso a la brújula para poder jugar.");
        if(UI.locLoading) UI.locLoading.style.display = "none";
        return;
      }
    }

    if (source === "gps") {
      if(UI.locLoading) UI.locLoading.textContent = "Obteniendo tu GPS...";
      state.userLocation = await getUserLocation();
    } else if (source === "map") {
      if(UI.locLoading) UI.locLoading.textContent = "Procesando mapa...";
      state.userLocation = state.tempLocation;
    }

    if (state.userLocation) {
      state.tempLocation = state.userLocation;
      saveLocation(state.userLocation);
    }

    if(state.mode === 'world') {
        state.userCountryId = findCountryAt(state.userLocation);
    }

    startCompass();
    if(UI.locLoading) UI.locLoading.style.display = "none";

    // Online: no se empieza todavía; se avisa al servidor y se espera al resto
    if (state.gameMode === 'online') {
      Online.sendLocation(state.userLocation);
      showScreen("waiting");
      return;
    }
    startNewRound();
  } catch (error) {
    console.error("Error al arrancar la brújula o mapa:", error);
    alert("Hubo un problema. Asegúrate de tener permisos de ubicación o recarga la página.");
    if(UI.locLoading) UI.locLoading.style.display = "none";
  }
}

function findCountryAt(location) {
  if (!location || !state.countriesGeoJSON) return null;
  const pt = turf.point(location);
  const country = state.countriesGeoJSON.features.find((f) => {
    try { return turf.booleanPointInPolygon(pt, f); } catch { return false; }
  });
  return country ? country.id : null;
}

const btnGps = document.getElementById("btn-gps");
const btnConfirmMap = document.getElementById("btn-confirm-location");
if(btnGps) btnGps.addEventListener("click", () => initializeGameSession("gps"));
if(btnConfirmMap) btnConfirmMap.addEventListener("click", () => initializeGameSession("map"));

async function getUserLocation() {
  if (typeof window.Capacitor !== "undefined" && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
    try {
      const { Geolocation } = window.Capacitor.Plugins;
      let permStatus = await Geolocation.checkPermissions();
      if (permStatus.location !== "granted") permStatus = await Geolocation.requestPermissions();
      if (permStatus.location !== "granted") throw new Error("Permisos denegados.");
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      return [pos.coords.longitude, pos.coords.latitude];
    } catch (e) {
      console.error(e); throw e;
    }
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Tu navegador no soporta geolocalización."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
      (err) => reject(new Error("No se pudo obtener la ubicación.")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function startCompass() {
  window.addEventListener("deviceorientationabsolute", handleOrientation);
  window.addEventListener("deviceorientation", handleOrientation);
}

function handleOrientation(event) {
  let heading = null;
  if (event.webkitCompassHeading != null) heading = event.webkitCompassHeading;
  else if (event.alpha !== null) {
    heading = 360 - event.alpha;
    if (heading === 360) heading = 0;
  }

  if (heading !== null) {
    state.currentHeading = heading;
    if (state.lastHeading === null) {
      state.totalRotation = -heading; 
    } else {
      let delta = heading - state.lastHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      state.totalRotation -= delta; 
    }
    state.lastHeading = heading;

    if(UI.compassDial) UI.compassDial.style.transform = `rotate(${state.totalRotation}deg)`;
    if(UI.debugInfo) UI.debugInfo.innerText = `Azimut: ${Math.round(heading)}°`;
  }
}

/* =======================================
   LÓGICA DEL JUEGO
   ======================================= */
function startNewRound() {
  if (state.gameMode === 'online') return; // en online las rondas las manda el servidor
  showScreen("game");
  if(UI.resultErrorDetails) UI.resultErrorDetails.style.display = "none";
  if(UI.turnPointsDisplay) UI.turnPointsDisplay.style.display = "none";

  if (state.gameMode === 'local') {
    const player = state.players[state.currentPlayerIdx];
    if(UI.currentPlayerDisplay) {
        UI.currentPlayerDisplay.textContent = `Turno de ${player.name}`;
        UI.currentPlayerDisplay.style.display = "block";
    }
    if(UI.roundInfo) UI.roundInfo.textContent = `Turno ${Math.ceil(state.turn / 2)} de 5 · ${player.score} pts`;
  } else if (state.gameMode === 'online') {
    const player = state.players[0];
    if(UI.currentPlayerDisplay) {
        UI.currentPlayerDisplay.textContent = player.name;
        UI.currentPlayerDisplay.style.display = "block";
    }
    if(UI.roundInfo) UI.roundInfo.textContent = `Ronda ${state.turn} de 10 · ${player.score} pts`;
  } else if (state.gameMode === 'ranked') {
    if(UI.currentPlayerDisplay) UI.currentPlayerDisplay.style.display = "none";
    if(UI.roundInfo) UI.roundInfo.textContent = `Ronda ${state.single.round} de ${ROUNDS_PER_GAME} · ${state.single.score} pts`;
  } else if (state.gameMode === 'classic') {
    if(UI.currentPlayerDisplay) UI.currentPlayerDisplay.style.display = "none";
    if(UI.roundInfo) UI.roundInfo.textContent = `Modo Libre · Ronda ${state.single.round}`;
  }

  const previousId = state.targetData ? (state.mode === 'spain' ? state.targetData.name : state.targetData.id) : null;

  if (state.mode === 'spain') {
      if (typeof citiesData === 'undefined') {
          alert("Error crítico: Faltan los datos de las ciudades de España. Asegúrate de haber actualizado el archivo 'data.js'.");
          return;
      }
      let validCities = citiesData.filter((c) => !DondeShot.tooClose(turf, 'spain', state.userLocation, [c.lng, c.lat]));
      if (!validCities.length) validCities = citiesData;
      if (validCities.length > 1) {
          validCities = validCities.filter((c) => c.name !== previousId);
      }
      state.targetData = validCities[Math.floor(Math.random() * validCities.length)];
      if(UI.targetName) UI.targetName.textContent = state.targetData.name;
      state.targetCenterLatLng = L.latLng(state.targetData.lat, state.targetData.lng);
  } else {
      let validCountries = state.countriesGeoJSON.features.filter((f) => {
        const inDict = dictionary[f.id];
        if (!inDict) return false;
        if (state.continent === "Todos" && f.id === "ESP") return false;
        if (f.id === state.userCountryId) return false; 
        if (state.continent !== "Todos" && inDict.continent !== state.continent) return false;
        // Nada que esté tan cerca que se acierte apuntando a cualquier lado (el Vaticano desde Roma)
        return !DondeShot.tooClose(turf, 'world', state.userLocation, turf.centroid(f).geometry.coordinates);
      });

      if (validCountries.length > 1) {
        validCountries = validCountries.filter((f) => f.id !== previousId);
      }

      state.targetData = validCountries[Math.floor(Math.random() * validCountries.length)];
      if(UI.targetName) UI.targetName.textContent = dictionary[state.targetData.id].name.trim();
      const center = turf.centroid(state.targetData).geometry.coordinates;
      state.targetCenterLatLng = L.latLng(center[1], center[0]);
  }
}

// "+200 puntos (bonus +100)" en un acierto con bonus; si fallas, lo que valía
function pointsText(shot, points) {
  if (shot.isHit && shot.bonus > 0) return `+${points} puntos (bonus +${shot.bonus})`;
  if (!shot.isHit && shot.maxPoints > shot.points) return `+${points} puntos · acertar valía ${shot.maxPoints}`;
  return `+${points} puntos`;
}

const btnConfirmGame = document.getElementById("btn-confirm");
if (btnConfirmGame) {
    btnConfirmGame.addEventListener("click", () => {
      showScreen("result");

      // El cálculo está en shot.js, el mismo archivo que usa el servidor en las partidas online
      const shot = DondeShot.judgeShot({
        turf,
        userLocation: state.userLocation,
        heading: state.currentHeading,
        mode: state.mode,
        target: state.targetData,
      });
      const isHit = shot.isHit;
      if (state.mode === 'spain') state.targetData.polygonGeometry = shot.targetGeometry;
      state.lastShot = shot; // el mapa del resultado dibuja la zona de acierto

      let turnPoints = state.gameMode === 'classic' ? 0 : shot.points;

      if(UI.resultTitle) {
          if (isHit) {
            UI.resultTitle.textContent = "ACERTASTE ✅";
            UI.resultTitle.style.color = "#4ade80";
            if(UI.resultErrorDetails) UI.resultErrorDetails.style.display = "none";
          } else {
            UI.resultTitle.textContent = "FALLASTE ❌";
            UI.resultTitle.style.color = "#f87171";
            if(UI.resultErrorDetails) {
                UI.resultErrorDetails.innerHTML = `Te faltaron aprox: <b>${shot.minDistanceKm} km</b>`;
                UI.resultErrorDetails.style.display = "block";
            }
          }
      }

      if(UI.turnPointsDisplay) {
          if (state.gameMode === 'classic') {
            UI.turnPointsDisplay.style.display = "none";
          } else {
            UI.turnPointsDisplay.textContent = pointsText(shot, turnPoints);
            UI.turnPointsDisplay.style.display = "block";
          }
      }

      if (state.gameMode === 'local') {
        state.players[state.currentPlayerIdx].score += turnPoints;
        if (isHit) state.players[state.currentPlayerIdx].hits++;
        if (state.turn >= 10) UI.btnRestart.textContent = "Ver Puntuaciones";
        else if (state.turn === 6) UI.btnRestart.textContent = "Ver Marcador";
        else UI.btnRestart.textContent = "Siguiente Turno";
      } else if (state.gameMode === 'online') {
        // Solo se manda el rumbo: el servidor decide los puntos (online.js)
        onlineShot(state.currentHeading);
      } else if (state.gameMode === 'ranked') {
        state.single.score += turnPoints;
        if (isHit) state.single.hits++;
        if(UI.btnRestart) UI.btnRestart.textContent = state.single.round >= ROUNDS_PER_GAME ? "Ver resultado" : "Siguiente ronda";
      } else if (state.gameMode === 'classic') {
        if(UI.btnRestart) UI.btnRestart.textContent = "Siguiente ronda";
      }

      setTimeout(() => { drawResultMap(shot.beam, isHit, shot.errorLine); }, 100);
    });
}

if(UI.btnRestart) UI.btnRestart.addEventListener("click", () => {
  if (state.gameMode === 'local') {
    if (state.turn === 6) showMidgameScreen();
    else if (state.turn >= 10) endLocalGame();
    else { state.turn++; state.currentPlayerIdx = (state.currentPlayerIdx + 1) % 2; startNewRound(); }
  } else if (state.gameMode === 'online') {
    onlineNext();
  } else if (state.gameMode === 'ranked') {
    if (state.single.round >= ROUNDS_PER_GAME) finishSingleGame();
    else { state.single.round++; startNewRound(); }
  } else if (state.gameMode === 'classic') {
    state.single.round++; startNewRound();
  }
});

/* =======================================
   LEADERBOARD Y PUNTUACIONES 
   ======================================= */
/* Ranking local por Elo (elo.js). Se guarda en el móvil:
   dondeQueda_elo_local = { "Nombre": { elo, games, wins, best } }
   Los nombres del ranking antiguo (mejor puntuación) se conservan con 1000 de Elo. */
const LOCAL_ELO_KEY = "dondeQueda_elo_local";
const OLD_LOCAL_KEY = "dondeQueda_scores_local";

function loadLocalElo() {
  let table = null;
  try { table = JSON.parse(localStorage.getItem(LOCAL_ELO_KEY)); } catch {}
  if (table) return table;
  table = {};
  try {
    const old = JSON.parse(localStorage.getItem(OLD_LOCAL_KEY)) || {};
    Object.entries(old).forEach(([name, best]) => {
      table[name] = { elo: DondeElo.START, games: 0, wins: 0, best: best || 0 };
    });
  } catch {}
  return table;
}

// Busca el nombre sin distinguir mayúsculas, para no duplicar a "ana" y "Ana"
function localEloKey(table, name) {
  return Object.keys(table).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
}

function saveScores(type) {
  if (type !== 'local') return;
  const table = loadLocalElo();
  const players = state.players.filter((p) => p.name.trim());
  // Puesto de cada uno: más puntos gana; a igualdad, más aciertos; si no, empate
  const ranked = players.map((p) => ({ p, key: localEloKey(table, p.name.trim()) }));
  ranked.forEach((r) => {
    r.position = 1 + ranked.filter((o) => o.p.score > r.p.score || (o.p.score === r.p.score && o.p.hits > r.p.hits)).length;
    if (!table[r.key]) table[r.key] = { elo: DondeElo.START, games: 0, wins: 0, best: 0 };
  });
  const result = DondeElo.rateMatch(ranked.map((r) => ({
    id: r.key, rating: table[r.key].elo, games: table[r.key].games, position: r.position,
  })));
  state.lastEloDeltas = {};
  result.forEach((res) => {
    const r = ranked.find((x) => x.key === res.id);
    const row = table[res.id];
    row.elo = res.after;
    row.games += 1;
    if (r.position === 1 && ranked.some((o) => o.position > 1)) row.wins += 1;
    row.best = Math.max(row.best || 0, r.p.score);
    state.lastEloDeltas[res.id.toLowerCase()] = res.delta;
  });
  localStorage.setItem(LOCAL_ELO_KEY, JSON.stringify(table));
}

function renderLeaderboard(isEndGame = false) {
  if(UI.leaderboardLocal) UI.leaderboardLocal.innerHTML = "";
  if(UI.leaderboardOnline) UI.leaderboardOnline.innerHTML = "";

  if (!isEndGame) {
      if(UI.leaderboardWinnerTitle) UI.leaderboardWinnerTitle.style.display = "none";
      if(UI.leaderboardColLocal) UI.leaderboardColLocal.style.display = "flex";
      if(UI.leaderboardColOnline) UI.leaderboardColOnline.style.display = "flex";
      if(UI.leaderboardGeneralTitle) UI.leaderboardGeneralTitle.style.marginTop = "0";
  } else {
      if (state.gameMode === 'local') {
          if(UI.leaderboardColLocal) UI.leaderboardColLocal.style.display = "flex";
          if(UI.leaderboardColOnline) UI.leaderboardColOnline.style.display = "none";
          if(UI.leaderboardGeneralTitle) UI.leaderboardGeneralTitle.style.marginTop = "10px";
      } else if (state.gameMode === 'online') {
          if(UI.leaderboardColLocal) UI.leaderboardColLocal.style.display = "none";
          if(UI.leaderboardColOnline) UI.leaderboardColOnline.style.display = "flex";
          if(UI.leaderboardGeneralTitle) UI.leaderboardGeneralTitle.style.marginTop = "0";
      }
  }

  // Ranking local: ordenado por Elo
  const renderLocalElo = (listEl) => {
      if(!listEl) return null;
      const table = loadLocalElo();
      const sorted = Object.entries(table).sort((a, b) => b[1].elo - a[1].elo || b[1].wins - a[1].wins);
      let lowestHighlightedNode = null;

      sorted.forEach(([name, row], index) => {
          const li = document.createElement("li");
          const left = document.createElement("span");
          left.textContent = `${index + 1}. ${name}`;
          const right = document.createElement("div");
          right.style.cssText = "text-align: right; display: flex; flex-direction: column;";
          const main = document.createElement("span");
          main.textContent = `${row.elo} Elo · ${row.wins} 🏆`;
          right.appendChild(main);

          const player = isEndGame && state.gameMode === 'local'
              ? state.players.find((p) => p.name.trim().toLowerCase() === name.toLowerCase())
              : null;
          if (player) {
              li.classList.add("highlight-gold");
              lowestHighlightedNode = li;
              const delta = (state.lastEloDeltas || {})[name.toLowerCase()] || 0;
              const rounds = Math.max(1, Math.floor(state.turn / 2));
              const accuracy = Math.round((player.hits / rounds) * 100) || 0;
              const extra = document.createElement("span");
              extra.style.cssText = "font-size: 0.85rem; color: #94a3b8; margin-top: 2px;";
              extra.textContent = `${delta >= 0 ? "+" : ""}${delta} Elo · ${player.score} pts · ${player.hits}/${rounds} aciertos (${accuracy}%)`;
              right.appendChild(extra);
          }
          li.append(left, right); // textContent: los nombres nunca se interpretan como HTML
          listEl.appendChild(li);
      });
      return lowestHighlightedNode;
  };

  const nodeLocal = renderLocalElo(UI.leaderboardLocal);
  // El ranking online sale de la base de datos del servidor (online.js)
  if (UI.leaderboardOnline) renderOnlineRanking(UI.leaderboardOnline);

  const isOnlineEnd = isEndGame && state.gameMode === 'online';
  const standingsBox = document.getElementById("match-standings-box");
  if (standingsBox && !isOnlineEnd) standingsBox.style.display = "none";
  if (UI.btnVersusRestart) UI.btnVersusRestart.style.display = isOnlineEnd ? "none" : "";

  if (isEndGame) {
    if(UI.endgameActions) UI.endgameActions.style.display = "block";
    if(UI.standardActions) UI.standardActions.style.display = "none";
    if (nodeLocal && state.gameMode === 'local') { setTimeout(() => { nodeLocal.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 200); }
  } else {
    if(UI.endgameActions) UI.endgameActions.style.display = "none";
    if(UI.standardActions) UI.standardActions.style.display = "block";
  }
}

if(UI.btnClearScores) UI.btnClearScores.addEventListener("click", async () => {
  const confirmed = await customConfirm("¿Estás seguro de que deseas borrar todas las puntuaciones? Esta acción no se puede deshacer.");
  if (confirmed) {
    localStorage.removeItem(LOCAL_ELO_KEY);
    localStorage.removeItem(OLD_LOCAL_KEY);
    renderLeaderboard(false);
  }
});

if(UI.btnVersusRestart) UI.btnVersusRestart.addEventListener("click", () => {
  state.turn = 1; state.currentPlayerIdx = 0;
  state.players.forEach(p => { p.score = 0; p.hits = 0; });
  startNewRound();
});

/* =======================================
   RENDERIZADO MAPA DE RESULTADOS
   ======================================= */
function drawResultMap(beamGeometry, isHit, errorLine = null) {
  if (!state.resultMap) {
    state.resultMap = L.map("map-container", { zoomControl: false, attributionControl: false });
    state.resultMapLayers = L.featureGroup().addTo(state.resultMap);
  }

  state.resultMap.invalidateSize();
  state.resultMapLayers.clearLayers();

  state.resultMap.eachLayer((layer) => {
    if (layer !== state.resultMapLayers) state.resultMap.removeLayer(layer);
  });

  if (state.mode === 'spain') {
      L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(state.resultMap);
      L.geoJSON(state.targetData.polygonGeometry, {
          style: { fillColor: isHit ? '#22c55e' : '#ef4444', weight: 2, color: '#ffffff', fillOpacity: 0.8 }
      }).addTo(state.resultMapLayers);
      L.circleMarker([state.targetData.lat, state.targetData.lng], {
          radius: 4, fillColor: '#000000', color: '#000000', weight: 1, fillOpacity: 1
      }).addTo(state.resultMapLayers);
      
      const bounds = L.latLngBounds([
          [state.userLocation[1], state.userLocation[0]],
          [state.targetData.lat, state.targetData.lng]
      ]);
      state.resultMap.fitBounds(bounds, { padding: [30, 30] });
  } else {
      L.geoJSON(state.countriesGeoJSON, { style: COUNTRIES_STYLE }).addTo(state.resultMap);
      // Zona de acierto: solo se ve en destinos pequeños, donde es más grande que el país
      if (state.lastShot && state.lastShot.zoneGeometry) {
          L.geoJSON(state.lastShot.zoneGeometry, {
              style: { color: "#facc15", weight: 1.5, dashArray: "4, 6", fillOpacity: 0.08, fillColor: "#facc15" },
          }).addTo(state.resultMapLayers);
      }
      L.geoJSON(state.targetData, {
          style: { fillColor: isHit ? "#22c55e" : "#ef4444", weight: 2, color: "#ffffff", fillOpacity: 0.8 },
      }).addTo(state.resultMapLayers);
      state.resultMap.setView([state.userLocation[1], state.userLocation[0]], 2);
  }

  L.geoJSON(beamGeometry, {
    style: { color: isHit ? "#facc15" : "#64748b", weight: 5, opacity: 0.8 },
  }).addTo(state.resultMapLayers);

  if (errorLine) {
    L.geoJSON(errorLine, {
      style: { color: "#facc15", weight: 3, dashArray: "6, 6", opacity: 0.9 },
    }).addTo(state.resultMapLayers);
  }

  L.circleMarker(
    [state.userLocation[1], state.userLocation[0]],
    { radius: state.mode === 'spain' ? 6 : 5, fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1 }
  ).addTo(state.resultMapLayers);
}