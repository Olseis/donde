/* =======================================
   CONFIGURACIÓN
   ======================================= */
const ROUNDS_PER_GAME = 10;
const PROGRESS_KEY = "dondeQueda_progress";

const REGION_NAMES = {
  Todos: "Todo el mundo",
  América: "América",
  Europa: "Europa",
  Asia: "Asia",
  África: "África",
  Oceanía: "Oceanía",
};

// Títulos según el nivel (a partir del último se repite)
const LEVEL_TITLES = [
  "Turista",
  "Mochilero",
  "Viajero",
  "Explorador",
  "Navegante",
  "Cartógrafo",
  "Aventurero",
  "Trotamundos",
  "Leyenda",
];

const MARKER_STYLE = {
  radius: 5,
  fillColor: "#3b82f6",
  color: "#ffffff",
  weight: 2,
  fillOpacity: 1,
};

const COUNTRIES_STYLE = {
  fillColor: "#1e293b",
  weight: 1,
  color: "#334155",
  fillOpacity: 0.5,
};

/* =======================================
   ESTADO GLOBAL DEL JUEGO
   ======================================= */
const state = {
  gameMode: 'ranked', // 'classic', 'ranked', 'local', 'online'
  continent: "Todos",
  userLocation: null,
  userCountryId: null,
  tempLocation: null,
  currentHeading: 0,
  targetData: null,
  targetCenterLatLng: null,
  countriesGeoJSON: null,

  // Variables de corrección de brújula
  lastHeading: null,
  totalRotation: 0,

  // Partida de un jugador (Classic / Ranked)
  single: { round: 1, score: 0, hits: 0 },

  // Variables de jugadores (Local / Online)
  players: [
    { name: "", score: 0 },
    { name: "", score: 0 },
  ],
  currentPlayerIdx: 0,
  turn: 1,

  // Elementos de mapas
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
  summary: document.getElementById("summary-screen"),
};

const UI = {
  // Pantalla de inicio (modo de juego)
  btnModeClassic: document.getElementById("btn-mode-classic"),
  btnModeRanked: document.getElementById("btn-mode-ranked"),
  btnModeLocal: document.getElementById("btn-mode-local"),
  btnModeOnline: document.getElementById("btn-mode-online"),
  btnShowProgress: document.getElementById("btn-show-progress"),
  btnShowScores: document.getElementById("btn-show-scores"),
  btnCredits: document.getElementById("btn-credits-float"),
  btnCreditsBack: document.getElementById("btn-back-credits"),

  // Pantalla de región
  regionSubtitle: document.getElementById("region-subtitle"),
  menuContainer: document.getElementById("menu-container"),
  startLoading: document.getElementById("start-loading-text"),
  btnBackRegion: document.getElementById("btn-back-region"),

  // Pantalla Nombres Versus / Online
  namesTitle: document.getElementById("names-title"),
  inputP1: document.getElementById("input-p1"),
  inputP2: document.getElementById("input-p2"),
  btnConfirmNames: document.getElementById("btn-confirm-names"),
  btnBackNames: document.getElementById("btn-back-names"),

  // Pantalla Leaderboard
  leaderboardLocal: document.getElementById("leaderboard-list-local"),
  leaderboardOnline: document.getElementById("leaderboard-list-online"),
  endgameActions: document.getElementById("endgame-actions"),
  standardActions: document.getElementById("standard-actions"),
  btnBackLeaderboard: document.getElementById("btn-back-leaderboard"),
  btnClearScores: document.getElementById("btn-clear-scores"),
  btnVersusRestart: document.getElementById("btn-versus-restart"),
  btnVersusExit: document.getElementById("btn-versus-exit"),

  // Pantalla de progreso
  progressLevelName: document.getElementById("progress-level-name"),
  progressLevelFill: document.getElementById("progress-level-fill"),
  progressLevelText: document.getElementById("progress-level-text"),
  statGames: document.getElementById("stat-games"),
  statHits: document.getElementById("stat-hits"),
  statAccuracy: document.getElementById("stat-accuracy"),
  recordsList: document.getElementById("records-list"),
  btnBackProgress: document.getElementById("btn-back-progress"),
  btnResetProgress: document.getElementById("btn-reset-progress"),

  // Pantalla Ubicación
  btnConfirmLoc: document.getElementById("btn-confirm-location"),
  btnBackLoc: document.getElementById("btn-back-loc"),
  locLoading: document.getElementById("location-loading-text"),

  // Pantalla Juego
  currentPlayerDisplay: document.getElementById("current-player-display"),
  roundInfo: document.getElementById("round-info"),
  compassDial: document.getElementById("compass-dial"),
  debugInfo: document.getElementById("debug-info"),
  targetName: document.getElementById("target-name"),

  // Pantalla Resultados
  resultTitle: document.getElementById("result-title"),
  turnPointsDisplay: document.getElementById("turn-points-display"),
  resultErrorDetails: document.getElementById("result-error-details"),
  btnRestart: document.getElementById("btn-restart"),
  btnChangeRegion: document.getElementById("btn-change-region"),

  // Pantalla de resumen (un jugador)
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
  btnSummaryMenu: document.getElementById("btn-summary-menu"),
};

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
  nameEl.textContent = `Nivel ${info.level} · ${info.title}`;
  fillEl.style.width = `${Math.round(info.progress * 100)}%`;
  textEl.textContent = `${info.xpInLevel} / ${info.xpNeeded} XP para el nivel ${info.level + 1}`;
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
    // Se muestra solo si estamos en Ranked (que es el modo que usa puntuaciones de progreso)
    span.textContent = (state.gameMode === 'ranked') && best ? `Récord: ${best.score}` : "";
    span.style.display = span.textContent ? "" : "none";
  });
}

