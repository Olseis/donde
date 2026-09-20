/* =======================================
   ESTADO GLOBAL DEL JUEGO
   ======================================= */
const state = {
    mode: 'world', // 'world' o 'spain'
    continent: 'Todos',
    userLocation: null,
    tempLocation: null,
    currentHeading: 0,
    targetData: null, 
    targetCenterLatLng: null, 
    countriesGeoJSON: null,
    
    // Variables Modo Versus
    isVersus: false,
    players: [{name: '', score: 0}, {name: '', score: 0}],
    currentPlayerIdx: 0,
    turn: 1, // Max 10 (5 por jugador)

    // Elementos de mapas
    selectionMap: null,
    selectionMarker: null,
    resultMap: null,
    resultMapLayers: null
};

/* =======================================
   REFERENCIAS AL DOM
   ======================================= */
const screens = {
    start: document.getElementById('start-screen'),
    credits: document.getElementById('credits-screen'),
    names: document.getElementById('names-screen'),
    leaderboard: document.getElementById('leaderboard-screen'),
    location: document.getElementById('location-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen')
};

const UI = {
    // Menú Principal y Extras
    btnCredits: document.getElementById('btn-credits-float'),
    btnCreditsBack: document.getElementById('btn-back-credits'),
    menuContainer: document.getElementById('menu-container'),
    startLoading: document.getElementById('start-loading-text'),
    toggleVersus: document.getElementById('toggle-versus'),
    btnShowScores: document.getElementById('btn-show-scores'),
    
    // Pantalla Nombres Versus
    inputP1: document.getElementById('input-p1'),
    inputP2: document.getElementById('input-p2'),
    btnConfirmNames: document.getElementById('btn-confirm-names'),
    btnBackNames: document.getElementById('btn-back-names'),
    
    // Pantalla Leaderboard
    leaderboardList: document.getElementById('leaderboard-list'),
    endgameActions: document.getElementById('endgame-actions'),
    standardActions: document.getElementById('standard-actions'),
    btnBackLeaderboard: document.getElementById('btn-back-leaderboard'),
    btnClearScores: document.getElementById('btn-clear-scores'),
    btnVersusRestart: document.getElementById('btn-versus-restart'),
    btnVersusExit: document.getElementById('btn-versus-exit'),
    
    // Pantalla Ubicación
    btnSavedLoc: document.getElementById('btn-saved-location'),
    btnConfirmLoc: document.getElementById('btn-confirm-location'),
    btnBackLoc: document.getElementById('btn-back-loc'),
    locLoading: document.getElementById('location-loading-text'),
    
    // Pantalla Juego
    currentPlayerDisplay: document.getElementById('current-player-display'),
    compassDial: document.getElementById('compass-dial'),
    debugInfo: document.getElementById('debug-info'),
    targetName: document.getElementById('target-name'),
    
    // Pantalla Resultados
    resultTitle: document.getElementById('result-title'),
    turnPointsDisplay: document.getElementById('turn-points-display'),
    resultErrorDetails: document.getElementById('result-error-details'),
    btnRestart: document.getElementById('btn-restart'),
    btnChangeRegion: document.getElementById('btn-change-region')
};

/* =======================================
   NAVEGACIÓN Y PANTALLAS
   ======================================= */
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
    
    // Ocultar botón de créditos flotante si no es inicio
    UI.btnCredits.style.display = screenName === 'start' ? 'flex' : 'none';
}

function returnToMenu() {
    UI.menuContainer.style.display = 'grid';
    showScreen('start');
}

// Toggle botón Puntuaciones
UI.toggleVersus.addEventListener('change', (e) => {
    UI.btnShowScores.style.display = e.target.checked ? 'block' : 'none';
});

UI.btnCredits.addEventListener('click', () => showScreen('credits'));
UI.btnCreditsBack.addEventListener('click', returnToMenu);
UI.btnBackNames.addEventListener('click', returnToMenu);
UI.btnBackLeaderboard.addEventListener('click', returnToMenu);

UI.btnBackLoc.addEventListener('click', () => { 
    state.isVersus = false; 
    returnToMenu(); 
});

UI.btnChangeRegion.addEventListener('click', () => {
    state.isVersus = false;
    returnToMenu();
});

UI.btnVersusExit.addEventListener('click', () => {
    state.isVersus = false;
    returnToMenu();
});

// Seleccionador del Menú
document.querySelectorAll('.btn-menu').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const region = e.target.dataset.region;
        if (!region) return;

        state.mode = region === "España" ? 'spain' : 'world';
        state.continent = region === "España" ? "Todos" : region;

        if (UI.toggleVersus.checked) {
            showScreen('names');
        } else {
            state.isVersus = false;
            await loadAssetsAndPrepareLoc();
        }
    });
});

