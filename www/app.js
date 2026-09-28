/* =======================================
   ESTADO GLOBAL DEL JUEGO
   ======================================= */
const state = {
    mode: 'world', // 'world' o 'spain'
    continent: 'Todos',
    userLocation: null,
    tempLocation: null,
    currentHeading: 0,
    targetData: null, // Guardará la ciudad (spain) o el polígono geojson (world)
    targetCenterLatLng: null, // Para el indicador
    countriesGeoJSON: null,
    
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
    location: document.getElementById('location-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen')
};

const UI = {
    btnCredits: document.getElementById('btn-credits-float'),
    btnCreditsBack: document.getElementById('btn-back-credits'),
    menuContainer: document.getElementById('menu-container'),
    startLoading: document.getElementById('start-loading-text'),
    btnSavedLoc: document.getElementById('btn-saved-location'),
    btnConfirmLoc: document.getElementById('btn-confirm-location'),
    locLoading: document.getElementById('location-loading-text'),
    compassDial: document.getElementById('compass-dial'),
    debugInfo: document.getElementById('debug-info'),
    targetName: document.getElementById('target-name'),
    resultTitle: document.getElementById('result-title'),
    indicator: document.getElementById('offscreen-indicator')
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

UI.btnCredits.addEventListener('click', () => showScreen('credits'));
UI.btnCreditsBack.addEventListener('click', () => showScreen('start'));

// Seleccionador del Menú
document.querySelectorAll('.btn-menu').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const region = e.target.dataset.region;
        if (!region) return;

        if (region === "España") {
            state.mode = 'spain';
            prepareLocationScreen();
        } else {
            state.mode = 'world';
            state.continent = region;
            
            UI.menuContainer.style.display = 'none';
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
            prepareLocationScreen();
        }
    });
});

document.getElementById('btn-change-region').addEventListener('click', () => {
    UI.indicator.style.display = 'none';
    UI.menuContainer.style.display = 'grid'; 
    showScreen('start');
});

document.getElementById('btn-restart').addEventListener('click', () => {
    UI.indicator.style.display = 'none';
    startNewRound();
});

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
        
        // Asignar los estilos según el modo
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
        // Limpiar el mapa existente y rehacer la vista si cambiamos de modo
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
    
    if (state.mode === 'spain') {
        state.targetData = citiesData[Math.floor(Math.random() * citiesData.length)];
        UI.targetName.textContent = state.targetData.name;
        state.targetCenterLatLng = L.latLng(state.targetData.lat, state.targetData.lng);
    } else {
        const validCountries = state.countriesGeoJSON.features.filter(f => {
            const inDict = dictionary[f.id];
            if (!inDict) return false;
            // Evitar que aparezca España en la selección si estamos en "Todos"
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

    if (state.mode === 'spain') {
        const targetPolygon = turf.circle([state.targetData.lng, state.targetData.lat], 20, {units: 'kilometers'});
        const distanceToTarget = turf.distance(state.userLocation, [state.targetData.lng, state.targetData.lat], {units: 'kilometers'});
        const rayLengthKm = Math.min(distanceToTarget + 500, 4000); 
        
        const linePoints = buildBeamString(rayLengthKm, 20);
        exactCollisionBeam = turf.lineString(linePoints);
        
        const intersections = turf.lineIntersect(exactCollisionBeam, targetPolygon);
        if (intersections.features.length > 0) isHit = true;
        
        const startPoint = turf.point(linePoints[0]);
        if (turf.booleanPointInPolygon(startPoint, targetPolygon)) isHit = true;
        
        // Guardamos el polígono en targetData para usarlo al dibujar
        state.targetData.polygonGeometry = targetPolygon;

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

    if (isHit) { 
        UI.resultTitle.textContent = "ACERTASTE ✅"; 
        UI.resultTitle.style.color = "#4ade80"; 
    } else { 
        UI.resultTitle.textContent = "FALLASTE ❌"; 
        UI.resultTitle.style.color = "#f87171"; 
    }

    setTimeout(() => { drawResultMap(exactCollisionBeam, isHit); }, 100);
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
function drawResultMap(beamGeometry, isHit) {
    if (!state.resultMap) { 
        state.resultMap = L.map('map-container', { zoomControl: false, attributionControl: false }); 
        state.resultMapLayers = L.featureGroup().addTo(state.resultMap); 
    }

    state.resultMap.invalidateSize();
    state.resultMapLayers.clearLayers();
    
    // Si la anterior vez se cargaron tiles o polígonos base, limpiamos todas las capas subyacentes.
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

    // Dibujar el rayo y al usuario (común en ambos)
    L.geoJSON(beamGeometry, {
        style: { color: isHit ? '#facc15' : '#64748b', weight: 5, opacity: 0.8 }
    }).addTo(state.resultMapLayers);

    L.circleMarker([state.userLocation[1], state.userLocation[0]], {
        radius: state.mode === 'spain' ? 6 : 5, 
        fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1
    }).addTo(state.resultMapLayers);

    setupOffscreenIndicator();
}

/* =======================================
   INDICADOR FUERA DE PANTALLA
   ======================================= */
function setupOffscreenIndicator() {
    state.resultMap.off('move'); 
    state.resultMap.on('move', () => updateIndicatorPosition());
    updateIndicatorPosition(); 
}

function updateIndicatorPosition() {
    const bounds = state.resultMap.getBounds();
    if (bounds.contains(state.targetCenterLatLng)) { 
        UI.indicator.style.display = 'none'; 
        return; 
    }
    
    UI.indicator.style.display = 'flex';
    
    const centerPixel = state.resultMap.latLngToContainerPoint(state.resultMap.getCenter());
    const targetPixel = state.resultMap.latLngToContainerPoint(state.targetCenterLatLng);
    const angleRad = Math.atan2(targetPixel.y - centerPixel.y, targetPixel.x - centerPixel.x);
    UI.indicator.style.transform = `rotate(${angleRad * (180 / Math.PI)}deg)`;

    const rect = document.getElementById('map-wrapper').getBoundingClientRect();
    const radiusX = (rect.width / 2) - 25, radiusY = (rect.height / 2) - 25;
    let x = Math.cos(angleRad) * radiusX, y = Math.sin(angleRad) * radiusY;

    if (Math.abs(x) > radiusX) { x = Math.sign(x) * radiusX; y = x * Math.tan(angleRad); }
    if (Math.abs(y) > radiusY) { y = Math.sign(y) * radiusY; x = y / Math.tan(angleRad); }

    UI.indicator.style.left = `calc(50% + ${x}px - 22px)`; 
    UI.indicator.style.top = `calc(50% + ${y}px - 22px)`;
}