function renderProgressScreen() {
  const progress = loadProgress();
  renderLevelCard(
    UI.progressLevelName,
    UI.progressLevelFill,
    UI.progressLevelText,
    getLevelInfo(progress.xp),
  );

  UI.statGames.textContent = progress.gamesPlayed;
  UI.statHits.textContent = progress.totalHits;
  const totalRounds = progress.gamesPlayed * ROUNDS_PER_GAME;
  UI.statAccuracy.textContent = totalRounds
    ? `${Math.round((progress.totalHits / totalRounds) * 100)}%`
    : "0%";

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

function animateLevelBar(fillEl, fromProgress, toProgress) {
  fillEl.style.transition = "none";
  fillEl.style.width = `${Math.round(fromProgress * 100)}%`;
  void fillEl.offsetWidth; 
  fillEl.style.transition = "";
  setTimeout(() => {
    fillEl.style.width = `${Math.round(toProgress * 100)}%`;
  }, 150);
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
    progress.bestByRegion[region] = {
      score,
      hits,
      date: new Date().toISOString(),
    };
  }
  saveProgress(progress);

  const after = getLevelInfo(progress.xp);

  UI.summaryRegion.textContent = REGION_NAMES[region];
  UI.summaryScore.textContent = score;
  UI.summaryHits.textContent = `${hits} de ${ROUNDS_PER_GAME} aciertos`;

  if (!prevBest) {
    UI.summaryRecord.textContent = "🏅 ¡Primer récord en esta región!";
  } else if (isRecord) {
    UI.summaryRecord.textContent = `🏆 ¡Nuevo récord! (antes: ${prevBest.score})`;
  } else {
    UI.summaryRecord.textContent = `Tu récord aquí: ${prevBest.score}`;
  }
  UI.summaryRecord.classList.toggle("is-record", isRecord);

  renderLevelCard(
    UI.summaryLevelName,
    UI.summaryLevelFill,
    UI.summaryLevelText,
    after,
  );
  UI.summaryXpGain.textContent = `+${score} XP`;

  const leveledUp = after.level > before.level;
  animateLevelBar(
    UI.summaryLevelFill,
    leveledUp ? 0 : before.progress,
    after.progress,
  );

  if (leveledUp) {
    UI.summaryLevelUp.textContent = `⬆️ ¡Subes a nivel ${after.level}: ${after.title}!`;
    UI.summaryLevelUp.style.display = "";
  } else {
    UI.summaryLevelUp.style.display = "none";
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
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[screenName].classList.add("active");

  UI.btnCredits.style.display = screenName === "start" ? "flex" : "none";
}

function returnToMenu() {
  state.gameMode = null;
  showScreen("start");
}

function goToRegionSelect() {
  UI.menuContainer.style.display = "grid";
  UI.startLoading.style.display = "none";
  UI.btnBackRegion.style.display = "";
  
  if (state.gameMode === 'local') {
      UI.regionSubtitle.textContent = `Local: ${state.players[0].name} vs ${state.players[1].name}`;
  } else if (state.gameMode === 'online') {
      UI.regionSubtitle.textContent = `Online: ${state.players[0].name}`;
  } else if (state.gameMode === 'ranked') {
      UI.regionSubtitle.textContent = `Ranked · ${ROUNDS_PER_GAME} rondas`;
  } else {
      UI.regionSubtitle.textContent = `Clásico · Infinito`;
  }
  
  updateRegionBests();
  showScreen("region");
}

// --- Pantalla de inicio: elegir modo ---
UI.btnModeClassic.addEventListener("click", () => {
  state.gameMode = 'classic';
  goToRegionSelect();
});

UI.btnModeRanked.addEventListener("click", () => {
  state.gameMode = 'ranked';
  goToRegionSelect();
});

UI.btnModeLocal.addEventListener("click", () => {
  state.gameMode = 'local';
  UI.namesTitle.textContent = "Nombres de los Jugadores";
  UI.inputP2.style.display = "block";
  UI.inputP1.value = "";
  UI.inputP2.value = "";
  showScreen("names");
});

UI.btnModeOnline.addEventListener("click", () => {
  state.gameMode = 'online';
  UI.namesTitle.textContent = "Tu Nombre (Online)";
  UI.inputP2.style.display = "none";
  const savedName = localStorage.getItem("dondeQueda_onlineName") || "";
  UI.inputP1.value = savedName;
  showScreen("names");
});

UI.btnShowProgress.addEventListener("click", () => {
  renderProgressScreen();
  showScreen("progress");
});

UI.btnShowScores.addEventListener("click", () => {
  renderLeaderboard(false);
  showScreen("leaderboard");
});

UI.btnCredits.addEventListener("click", () => showScreen("credits"));
UI.btnCreditsBack.addEventListener("click", returnToMenu);

// --- Pantalla de progreso ---
UI.btnBackProgress.addEventListener("click", returnToMenu);

UI.btnResetProgress.addEventListener("click", () => {
  if (
    confirm(
      "¿Seguro que quieres borrar tu progreso? Perderás tu nivel y tus récords.",
    )
  ) {
    localStorage.removeItem(PROGRESS_KEY);
    renderProgressScreen();
  }
});

// --- Pantalla de nombres (Local/Online) ---
UI.btnConfirmNames.addEventListener("click", () => {
  const p1 = UI.inputP1.value.trim() || "Jugador 1";
  
  if (state.gameMode === 'local') {
      const p2 = UI.inputP2.value.trim() || "Jugador 2";
      if (p1.toLowerCase() === p2.toLowerCase()) {
          alert("Los nombres no pueden ser iguales.");
          UI.inputP2.focus();
          return;
      }
      state.players = [
          { name: p1, score: 0 },
          { name: p2, score: 0 },
      ];
  } else if (state.gameMode === 'online') {
      localStorage.setItem("dondeQueda_onlineName", p1);
      state.players = [
          { name: p1, score: 0 }
      ];
  }
  
  state.currentPlayerIdx = 0;
  state.turn = 1;
  goToRegionSelect();
});

UI.btnBackNames.addEventListener("click", returnToMenu);

// --- Pantalla de región ---
UI.btnBackRegion.addEventListener("click", () => {
  if (state.gameMode === 'local' || state.gameMode === 'online')
    showScreen("names"); 
  else returnToMenu();
});

document.querySelectorAll(".btn-menu").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const region = e.currentTarget.dataset.region;
    if (!region) return;

    state.continent = region;

    if (state.gameMode === 'local' || state.gameMode === 'online') {
      state.players.forEach((p) => (p.score = 0));
      state.currentPlayerIdx = 0;
      state.turn = 1;
    } else {
      resetSingleGame();
    }

    await loadAssetsAndPrepareLoc();
  });
});