UI.btnConfirmNames.addEventListener('click', async () => {
    const p1 = UI.inputP1.value.trim() || "Jugador 1";
    const p2 = UI.inputP2.value.trim() || "Jugador 2";
    
    state.isVersus = true;
    state.players = [{name: p1, score: 0}, {name: p2, score: 0}];
    state.currentPlayerIdx = 0;
    state.turn = 1;
    
    await loadAssetsAndPrepareLoc();
});

async function loadAssetsAndPrepareLoc() {
    if (state.mode === 'world') {
        UI.menuContainer.style.display = 'none';
        if(state.isVersus) screens.names.classList.remove('active');
        screens.start.classList.add('active');
        UI.startLoading.style.display = 'block';

        if (!state.countriesGeoJSON) {
            try {
                let geoRes = await fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json');
                state.countriesGeoJSON = await geoRes.json();
            } catch (error) {
                alert("Error al descargar mapas. Revisa tu conexión.");
                UI.menuContainer.style.display = 'grid';
                UI.startLoading.style.display = 'none';
                return;
            }
        }
        UI.startLoading.style.display = 'none';
    }
    prepareLocationScreen();
}

/* =======================================
   PREPARACIÓN Y SELECCIÓN DE UBICACIÓN
   ======================================= */
function prepareLocationScreen() {
    showScreen('location');
    
    const savedLocStr = localStorage.getItem('dondeQueda_location');
    let savedLoc = null;
    
    if (savedLocStr) {
        savedLoc = JSON.parse(savedLocStr);
        state.tempLocation = savedLoc;
        UI.btnSavedLoc.style.display = 'block'; 
        UI.btnConfirmLoc.disabled = false; 
    }

    if (!state.selectionMap) {
        const startCenter = savedLoc ? [savedLoc[1], savedLoc[0]] : (state.mode === 'spain' ? [40.0, -3.0] : [20, 0]);
        const startZoom = savedLoc ? (state.mode === 'spain' ? 5 : 4) : (state.mode === 'spain' ? 5 : 1);
        
        state.selectionMap = L.map('select-map-container', { zoomControl: false, attributionControl: false }).setView(startCenter, startZoom);
        
        if (state.mode === 'spain') {
            L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(state.selectionMap);
        } else {
            L.geoJSON(state.countriesGeoJSON, {
                style: { fillColor: '#1e293b', weight: 1, color: '#334155', fillOpacity: 0.5 }
            }).addTo(state.selectionMap);
        }
        
        if (savedLoc) {
            state.selectionMarker = state.mode === 'spain' 
                ? L.marker([savedLoc[1], savedLoc[0]]).addTo(state.selectionMap)
                : L.circleMarker([savedLoc[1], savedLoc[0]], { radius: 5, fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1 }).addTo(state.selectionMap);
        }

        state.selectionMap.on('click', (ev) => {
            state.tempLocation = [ev.latlng.lng, ev.latlng.lat];
            
            if (!state.selectionMarker) {
                state.selectionMarker = state.mode === 'spain'
                    ? L.marker(ev.latlng).addTo(state.selectionMap)
                    : L.circleMarker(ev.latlng, { radius: 5, fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1 }).addTo(state.selectionMap);
            } else {
                state.selectionMarker.setLatLng(ev.latlng);
            }
            UI.btnConfirmLoc.disabled = false;
        });
    } else {
        state.selectionMap.eachLayer((layer) => state.selectionMap.removeLayer(layer));
        const center = savedLoc ? [savedLoc[1], savedLoc[0]] : (state.mode === 'spain' ? [40.0, -3.0] : [20, 0]);
        const zoom = savedLoc ? (state.mode === 'spain' ? 5 : 4) : (state.mode === 'spain' ? 5 : 1);
        state.selectionMap.setView(center, zoom);

        if (state.mode === 'spain') {
            L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(state.selectionMap);
        } else {
            L.geoJSON(state.countriesGeoJSON, {
                style: { fillColor: '#1e293b', weight: 1, color: '#334155', fillOpacity: 0.5 }
            }).addTo(state.selectionMap);
        }

        if (state.tempLocation) {
            state.selectionMarker = state.mode === 'spain'
                ? L.marker([state.tempLocation[1], state.tempLocation[0]]).addTo(state.selectionMap)
                : L.circleMarker([state.tempLocation[1], state.tempLocation[0]], { radius: 5, fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1 }).addTo(state.selectionMap);
        }
    }
    
    setTimeout(() => state.selectionMap.invalidateSize(), 200); 
}

