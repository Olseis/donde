/* =======================================
   CONFIGURACIÓN COMPARTIDA
   ======================================= */

// Rutas relativas: todas las páginas están en src/<Carpeta>/pagina.html,
// así que "../" nos lleva siempre a src/
const RUTAS = {
    inicio:    '../Inicio/index.html',
    creditos:  '../Creditos/creditos.html',
    ubicacion: '../Ubicacion/ubicacion.html',
    juego:     '../Juego/juego.html',
    resultado: '../Resultado/resultado.html'
};

// Lo que antes vivía en "state" ahora se guarda aquí para sobrevivir al cambio de página
const STORAGE = {
    location: 'dondeQueda_location', // localStorage   → tu ubicación (se recuerda siempre)
    session:  'dondeQueda_session',  // sessionStorage → modo y continente elegidos
    round:    'dondeQueda_round',    // sessionStorage → objetivo, rumbo y ubicación al confirmar
    geojson:  'dondeQueda_geojson'   // sessionStorage → caché del mapa de países
};

const GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json';
const GOOGLE_TILES = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
const ESTILO_PAISES = { fillColor: '#1e293b', weight: 1, color: '#334155', fillOpacity: 0.5 };

/* =======================================
   UTILIDADES
   ======================================= */
function irA(pagina) {
    window.location.href = RUTAS[pagina];
}

function leerJSON(storage, key) {
    try {
        const valor = storage.getItem(key);
        return valor ? JSON.parse(valor) : null;
    } catch {
        return null;
    }
}

function guardarJSON(storage, key, valor) {
    try {
        storage.setItem(key, JSON.stringify(valor));
    } catch (error) {
        console.warn(`No se pudo guardar "${key}":`, error);
    }
}

function getSession() {
    return leerJSON(sessionStorage, STORAGE.session) || { mode: 'world', continent: 'Todos' };
}

async function cargarPaises() {
    const enCache = leerJSON(sessionStorage, STORAGE.geojson);
    if (enCache) return enCache;

    const res = await fetch(GEOJSON_URL);
    if (!res.ok) throw new Error('No se pudo descargar el mapa de países');
    const datos = await res.json();
    guardarJSON(sessionStorage, STORAGE.geojson, datos);
    return datos;
}

function pintarMapaBase(map, mode, paises) {
    if (mode === 'spain') {
        L.tileLayer(GOOGLE_TILES).addTo(map);
    } else {
        L.geoJSON(paises, { style: ESTILO_PAISES }).addTo(map);
    }
}

function crearMarcadorUsuario(latlng, mode) {
    return mode === 'spain'
        ? L.marker(latlng)
        : L.circleMarker(latlng, { radius: 5, fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1 });
}

/* =======================================
   ARRANQUE: cada HTML indica qué página es
   con <body data-page="...">
   ======================================= */
document.addEventListener('DOMContentLoaded', () => {
    const paginas = {
        inicio: initInicio,
        creditos: initCreditos,
        ubicacion: initUbicacion,
        juego: initJuego,
        resultado: initResultado
    };
    const init = paginas[document.body.dataset.page];
    if (init) init();
});

/* =======================================
   PÁGINA: INICIO
   ======================================= */
function initInicio() {
    const menu = document.getElementById('menu-container');
    const loading = document.getElementById('start-loading-text');

    document.getElementById('btn-credits-float').addEventListener('click', () => irA('creditos'));

    document.querySelectorAll('.btn-menu').forEach(btn => {
        btn.addEventListener('click', async () => {
            const region = btn.dataset.region;
            if (!region) return;

            if (region === 'España') {
                guardarJSON(sessionStorage, STORAGE.session, { mode: 'spain', continent: null });
                irA('ubicacion');
                return;
            }

            guardarJSON(sessionStorage, STORAGE.session, { mode: 'world', continent: region });
            menu.style.display = 'none';
            loading.style.display = 'block';

            try {
                await cargarPaises();
                irA('ubicacion');
            } catch {
                alert('Error al descargar mapas. Revisa tu conexión.');
                menu.style.display = 'grid';
                loading.style.display = 'none';
            }
        });
    });

    // Si el usuario vuelve con el botón "atrás", el navegador puede restaurar
    // la página con el menú oculto: lo dejamos como al principio
    window.addEventListener('pageshow', () => {
        menu.style.display = 'grid';
        loading.style.display = 'none';
    });
}