async function loadAssetsAndPrepareLoc() {
  if (!state.countriesGeoJSON) {
    UI.menuContainer.style.display = "none";
    UI.btnBackRegion.style.display = "none";
    UI.startLoading.style.display = "block";

    try {
      let geoRes = await fetch(
        "https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json",
      );
      state.countriesGeoJSON = await geoRes.json();
    } catch (error) {
      alert("Error al descargar mapas. Revisa tu conexión.");
      goToRegionSelect();
      return;
    }

    UI.menuContainer.style.display = "grid";
    UI.btnBackRegion.style.display = "";
    UI.startLoading.style.display = "none";
  }
  prepareLocationScreen();
}

// --- Otras navegaciones ---
UI.btnBackLeaderboard.addEventListener("click", returnToMenu);
UI.btnVersusExit.addEventListener("click", returnToMenu);

UI.btnBackLoc.addEventListener("click", goToRegionSelect);

UI.btnChangeRegion.addEventListener("click", () => {
  let msg = "¿Seguro que quieres abandonar la partida?";
  if (state.gameMode !== 'classic') msg += " Se perderá el progreso actual.";
  
  if (confirm(msg)) {
    if (state.gameMode === 'local' || state.gameMode === 'online') returnToMenu();
    else goToRegionSelect();
  }
});