/* =======================================
   INICIALIZACIÓN SESIÓN / GPS / BRÚJULA
   ======================================= */
async function initializeGameSession(source) {
    UI.locLoading.style.display = 'block';
    
    try {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') {
                alert("Debes permitir el acceso a la brújula para poder jugar.");
                UI.locLoading.style.display = 'none';
                return; 
            }
        }

        if (source === 'gps') {
            UI.locLoading.textContent = "Obteniendo tu GPS...";
            state.userLocation = await getUserLocation();
        } else if (source === 'map') {
            UI.locLoading.textContent = "Procesando mapa...";
            state.userLocation = state.tempLocation;
        } else if (source === 'saved') {
            UI.locLoading.textContent = "Cargando datos...";
            state.userLocation = JSON.parse(localStorage.getItem('dondeQueda_location'));
        }

        if (state.userLocation) {
            localStorage.setItem('dondeQueda_location', JSON.stringify(state.userLocation));
        }

        startCompass();
        startNewRound();
        UI.locLoading.style.display = 'none';
        
    } catch (error) {
        console.error("Error:", error);
        alert("Hubo un problema. Asegúrate de activar y permitir el uso de la ubicación.");
        UI.locLoading.style.display = 'none';
    }
}

document.getElementById('btn-gps').addEventListener('click', () => initializeGameSession('gps'));
document.getElementById('btn-confirm-location').addEventListener('click', () => initializeGameSession('map'));
document.getElementById('btn-saved-location').addEventListener('click', () => initializeGameSession('saved'));

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error("Tu navegador no soporta geolocalización."));
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
            (err) => reject(new Error("No se pudo obtener la ubicación.")),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

function startCompass() {
    window.addEventListener('deviceorientationabsolute', handleOrientation);
    window.addEventListener('deviceorientation', handleOrientation);
}

function handleOrientation(event) {
    let heading = null;
    if (event.webkitCompassHeading != null) heading = event.webkitCompassHeading;
    else if (event.alpha !== null) { heading = 360 - event.alpha; if (heading === 360) heading = 0; }

    if (heading !== null) {
        state.currentHeading = heading;
        UI.compassDial.style.transform = `rotate(${-heading}deg)`;
        UI.debugInfo.innerText = `Rumbo: ${Math.round(heading)}°`;
    }
}

/* =======================================
   LÓGICA DEL JUEGO
   ======================================= */
function startNewRound() {
    showScreen('game');
    UI.resultErrorDetails.style.display = 'none';
    UI.turnPointsDisplay.style.display = 'none';

    if (state.isVersus) {
        UI.currentPlayerDisplay.textContent = `Turno de ${state.players[state.currentPlayerIdx].name}`;
        UI.currentPlayerDisplay.style.display = 'block';
    } else {
        UI.currentPlayerDisplay.style.display = 'none';
    }
    
    if (state.mode === 'spain') {
        state.targetData = citiesData[Math.floor(Math.random() * citiesData.length)];
        UI.targetName.textContent = state.targetData.name;
        state.targetCenterLatLng = L.latLng(state.targetData.lat, state.targetData.lng);
    } else {
        const validCountries = state.countriesGeoJSON.features.filter(f => {
            const inDict = dictionary[f.id];
            if (!inDict) return false;
            if (state.continent === "Todos" && f.id === "ESP") return false;
            if (state.continent === "Todos") return true;
            return inDict.continent === state.continent;
        });
        state.targetData = validCountries[Math.floor(Math.random() * validCountries.length)];
        UI.targetName.textContent = dictionary[state.targetData.id].name;
        
        const center = turf.centroid(state.targetData).geometry.coordinates;
        state.targetCenterLatLng = L.latLng(center[1], center[0]);
    }
}

