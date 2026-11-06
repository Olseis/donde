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
/* TRES MODOS
   - solo:   Un jugador. Rondas sin fin, sin puntos y sin guardar nada.
   - local:  Salas con código (cada uno en su móvil). Se cuentan los puntos para
             anunciar al ganador, pero no se guarda nada.
   - ranked: Salas con código, con puntos, LP y ligas. Se guarda todo en el servidor.
   Local y Ranked usan el servidor de partidas (online.js). */
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
  gameMode: 'solo', // 'solo' | 'local' | 'ranked'
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
  single: { round: 1 },
  players: [{ name: "", score: 0, hits: 0 }],
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
  location: document.getElementById("location-screen"),
  game: document.getElementById("game-screen"),
  result: document.getElementById("result-screen"),
  online: document.getElementById("online-screen"),
  waiting: document.getElementById("waiting-screen"),
};

const UI = {
  btnModeSolo: document.getElementById("btn-mode-solo"),
  btnModeLocal: document.getElementById("btn-mode-local"),
  btnModeRanked: document.getElementById("btn-mode-ranked"),
  btnShowScores: document.getElementById("btn-show-scores"),
  btnCredits: document.getElementById("btn-credits-float"),
  btnCreditsBack: document.getElementById("btn-back-credits"),

  regionSubtitle: document.getElementById("region-subtitle"),
  menuContainer: document.getElementById("menu-container"),
  startLoading: document.getElementById("start-loading-text"),
  btnBackRegion: document.getElementById("btn-back-region"),

  namesTitle: document.getElementById("names-title"),
  inputP1: document.getElementById("input-p1"),
  btnConfirmNames: document.getElementById("btn-confirm-names"),
  btnBackNames: document.getElementById("btn-back-names"),

  leaderboardWinnerTitle: document.getElementById("leaderboard-winner-title"),
  leaderboardGeneralTitle: document.getElementById("leaderboard-general-title"),
  leaderboardTables: document.getElementById("leaderboard-tables"),
  leaderboardOnline: document.getElementById("leaderboard-list-online"),
  endgameActions: document.getElementById("endgame-actions"),
  standardActions: document.getElementById("standard-actions"),
  btnBackLeaderboard: document.getElementById("btn-back-leaderboard"),
  btnVersusNew: document.getElementById("btn-versus-new"),
  btnVersusExit: document.getElementById("btn-versus-exit"),

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
   NAVEGACIÓN Y PANTALLAS
   ======================================= */
// Local y Ranked juegan en salas del servidor
function isRoomMode() {
  return state.gameMode === 'local' || state.gameMode === 'ranked';
}

function showScreen(screenName) {
  Object.values(screens).forEach((s) => {
      if(s) s.classList.remove("active");
  });
  if(screens[screenName]) screens[screenName].classList.add("active");

  if(UI.btnCredits) UI.btnCredits.style.display = screenName === "start" ? "flex" : "none";
}

function returnToMenu() {
  if (isRoomMode() && typeof Online !== "undefined") Online.disconnect();
  state.gameMode = null;
  showScreen("start");
}

const goToRegionSelect = () => {
  if(UI.menuContainer) UI.menuContainer.style.display = "grid";
  if(UI.startLoading) UI.startLoading.style.display = "none";
  if(UI.btnBackRegion) UI.btnBackRegion.style.display = "";
  if(UI.regionSubtitle) {
    UI.regionSubtitle.textContent =
      state.gameMode === 'ranked' ? "Ranked · nueva sala" :
      state.gameMode === 'local' ? "Local · nueva sala" :
      "Un jugador";
  }
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

        // 1. En el menú principal se cierra la app
        if (activeId === 'start-screen') {
            window.Capacitor.Plugins.App.exitApp();
        }
        // 2. En mitad de una partida de sala, se pide confirmación
        else if (isRoomMode() && ['game-screen', 'result-screen', 'waiting-screen'].includes(activeId)) {
            if (await customConfirm("¿Seguro que quieres abandonar la partida?")) returnToMenu();
        }
        // 3. En cualquier otra pantalla, vuelve al inicio
        else {
            returnToMenu();
        }
    });
}

// Botones de modo
if(UI.btnModeSolo) UI.btnModeSolo.addEventListener("click", () => { state.gameMode = 'solo'; goToRegionSelect(); });

function askNameForRoom(mode) {
  state.gameMode = mode;
  if(UI.namesTitle) UI.namesTitle.textContent = mode === 'ranked' ? "Ranked · tu nombre" : "Local · tu nombre";
  if(UI.inputP1) UI.inputP1.value = localStorage.getItem("dondeQueda_onlineName") || "";
  showScreen("names");
}
if(UI.btnModeLocal) UI.btnModeLocal.addEventListener("click", () => askNameForRoom('local'));
if(UI.btnModeRanked) UI.btnModeRanked.addEventListener("click", () => askNameForRoom('ranked'));

if(UI.btnShowScores) UI.btnShowScores.addEventListener("click", () => { renderLeaderboard(false); showScreen("leaderboard"); });
if(UI.btnCredits) UI.btnCredits.addEventListener("click", () => showScreen("credits"));
if(UI.btnCreditsBack) UI.btnCreditsBack.addEventListener("click", returnToMenu);