// --- Pantalla de resumen (un jugador) ---
UI.btnSummaryAgain.addEventListener("click", () => {
  resetSingleGame();
  startNewRound(); 
});
UI.btnSummaryRegion.addEventListener("click", goToRegionSelect);
UI.btnSummaryMenu.addEventListener("click", returnToMenu);

/* =======================================
   PREPARACIÓN Y SELECCIÓN DE UBICACIÓN
   ======================================= */
function prepareLocationScreen() {
  showScreen("location");

  const center = [20, 0];
  const zoom = 1;

  if (!state.selectionMap) {
    state.selectionMap = L.map("select-map-container", {
      zoomControl: false,
      attributionControl: false,
    });

    state.selectionMap.on("click", (ev) => {
      state.tempLocation = [ev.latlng.lng, ev.latlng.lat];

      if (!state.selectionMarker) {
        state.selectionMarker = L.circleMarker(ev.latlng, MARKER_STYLE).addTo(
          state.selectionMap,
        );
      } else {
        state.selectionMarker.setLatLng(ev.latlng);
      }
      UI.btnConfirmLoc.disabled = false;
    });
  } else {
    state.selectionMap.eachLayer((layer) =>
      state.selectionMap.removeLayer(layer),
    );
    state.selectionMarker = null;
  }

  state.selectionMap.setView(center, zoom);
  L.geoJSON(state.countriesGeoJSON, { style: COUNTRIES_STYLE }).addTo(
    state.selectionMap,
  );

  if (state.tempLocation) {
    state.selectionMarker = L.circleMarker(
      [state.tempLocation[1], state.tempLocation[0]],
      MARKER_STYLE,
    ).addTo(state.selectionMap);
  }

  setTimeout(() => state.selectionMap.invalidateSize(), 200);
}

/* =======================================
   INICIALIZACIÓN SESIÓN / GPS / BRÚJULA
   ======================================= */