document.getElementById('btn-confirm').addEventListener('click', () => {
    showScreen('result');
    
    let isHit = false;
    let exactCollisionBeam = null;
    let errorLine = null;

    if (state.mode === 'spain') {
        const targetPolygon = turf.circle([state.targetData.lng, state.targetData.lat], 20, {units: 'kilometers'});
        state.targetData.polygonGeometry = targetPolygon;

        const distanceToTarget = turf.distance(state.userLocation, [state.targetData.lng, state.targetData.lat], {units: 'kilometers'});
        const rayLengthKm = Math.min(distanceToTarget + 500, 4000); 
        
        const linePoints = buildBeamString(rayLengthKm, 20);
        exactCollisionBeam = turf.lineString(linePoints);
        
        const intersections = turf.lineIntersect(exactCollisionBeam, targetPolygon);
        if (intersections.features.length > 0) isHit = true;
        
        const startPoint = turf.point(linePoints[0]);
        if (turf.booleanPointInPolygon(startPoint, targetPolygon)) isHit = true;

    } else {
        const distanceToTarget = turf.distance(state.userLocation, [state.targetCenterLatLng.lng, state.targetCenterLatLng.lat], {units: 'kilometers'});
        const rayLengthKm = Math.min(distanceToTarget + 1500, 20000); 
        
        const linePoints = buildBeamString(rayLengthKm, 100, true);
        const lines = breakLinesOnMeridian(linePoints);
        exactCollisionBeam = turf.featureCollection(lines);

        const flattenedCountry = turf.flatten(state.targetData);
        turf.featureEach(flattenedCountry, function (countryPart) {
            turf.featureEach(exactCollisionBeam, function (linePart) {
                const intersections = turf.lineIntersect(linePart, countryPart);
                if (intersections.features.length > 0) isHit = true;
                
                const startPoint = turf.point(linePart.geometry.coordinates[0]);
                if (turf.booleanPointInPolygon(startPoint, countryPart)) isHit = true;
            });
        });
    }

    // Calcular error de rumbo para sistema de puntuación
    const idealBearing = turf.bearing(state.userLocation, [state.targetCenterLatLng.lng, state.targetCenterLatLng.lat]);
    let headingNorm = state.currentHeading % 360;
    let bearingNorm = idealBearing < 0 ? 360 + idealBearing : idealBearing;
    
    let errorAngle = Math.abs(headingNorm - bearingNorm);
    if (errorAngle > 180) errorAngle = 360 - errorAngle;

    let turnPoints = 0;

    if (isHit) { 
        UI.resultTitle.textContent = "ACERTASTE ✅"; 
        UI.resultTitle.style.color = "#4ade80"; 
        UI.resultErrorDetails.style.display = 'none';
        turnPoints = 100;
    } else { 
        UI.resultTitle.textContent = "FALLASTE ❌"; 
        UI.resultTitle.style.color = "#f87171"; 
        
        // Puntuación si fallas pero aciertas el cuadrante
        if (errorAngle <= 90) turnPoints = Math.round(75 * (1 - (errorAngle / 90)));
        else turnPoints = 0;

        let minDistance = Infinity;
        let closestCountryPt = null;
        
        let targetGeom = state.mode === 'spain' ? state.targetData.polygonGeometry : state.targetData;
        const vertices = turf.explode(targetGeom);
        const userPt = turf.point(state.userLocation);
        
        turf.featureEach(vertices, function(pointFeature) {
            const dist = turf.distance(userPt, pointFeature, {units: 'kilometers'});
            if (dist < minDistance) {
                minDistance = dist;
                closestCountryPt = pointFeature;
            }
        });

        if (closestCountryPt) {
            let pt2 = closestCountryPt.geometry.coordinates;
            if (state.userLocation[0] - pt2[0] > 180) pt2 = [pt2[0] + 360, pt2[1]];
            else if (pt2[0] - state.userLocation[0] > 180) pt2 = [pt2[0] - 360, pt2[1]];
            errorLine = turf.lineString([state.userLocation, pt2]);
        }

        UI.resultErrorDetails.innerHTML = `Te faltaron aprox: <b>${Math.round(minDistance)} km</b>`;
        UI.resultErrorDetails.style.display = 'block';
    }

    if (state.isVersus) {
        state.players[state.currentPlayerIdx].score += turnPoints;
        UI.turnPointsDisplay.textContent = `+${turnPoints} Puntos`;
        UI.turnPointsDisplay.style.display = 'block';
        
        if (state.turn >= 10) UI.btnRestart.textContent = "Ver Puntuaciones";
        else UI.btnRestart.textContent = "Siguiente Turno";
    } else {
        UI.btnRestart.textContent = "Siguiente Destino";
    }

    setTimeout(() => { drawResultMap(exactCollisionBeam, isHit, errorLine); }, 100);
});

UI.btnRestart.addEventListener('click', () => {
    if (state.isVersus) {
        if (state.turn >= 10) {
            saveScores();
            renderLeaderboard(true);
            showScreen('leaderboard');
        } else {
            state.turn++;
            state.currentPlayerIdx = (state.currentPlayerIdx + 1) % 2;
            startNewRound();
        }
    } else {
        startNewRound();
    }
});

/* =======================================
   LEADERBOARD Y PUNTUACIONES
   ======================================= */