/* =======================================
   PÁGINA: CRÉDITOS
   ======================================= */
function initCreditos() {
    document.getElementById('btn-back-credits').addEventListener('click', () => irA('inicio'));
}

/* =======================================
   PÁGINA: UBICACIÓN
   ======================================= */
async function initUbicacion() {
    const { mode } = getSession();
    const btnSaved = document.getElementById('btn-saved-location');
    const btnConfirm = document.getElementById('btn-confirm-location');
    const loading = document.getElementById('location-loading-text');

    const savedLoc = leerJSON(localStorage, STORAGE.location);
    let tempLocation = savedLoc;

    if (savedLoc) {
        btnSaved.style.display = 'block';
        btnConfirm.disabled = false;
    }

    let paises = null;
    if (mode === 'world') {
        try {
            paises = await cargarPaises();
        } catch {
            alert('Error al descargar mapas. Revisa tu conexión.');
            irA('inicio');
            return;
        }
    }

    const center = savedLoc ? [savedLoc[1], savedLoc[0]] : (mode === 'spain' ? [40.0, -3.0] : [20, 0]);
    const zoom = savedLoc ? (mode === 'spain' ? 5 : 4) : (mode === 'spain' ? 5 : 1);

    const map = L.map('select-map-container', { zoomControl: false, attributionControl: false }).setView(center, zoom);
    pintarMapaBase(map, mode, paises);

    let marker = savedLoc ? crearMarcadorUsuario([savedLoc[1], savedLoc[0]], mode).addTo(map) : null;

    map.on('click', (ev) => {
        tempLocation = [ev.latlng.lng, ev.latlng.lat];
        if (marker) marker.setLatLng(ev.latlng);
        else marker = crearMarcadorUsuario(ev.latlng, mode).addTo(map);
        btnConfirm.disabled = false;
    });

    setTimeout(() => map.invalidateSize(), 200);

    async function confirmar(source) {
        loading.style.display = 'block';
        try {
            let ubicacion = null;
            if (source === 'gps') {
                loading.textContent = 'Obteniendo tu GPS...';
                ubicacion = await getUserLocation();
            } else if (source === 'map') {
                loading.textContent = 'Procesando mapa...';
                ubicacion = tempLocation;
            } else if (source === 'saved') {
                loading.textContent = 'Cargando datos...';
                ubicacion = leerJSON(localStorage, STORAGE.location);
            }

            if (!ubicacion) throw new Error('Sin ubicación');

            guardarJSON(localStorage, STORAGE.location, ubicacion);
            irA('juego');
        } catch (error) {
            console.error('Error:', error);
            alert('Hubo un problema. Asegúrate de activar y permitir el uso de la ubicación.');
            loading.style.display = 'none';
        }
    }

    document.getElementById('btn-gps').addEventListener('click', () => confirmar('gps'));
    btnConfirm.addEventListener('click', () => confirmar('map'));
    btnSaved.addEventListener('click', () => confirmar('saved'));
}

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Tu navegador no soporta geolocalización.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
            () => reject(new Error('No se pudo obtener la ubicación.')),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

/* =======================================
   PÁGINA: JUEGO
   ======================================= */
async function initJuego() {
    const { mode, continent } = getSession();
    const userLocation = leerJSON(localStorage, STORAGE.location);

    // Si alguien entra directo a juego.html sin ubicación, lo mandamos a elegirla
    if (!userLocation) {
        irA('ubicacion');
        return;
    }

    let heading = 0;
    let objetivo;

    if (mode === 'spain') {
        const ciudad = citiesData[Math.floor(Math.random() * citiesData.length)];
        objetivo = { name: ciudad.name, lat: ciudad.lat, lng: ciudad.lng };
    } else {
        const paises = await cargarPaises();
        const validos = paises.features.filter(f => {
            const inDict = dictionary[f.id];
            if (!inDict) return false;
            // Evitar que aparezca España en la selección si estamos en "Todos"
            if (continent === 'Todos') return f.id !== 'ESP';
            return inDict.continent === continent;
        });
        const pais = validos[Math.floor(Math.random() * validos.length)];
        // Solo guardamos el id: el polígono se vuelve a buscar en resultado.html
        objetivo = { id: pais.id, name: dictionary[pais.id].name };
    }

    document.getElementById('target-name').textContent = objetivo.name;

    iniciarBrujula((h) => { heading = h; });

    document.getElementById('btn-confirm').addEventListener('click', () => {
        guardarJSON(sessionStorage, STORAGE.round, { objetivo, heading, userLocation });
        irA('resultado');
    });
}