async function initializeGameSession(source) {
  UI.locLoading.style.display = "block";

  try {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        alert("Debes permitir el acceso a la brújula para poder jugar.");
        UI.locLoading.style.display = "none";
        return;
      }
    }

    if (source === "gps") {
      UI.locLoading.textContent = "Obteniendo tu GPS...";
      state.userLocation = await getUserLocation();
    } else if (source === "map") {
      UI.locLoading.textContent = "Procesando mapa...";
      state.userLocation = state.tempLocation;
    }

    state.userCountryId = findCountryAt(state.userLocation);

    startCompass();
    startNewRound();
    UI.locLoading.style.display = "none";
  } catch (error) {
    console.error("Error:", error);
    alert(
      "Hubo un problema. Asegúrate de activar y permitir el uso de la ubicación.",
    );
    UI.locLoading.style.display = "none";
  }
}

function findCountryAt(location) {
  if (!location || !state.countriesGeoJSON) return null;
  const pt = turf.point(location);
  const country = state.countriesGeoJSON.features.find((f) => {
    try {
      return turf.booleanPointInPolygon(pt, f);
    } catch {
      return false;
    }
  });
  return country ? country.id : null;
}

document
  .getElementById("btn-gps")
  .addEventListener("click", () => initializeGameSession("gps"));
document
  .getElementById("btn-confirm-location")
  .addEventListener("click", () => initializeGameSession("map"));

async function getUserLocation() {
  if (
    typeof Capacitor !== "undefined" &&
    Capacitor.Plugins &&
    Capacitor.Plugins.Geolocation
  ) {
    try {
      const { Geolocation } = Capacitor.Plugins;
      let permStatus = await Geolocation.checkPermissions();

      if (permStatus.location !== "granted") {
        permStatus = await Geolocation.requestPermissions();
      }

      if (permStatus.location !== "granted") {
        throw new Error("Permisos de ubicación denegados por el usuario.");
      }

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      return [pos.coords.longitude, pos.coords.latitude];
    } catch (e) {
      console.error("Error al obtener ubicación nativa:", e);
      throw e;
    }
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("Tu navegador no soporta geolocalización."));
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

    UI.compassDial.style.transform = `rotate(${state.totalRotation}deg)`;
    UI.debugInfo.innerText = `Rumbo: ${Math.round(heading)}°`;
  }
}

/* =======================================
   LÓGICA DEL JUEGO
   ======================================= */
function startNewRound() {
  showScreen("game");
  UI.resultErrorDetails.style.display = "none";
  UI.turnPointsDisplay.style.display = "none";

  if (state.gameMode === 'local') {
    const player = state.players[state.currentPlayerIdx];
    UI.currentPlayerDisplay.textContent = `Turno de ${player.name}`;
    UI.currentPlayerDisplay.style.display = "block";
    UI.roundInfo.textContent = `Turno ${Math.ceil(state.turn / 2)} de 5 · ${player.score} pts`;
  } else if (state.gameMode === 'online') {
    const player = state.players[0];
    UI.currentPlayerDisplay.textContent = player.name;
    UI.currentPlayerDisplay.style.display = "block";
    UI.roundInfo.textContent = `Ronda ${state.turn} de 10 · ${player.score} pts`;
  } else if (state.gameMode === 'ranked') {
    UI.currentPlayerDisplay.style.display = "none";
    UI.roundInfo.textContent = `Ronda ${state.single.round} de ${ROUNDS_PER_GAME} · ${state.single.score} pts`;
  } else if (state.gameMode === 'classic') {
    UI.currentPlayerDisplay.style.display = "none";
    UI.roundInfo.textContent = `Modo Libre · Ronda ${state.single.round}`;
  }

  const previousId = state.targetData ? state.targetData.id : null;

  let validCountries = state.countriesGeoJSON.features.filter((f) => {
    const inDict = dictionary[f.id];
    if (!inDict) return false;
    if (f.id === state.userCountryId) return false; 
    if (state.continent === "Todos") return true;
    return inDict.continent === state.continent;
  });

  if (validCountries.length > 1) {
    validCountries = validCountries.filter((f) => f.id !== previousId);
  }

  state.targetData =
    validCountries[Math.floor(Math.random() * validCountries.length)];
  UI.targetName.textContent = dictionary[state.targetData.id].name.trim();

  const center = turf.centroid(state.targetData).geometry.coordinates;
  state.targetCenterLatLng = L.latLng(center[1], center[0]);
}