function saveScores() {
    let scores = JSON.parse(localStorage.getItem('dondeQueda_scores')) || {};
    state.players.forEach(p => {
        let nameToSave = p.name.trim();
        if(nameToSave === "") return;
        
        // Busca si el jugador existe ignorando mayúsculas/minúsculas
        let existingKey = Object.keys(scores).find(k => k.toLowerCase() === nameToSave.toLowerCase());
        let keyToUse = existingKey || nameToSave; 
        
        if (!scores[keyToUse] || p.score > scores[keyToUse]) {
            scores[keyToUse] = p.score;
        }
    });
    localStorage.setItem('dondeQueda_scores', JSON.stringify(scores));
}

function renderLeaderboard(isEndGame = false) {
    UI.leaderboardList.innerHTML = '';
    let scores = JSON.parse(localStorage.getItem('dondeQueda_scores')) || {};
    let sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    
    let lowestHighlightedNode = null;

    sortedScores.forEach(([name, score], index) => {
        let li = document.createElement('li');
        li.innerHTML = `<span>${index + 1}. ${name}</span><span>${score}</span>`;
        
        // Match ignorando mayúsculas para resaltar al final de la partida
        if (isEndGame && state.players.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) {
            li.classList.add('highlight-gold');
            lowestHighlightedNode = li;
        }
        
        UI.leaderboardList.appendChild(li);
    });

    if (isEndGame) {
        UI.endgameActions.style.display = 'block';
        UI.standardActions.style.display = 'none';
        
        if (lowestHighlightedNode) {
            setTimeout(() => { 
                lowestHighlightedNode.scrollIntoView({behavior: 'smooth', block: 'nearest'}); 
            }, 200);
        }
    } else {
        UI.endgameActions.style.display = 'none';
        UI.standardActions.style.display = 'block';
    }
}

UI.btnShowScores.addEventListener('click', () => {
    renderLeaderboard(false);
    showScreen('leaderboard');
});

UI.btnClearScores.addEventListener('click', () => {
    if (confirm("¿Estás seguro de que deseas borrar todas las puntuaciones? Esta acción no se puede deshacer.")) {
        localStorage.removeItem('dondeQueda_scores');
        renderLeaderboard(false);
    }
});

UI.btnVersusRestart.addEventListener('click', () => {
    state.turn = 1;
    state.currentPlayerIdx = 0;
    state.players[0].score = 0;
    state.players[1].score = 0;
    startNewRound();
});

/* =======================================
   MATEMÁTICAS Y COLISIONES
   ======================================= */
function buildBeamString(maxLength, step, wrapMeridian = false) {
    const pts = [];
    for(let d = 0; d <= maxLength; d += step) {
        const p = turf.rhumbDestination(state.userLocation, d, state.currentHeading, {units: 'kilometers'});
        let lng = p.geometry.coordinates[0];
        let lat = p.geometry.coordinates[1];
        
        if (isNaN(lng) || isNaN(lat)) break;
        if (lat > 89.5) { pts.push([lng, 89.5]); break; }
        if (lat < -89.5) { pts.push([lng, -89.5]); break; }

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
        state.resultMap = L.map('map-container', { zoomControl: false, attributionControl: false }); 
        state.resultMapLayers = L.featureGroup().addTo(state.resultMap); 
    }

    state.resultMap.invalidateSize();
    state.resultMapLayers.clearLayers();
    
    state.resultMap.eachLayer(layer => {
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
        L.geoJSON(state.countriesGeoJSON, {
            style: { fillColor: '#1e293b', weight: 1, color: '#334155', fillOpacity: 0.5 }
        }).addTo(state.resultMap);

        L.geoJSON(state.targetData, {
            style: { fillColor: isHit ? '#22c55e' : '#ef4444', weight: 2, color: '#ffffff', fillOpacity: 0.8 }
        }).addTo(state.resultMapLayers);

        state.resultMap.setView([state.userLocation[1], state.userLocation[0]], 2);
    }

    L.geoJSON(beamGeometry, {
        style: { color: isHit ? '#4ade80' : '#f87171', weight: 5, opacity: 0.8 }
    }).addTo(state.resultMapLayers);

    if (errorLine) {
        L.geoJSON(errorLine, {
            style: { color: '#facc15', weight: 3, dashArray: '6, 6', opacity: 0.9 }
        }).addTo(state.resultMapLayers);
    }

    L.circleMarker([state.userLocation[1], state.userLocation[0]], {
        radius: state.mode === 'spain' ? 6 : 5, 
        fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1
    }).addTo(state.resultMapLayers);
}