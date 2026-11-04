/* =======================================
   REGLAS DEL JUEGO EN EL SERVIDOR

   Lee los mismos datos que el móvil (www/data.js) y usa el mismo
   cálculo de disparo (www/shot.js). Así, si cambiáis un país o la
   puntuación en el juego, el servidor lo aplica igual sin tocar nada.
   ======================================= */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const turf = require("@turf/turf");

const WWW_DIR = process.env.WWW_DIR || path.join(__dirname, "..", "www");
const COUNTRIES_PATH =
  process.env.COUNTRIES_PATH || path.join(__dirname, "data", "countries.geo.json");

const { judgeShot } = require(path.join(WWW_DIR, "shot.js"));

// data.js es un script de navegador con "const dictionary = {...}".
// Lo ejecutamos en una caja aislada y le pedimos que nos devuelva las dos variables.
function loadGameData() {
  const code = fs.readFileSync(path.join(WWW_DIR, "data.js"), "utf8");
  const sandbox = vm.createContext({});
  return vm.runInContext(
    `${code}\n;({ dictionary, citiesData: typeof citiesData !== "undefined" ? citiesData : [] })`,
    sandbox,
    { timeout: 1000 },
  );
}

const { dictionary, citiesData } = loadGameData();
const countries = JSON.parse(fs.readFileSync(COUNTRIES_PATH, "utf8"));
const countriesById = new Map(countries.features.map((f) => [f.id, f]));

const REGIONS = ["Todos", "América", "Europa", "Asia", "África", "Oceanía", "España"];

function modeForRegion(region) {
  return region === "España" ? "spain" : "world";
}

function countryAt(location) {
  const pt = turf.point(location);
  const found = countries.features.find((f) => {
    try {
      return turf.booleanPointInPolygon(pt, f);
    } catch {
      return false;
    }
  });
  return found ? found.id : null;
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Elige los destinos de toda la partida de una vez.
 * Igual que en el móvil: en "Todo el mundo" no sale España, y nunca sale
 * el país desde el que juega alguno de los jugadores.
 */
function pickTargets(region, playerLocations, count) {
  if (modeForRegion(region) === "spain") {
    return takeWithoutRepeats(citiesData, count, (c) => c.name).map((c) => ({
      kind: "city",
      name: c.name,
      lat: c.lat,
      lng: c.lng,
    }));
  }

  const excluded = new Set(playerLocations.map(countryAt).filter(Boolean));
  const pool = countries.features
    .filter((f) => {
      const info = dictionary[f.id];
      if (!info) return false;
      if (excluded.has(f.id)) return false;
      if (region === "Todos") return f.id !== "ESP";
      return info.continent === region;
    })
    .map((f) => f.id);

  return takeWithoutRepeats(pool, count, (id) => id).map((id) => ({
    kind: "country",
    id,
    name: dictionary[id].name.trim(),
  }));
}

// Coge "count" elementos al azar. Si no hay suficientes, vuelve a barajar,
// pero nunca deja el mismo dos veces seguidas.
function takeWithoutRepeats(list, count, keyOf) {
  if (!list.length) return [];
  const out = [];
  while (out.length < count) {
    for (const item of shuffle(list)) {
      if (out.length >= count) break;
      if (out.length && keyOf(out[out.length - 1]) === keyOf(item) && list.length > 1) continue;
      out.push(item);
    }
  }
  return out;
}

// Calcula el resultado de un disparo. Lo que se manda al móvil es lo justo (sin geometrías).
function judge(target, userLocation, heading) {
  const mode = target.kind === "city" ? "spain" : "world";
  const geoTarget = mode === "spain" ? target : countriesById.get(target.id);
  const r = judgeShot({ turf, userLocation, heading, mode, target: geoTarget });
  return { isHit: r.isHit, points: r.points, minDistanceKm: r.minDistanceKm };
}

module.exports = { REGIONS, pickTargets, judge, countryAt, modeForRegion };