document.getElementById("btn-confirm").addEventListener("click", () => {
  showScreen("result");

  let isHit = false;
  let errorLine = null;

  const distanceToTarget = turf.distance(
    state.userLocation,
    [state.targetCenterLatLng.lng, state.targetCenterLatLng.lat],
    { units: "kilometers" },
  );
  const rayLengthKm = Math.min(distanceToTarget + 1500, 20000);

  const linePoints = buildBeamString(rayLengthKm, 100, true);
  const lines = breakLinesOnMeridian(linePoints);
  const exactCollisionBeam = turf.featureCollection(lines);

  const flattenedCountry = turf.flatten(state.targetData);
  turf.featureEach(flattenedCountry, function (countryPart) {
    turf.featureEach(exactCollisionBeam, function (linePart) {
      const intersections = turf.lineIntersect(linePart, countryPart);
      if (intersections.features.length > 0) isHit = true;

      const startPoint = turf.point(linePart.geometry.coordinates[0]);
      if (turf.booleanPointInPolygon(startPoint, countryPart)) isHit = true;
    });
  });

  const idealBearing = turf.bearing(state.userLocation, [
    state.targetCenterLatLng.lng,
    state.targetCenterLatLng.lat,
  ]);
  let headingNorm = state.currentHeading % 360;
  let bearingNorm = idealBearing < 0 ? 360 + idealBearing : idealBearing;

  let errorAngle = Math.abs(headingNorm - bearingNorm);
  if (errorAngle > 180) errorAngle = 360 - errorAngle;

  let turnPoints = 0;

  if (isHit) {
    UI.resultTitle.textContent = "ACERTASTE ✅";
    UI.resultTitle.style.color = "#4ade80";
    UI.resultErrorDetails.style.display = "none";
    turnPoints = 100;
  } else {
    UI.resultTitle.textContent = "FALLASTE ❌";
    UI.resultTitle.style.color = "#f87171";

    if (errorAngle <= 90) turnPoints = Math.round(75 * (1 - errorAngle / 90));
    else turnPoints = 0;

    let minDistance = Infinity;
    let closestCountryPt = null;

    const vertices = turf.explode(state.targetData);
    const userPt = turf.point(state.userLocation);

    turf.featureEach(vertices, function (pointFeature) {
      const dist = turf.distance(userPt, pointFeature, { units: "kilometers" });
      if (dist < minDistance) {
        minDistance = dist;
        closestCountryPt = pointFeature;
      }
    });

    if (closestCountryPt) {
      let pt2 = closestCountryPt.geometry.coordinates;
      if (state.userLocation[0] - pt2[0] > 180) pt2 = [pt2[0] + 360, pt2[1]];
      else if (pt2[0] - state.userLocation[0] > 180)
        pt2 = [pt2[0] - 360, pt2[1]];
      errorLine = turf.lineString([state.userLocation, pt2]);
    }

    UI.resultErrorDetails.innerHTML = `Te faltaron aprox: <b>${Math.round(minDistance)} km</b>`;
    UI.resultErrorDetails.style.display = "block";
  }

  // Clásico no tiene puntos
  if (state.gameMode === 'classic') turnPoints = 0;

  if (state.gameMode === 'classic') {
    UI.turnPointsDisplay.style.display = "none";
  } else {
    UI.turnPointsDisplay.textContent = `+${turnPoints} puntos`;
    UI.turnPointsDisplay.style.display = "block";
  }

  if (state.gameMode === 'local') {
    state.players[state.currentPlayerIdx].score += turnPoints;
    if (state.turn >= 10) UI.btnRestart.textContent = "Ver Puntuaciones";
    else UI.btnRestart.textContent = "Siguiente Turno";
  } else if (state.gameMode === 'online') {
    state.players[0].score += turnPoints;
    if (state.turn >= 10) UI.btnRestart.textContent = "Ver Puntuaciones";
    else UI.btnRestart.textContent = "Siguiente Ronda";
  } else if (state.gameMode === 'ranked') {
    state.single.score += turnPoints;
    if (isHit) state.single.hits++;
    UI.btnRestart.textContent = state.single.round >= ROUNDS_PER_GAME ? "Ver resultado" : "Siguiente ronda";
  } else if (state.gameMode === 'classic') {
    UI.btnRestart.textContent = "Siguiente ronda";
  }

  setTimeout(() => {
    drawResultMap(exactCollisionBeam, isHit, errorLine);
  }, 100);
});