function iniciarBrujula(onHeading) {
    const dial = document.getElementById('compass-dial');
    const debug = document.getElementById('debug-info');

    const handleOrientation = (event) => {
        let heading = null;
        if (event.webkitCompassHeading != null) {
            heading = event.webkitCompassHeading;
        } else if (event.alpha !== null) {
            heading = 360 - event.alpha;
            if (heading === 360) heading = 0;
        }

        if (heading !== null) {
            onHeading(heading);
            dial.style.transform = `rotate(${-heading}deg)`;
            debug.innerText = `Rumbo: ${Math.round(heading)}°`;
        }
    };

    const escuchar = () => {
        window.addEventListener('deviceorientationabsolute', handleOrientation);
        window.addEventListener('deviceorientation', handleOrientation);
    };

    const necesitaPermiso = typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function';

    if (!necesitaPermiso) {
        escuchar();
        return;
    }

    // iOS: el permiso tiene que pedirse con un toque del usuario EN ESTA página
    debug.innerText = 'Toca la pantalla para activar la brújula';
    const pedirPermiso = async () => {
        try {
            const permiso = await DeviceOrientationEvent.requestPermission();
            if (permiso === 'granted') {
                document.removeEventListener('click', pedirPermiso);
                escuchar();
            } else {
                alert('Debes permitir el acceso a la brújula para poder jugar.');
            }
        } catch {
            alert('No se pudo activar la brújula.');
        }
    };
    document.addEventListener('click', pedirPermiso);
}

/* =======================================
   PÁGINA: RESULTADO
   ======================================= */
async function initResultado() {
    const { mode } = getSession();
    const ronda = leerJSON(sessionStorage, STORAGE.round);

    document.getElementById('btn-restart').addEventListener('click', () => irA('juego'));
    document.getElementById('btn-change-region').addEventListener('click', () => irA('inicio'));

    if (!ronda) {
        irA('inicio');
        return;
    }

    const { objetivo, heading, userLocation } = ronda;
    let paises = null;
    let targetFeature = null;
    let targetCenter;

    if (mode === 'spain') {
        targetCenter = L.latLng(objetivo.lat, objetivo.lng);
    } else {
        paises = await cargarPaises();
        targetFeature = paises.features.find(f => f.id === objetivo.id);
        const c = turf.centroid(targetFeature).geometry.coordinates;
        targetCenter = L.latLng(c[1], c[0]);
    }

    const { isHit, beam, targetGeometry } = mode === 'spain'
        ? comprobarCiudad(userLocation, heading, objetivo)
        : comprobarPais(userLocation, heading, targetFeature, targetCenter);

    const titulo = document.getElementById('result-title');
    titulo.textContent = isHit ? 'ACERTASTE ✅' : 'FALLASTE ❌';
    titulo.style.color = isHit ? '#4ade80' : '#f87171';

    const map = dibujarMapaResultado({ mode, paises, userLocation, objetivo, targetGeometry, beam, isHit });
    configurarIndicador(map, targetCenter);
}

/* =======================================
   MATEMÁTICAS Y COLISIONES
   ======================================= */
function comprobarCiudad(userLocation, heading, ciudad) {
    const destino = [ciudad.lng, ciudad.lat];
    const targetPolygon = turf.circle(destino, 20, { units: 'kilometers' });
    const distancia = turf.distance(userLocation, destino, { units: 'kilometers' });
    const rayLengthKm = Math.min(distancia + 500, 4000);

    const linePoints = buildBeamString(userLocation, heading, rayLengthKm, 20);
    const beam = turf.lineString(linePoints);

    let isHit = turf.lineIntersect(beam, targetPolygon).features.length > 0;
    if (turf.booleanPointInPolygon(turf.point(linePoints[0]), targetPolygon)) isHit = true;

    return { isHit, beam, targetGeometry: targetPolygon };
}