if(UI.btnConfirmNames) UI.btnConfirmNames.addEventListener("click", () => {
  const name = UI.inputP1 ? UI.inputP1.value.trim() : "";
  if (!/^[\p{L}\p{N} _.\-]{1,20}$/u.test(name)) {
      alert("Escribe un nombre de 1 a 20 letras o números.");
      if(UI.inputP1) UI.inputP1.focus();
      return;
  }
  state.turn = 1;
  openOnlineLobby(name); // online.js: crear sala o unirse con código
});

if(UI.btnBackNames) UI.btnBackNames.addEventListener("click", returnToMenu);
if(UI.btnBackRegion) UI.btnBackRegion.addEventListener("click", () => {
  if (isRoomMode()) showScreen("online");
  else returnToMenu();
});

document.querySelectorAll(".btn-menu").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const region = e.currentTarget.dataset.region;
    if (!region) return;

    state.continent = region;

    // Salas: se crea en el servidor y él nos lleva a elegir ubicación (online.js)
    if (isRoomMode()) {
      if(UI.regionSubtitle) UI.regionSubtitle.textContent = "Creando sala...";
      Online.createRoom(region).catch(() => {
        alert("No se pudo conectar con el servidor.");
        showScreen("online");
      });
      return;
    }

    state.single = { round: 1 };
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
// "Nueva partida" al acabar una sala: vuelve a crear/unirse con el mismo nombre y modo
if(UI.btnVersusNew) UI.btnVersusNew.addEventListener("click", () => {
  if (isRoomMode()) openOnlineLobby(Online.name || localStorage.getItem("dondeQueda_onlineName") || "");
});

if(UI.btnBackLoc) UI.btnBackLoc.addEventListener("click", () => {
  if (isRoomMode()) { Online.leaveRoom(); showScreen("online"); }
  else goToRegionSelect();
});

if(UI.btnChangeRegion) UI.btnChangeRegion.addEventListener("click", async () => {
  if (!isRoomMode()) { goToRegionSelect(); return; }
  if (await customConfirm("¿Seguro que quieres abandonar la partida?")) returnToMenu();
});

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

    // Salas: no se empieza todavía; se avisa al servidor y se espera al resto
    if (isRoomMode()) {
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
// Solo para el modo Un jugador: en las salas, las rondas las manda el servidor
function startNewRound() {
  if (isRoomMode()) return;
  showScreen("game");
  if(UI.resultErrorDetails) UI.resultErrorDetails.style.display = "none";
  if(UI.turnPointsDisplay) UI.turnPointsDisplay.style.display = "none";
  if(UI.currentPlayerDisplay) UI.currentPlayerDisplay.style.display = "none";
  if(UI.roundInfo) UI.roundInfo.textContent = `Ronda ${state.single.round}`;

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

      // El cálculo está en shot.js, el mismo archivo que usa el servidor en las salas
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

      if (isRoomMode()) {
        // Solo se manda el rumbo: el servidor decide los puntos (online.js)
        onlineShot(state.currentHeading);
      } else {
        // Un jugador: sin puntos
        if(UI.turnPointsDisplay) UI.turnPointsDisplay.style.display = "none";
        if(UI.btnRestart) UI.btnRestart.textContent = "Siguiente ronda";
      }

      setTimeout(() => { drawResultMap(shot.beam, isHit, shot.errorLine); }, 100);
    });
}

if(UI.btnRestart) UI.btnRestart.addEventListener("click", () => {
  if (isRoomMode()) onlineNext();
  else { state.single.round++; startNewRound(); }
});

/* =======================================
   TABLA RANKING
   Solo hay ranking en Ranked: la tabla de tu división, que viene del servidor.
   Al acabar una sala Local se enseña quién ha ganado, pero no se guarda nada.
   ======================================= */
function renderLeaderboard(isEndGame = false) {
  const isRankedEnd = isEndGame && state.gameMode === 'ranked';
  const isLocalEnd = isEndGame && state.gameMode === 'local';

  if (!isEndGame && UI.leaderboardWinnerTitle) UI.leaderboardWinnerTitle.style.display = "none";

  // La tabla de la división solo se ve desde el menú o al acabar una Ranked
  if (UI.leaderboardTables) UI.leaderboardTables.style.display = isLocalEnd ? "none" : "";
  if (UI.leaderboardGeneralTitle) UI.leaderboardGeneralTitle.style.display = isLocalEnd ? "none" : "";
  if (UI.leaderboardOnline && !isLocalEnd) renderOnlineRanking(UI.leaderboardOnline);

  const standingsBox = document.getElementById("match-standings-box");
  if (standingsBox && !isEndGame) standingsBox.style.display = "none";
  const rankBox = document.getElementById("match-rank");
  if (rankBox) rankBox.style.display = isRankedEnd ? "" : "none";

  if(UI.endgameActions) UI.endgameActions.style.display = isEndGame ? "block" : "none";
  if(UI.standardActions) UI.standardActions.style.display = isEndGame ? "none" : "block";
}

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