UI.btnRestart.addEventListener("click", () => {
  if (state.gameMode === 'local') {
    if (state.turn >= 10) {
      saveScores('local');
      renderLeaderboard(true);
      showScreen("leaderboard");
    } else {
      state.turn++;
      state.currentPlayerIdx = (state.currentPlayerIdx + 1) % 2;
      startNewRound();
    }
  } else if (state.gameMode === 'online') {
    if (state.turn >= 10) {
      saveScores('online');
      renderLeaderboard(true);
      showScreen("leaderboard");
    } else {
      state.turn++;
      startNewRound();
    }
  } else if (state.gameMode === 'ranked') {
    if (state.single.round >= ROUNDS_PER_GAME) {
      finishSingleGame();
    } else {
      state.single.round++;
      startNewRound();
    }
  } else if (state.gameMode === 'classic') {
    state.single.round++;
    startNewRound();
  }
});

/* =======================================
   LEADERBOARD Y PUNTUACIONES (VERSUS / ONLINE)
   ======================================= */
function saveScores(type) {
  const key = type === 'local' ? "dondeQueda_scores_local" : "dondeQueda_scores_online";
  let scores = JSON.parse(localStorage.getItem(key)) || {};
  
  state.players.forEach((p) => {
    let nameToSave = p.name.trim();
    if (nameToSave === "") return;

    let existingKey = Object.keys(scores).find(
      (k) => k.toLowerCase() === nameToSave.toLowerCase(),
    );
    let keyToUse = existingKey || nameToSave;

    if (!scores[keyToUse] || p.score > scores[keyToUse]) {
      scores[keyToUse] = p.score;
    }
  });
  localStorage.setItem(key, JSON.stringify(scores));
}