function comprobarPais(userLocation, heading, pais, centro) {
    const distancia = turf.distance(userLocation, [centro.lng, centro.lat], { units: 'kilometers' });
    const rayLengthKm = Math.min(distancia + 1500, 20000);

    const linePoints = buildBeamString(userLocation, heading, rayLengthKm, 100, true);
    const beam = turf.featureCollection(breakLinesOnMeridian(linePoints));

    let isHit = false;
    turf.featureEach(turf.flatten(pais), (parte) => {
        turf.featureEach(beam, (linea) => {
            if (turf.lineIntersect(linea, parte).features.length > 0) isHit = true;
            if (turf.booleanPointInPolygon(turf.point(linea.geometry.coordinates[0]), parte)) isHit = true;
        });
    });

    return { isHit, beam, targetGeometry: pais };
}

function buildBeamString(origen, heading, maxLength, step, wrapMeridian = false) {
    const pts = [];
    for (let d = 0; d <= maxLength; d += step) {
        const p = turf.rhumbDestination(origen, d, heading, { units: 'kilometers' });
        let [lng, lat] = p.geometry.coordinates;

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
    for (const pt of linePoints) {
        if (currentLine.length > 0 && Math.abs(pt[0] - currentLine[currentLine.length - 1][0]) > 180) {
            if (currentLine.length > 1) lines.push(turf.lineString(currentLine));
            currentLine = [];
        }
        currentLine.push(pt);
    }
    if (currentLine.length > 1) lines.push(turf.lineString(currentLine));
    return lines;
}

/* =======================================
   RENDERIZADO MAPA DE RESULTADOS
   ======================================= */
function dibujarMapaResultado({ mode, paises, userLocation, objetivo, targetGeometry, beam, isHit }) {
    const map = L.map('map-container', { zoomControl: false, attributionControl: false });
    pintarMapaBase(map, mode, paises);
    const capas = L.featureGroup().addTo(map);

    L.geoJSON(targetGeometry, {
        style: { fillColor: isHit ? '#22c55e' : '#ef4444', weight: 2, color: '#ffffff', fillOpacity: 0.8 }
    }).addTo(capas);

    if (mode === 'spain') {
        L.circleMarker([objetivo.lat, objetivo.lng], {
            radius: 4, fillColor: '#000000', color: '#000000', weight: 1, fillOpacity: 1
        }).addTo(capas);

        const bounds = L.latLngBounds([
            [userLocation[1], userLocation[0]],
            [objetivo.lat, objetivo.lng]
        ]);
        map.fitBounds(bounds, { padding: [30, 30] });
    } else {
        map.setView([userLocation[1], userLocation[0]], 2);
    }

    // Rayo y usuario (común en ambos modos)
    L.geoJSON(beam, {
        style: { color: isHit ? '#facc15' : '#64748b', weight: 5, opacity: 0.8 }
    }).addTo(capas);

    L.circleMarker([userLocation[1], userLocation[0]], {
        radius: mode === 'spain' ? 6 : 5,
        fillColor: '#3b82f6', color: '#ffffff', weight: 2, fillOpacity: 1
    }).addTo(capas);

    setTimeout(() => map.invalidateSize(), 100);
    return map;
}

/* =======================================
   INDICADOR FUERA DE PANTALLA
   ======================================= */
function configurarIndicador(map, targetCenter) {
    const actualizar = () => actualizarIndicador(map, targetCenter);
    map.on('move', actualizar);
    actualizar();
}

function actualizarIndicador(map, targetCenter) {
    const indicator = document.getElementById('offscreen-indicator');

    if (map.getBounds().contains(targetCenter)) {
        indicator.style.display = 'none';
        return;
    }
    indicator.style.display = 'flex';

    const centerPixel = map.latLngToContainerPoint(map.getCenter());
    const targetPixel = map.latLngToContainerPoint(targetCenter);
    const angleRad = Math.atan2(targetPixel.y - centerPixel.y, targetPixel.x - centerPixel.x);
    indicator.style.transform = `rotate(${angleRad * (180 / Math.PI)}deg)`;

    const rect = document.getElementById('map-wrapper').getBoundingClientRect();
    const radiusX = (rect.width / 2) - 25;
    const radiusY = (rect.height / 2) - 25;
    let x = Math.cos(angleRad) * radiusX;
    let y = Math.sin(angleRad) * radiusY;

    if (Math.abs(x) > radiusX) { x = Math.sign(x) * radiusX; y = x * Math.tan(angleRad); }
    if (Math.abs(y) > radiusY) { y = Math.sign(y) * radiusY; x = y / Math.tan(angleRad); }

    indicator.style.left = `calc(50% + ${x}px - 22px)`;
    indicator.style.top = `calc(50% + ${y}px - 22px)`;
}