function renderLeaderboard(isEndGame = false) {
  UI.leaderboardLocal.innerHTML = "";
  UI.leaderboardOnline.innerHTML = "";

  const renderList = (key, listEl) => {
      let scores = JSON.parse(localStorage.getItem(key)) || {};
      let sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      let lowestHighlightedNode = null;

      sortedScores.forEach(([name, score], index) => {
          let li = document.createElement("li");
          li.innerHTML = `<span>${index + 1}. ${name}</span><span>${score}</span>`;
          
          if (isEndGame && state.players.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
              if ((key === "dondeQueda_scores_local" && state.gameMode === 'local') || 
                  (key === "dondeQueda_scores_online" && state.gameMode === 'online')) {
                  li.classList.add("highlight-gold");
                  lowestHighlightedNode = li;
              }
          }
          listEl.appendChild(li);
      });
      return lowestHighlightedNode;
  };

  const nodeLocal = renderList("dondeQueda_scores_local", UI.leaderboardLocal);
  const nodeOnline = renderList("dondeQueda_scores_online", UI.leaderboardOnline);

  if (isEndGame) {
    UI.endgameActions.style.display = "block";
    UI.standardActions.style.display = "none";

    let targetNode = state.gameMode === 'local' ? nodeLocal : nodeOnline;
    if (targetNode) {
      setTimeout(() => {
        targetNode.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 200);
    }
  } else {
    UI.endgameActions.style.display = "none";
    UI.standardActions.style.display = "block";
  }
}

UI.btnClearScores.addEventListener("click", () => {
  if (
    confirm(
      "¿Estás seguro de que deseas borrar todas las puntuaciones? Esta acción no se puede deshacer.",
    )
  ) {
    localStorage.removeItem("dondeQueda_scores_local");
    localStorage.removeItem("dondeQueda_scores_online");
    renderLeaderboard(false);
  }
});

UI.btnVersusRestart.addEventListener("click", () => {
  state.turn = 1;
  state.currentPlayerIdx = 0;
  state.players.forEach(p => p.score = 0);
  startNewRound();
});

/* =======================================
   MATEMÁTICAS Y COLISIONES
   ======================================= */
function buildBeamString(maxLength, step, wrapMeridian = false) {
  const pts = [];
  for (let d = 0; d <= maxLength; d += step) {
    const p = turf.rhumbDestination(
      state.userLocation,
      d,
      state.currentHeading,
      { units: "kilometers" },
    );
    let lng = p.geometry.coordinates[0];
    let lat = p.geometry.coordinates[1];

    if (isNaN(lng) || isNaN(lat)) break;
    if (lat > 89.5) {
      pts.push([lng, 89.5]);
      break;
    }
    if (lat < -89.5) {
      pts.push([lng, -89.5]);
      break;
    }

    if (wrapMeridian) {
      while (lng > 180) lng -= 360;
      while (lng < -180) lng += 360;
    }
    pts.push([lng, lat]);
  }
  return pts;
}

function breakLinesOnMeridian(linePoints) {
  const lines = [];
  let currentLine = [];
  for (let pt of linePoints) {
    if (currentLine.length > 0) {
      if (Math.abs(pt[0] - currentLine[currentLine.length - 1][0]) > 180) {
        if (currentLine.length > 1) lines.push(turf.lineString(currentLine));
        currentLine = [];
      }
    }
    currentLine.push(pt);
  }
  if (currentLine.length > 1) lines.push(turf.lineString(currentLine));
  return lines;
}

/* =======================================
   RENDERIZADO MAPA DE RESULTADOS
   ======================================= */
function drawResultMap(beamGeometry, isHit, errorLine = null) {
  if (!state.resultMap) {
    state.resultMap = L.map("map-container", {
      zoomControl: false,
      attributionControl: false,
    });
    state.resultMapLayers = L.featureGroup().addTo(state.resultMap);
  }

  state.resultMap.invalidateSize();
  state.resultMapLayers.clearLayers();

  state.resultMap.eachLayer((layer) => {
    if (layer !== state.resultMapLayers) state.resultMap.removeLayer(layer);
  });

  L.geoJSON(state.countriesGeoJSON, { style: COUNTRIES_STYLE }).addTo(
    state.resultMap,
  );

  L.geoJSON(state.targetData, {
    style: {
      fillColor: isHit ? "#22c55e" : "#ef4444",
      weight: 2,
      color: "#ffffff",
      fillOpacity: 0.8,
    },
  }).addTo(state.resultMapLayers);

  state.resultMap.setView([state.userLocation[1], state.userLocation[0]], 2);

  L.geoJSON(beamGeometry, {
    style: { color: isHit ? "#4ade80" : "#f87171", weight: 5, opacity: 0.8 },
  }).addTo(state.resultMapLayers);

  if (errorLine) {
    L.geoJSON(errorLine, {
      style: { color: "#facc15", weight: 3, dashArray: "6, 6", opacity: 0.9 },
    }).addTo(state.resultMapLayers);
  }

  L.circleMarker(
    [state.userLocation[1], state.userLocation[0]],
    MARKER_STYLE,
  ).addTo(state.resultMapLayers);
}