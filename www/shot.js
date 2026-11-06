/* =======================================
   CÁLCULO DEL DISPARO (compartido)

   Este archivo lo usan DOS sitios con exactamente el mismo código:
   - El móvil (index.html lo carga con <script>), para pintar el rayo
     y dar el resultado en los modos sin conexión.
   - El servidor (server/game.js lo carga con require), para decidir
     los puntos en las partidas online. Así nadie puede hacer trampas
     cambiando el JavaScript del móvil.

   Coordenadas siempre en formato Turf: [longitud, latitud].

   CÓMO FUNCIONA UN DISPARO
   1. El láser es una RECTA sobre el mapa (el mismo mapa que se ve en el
      juego, proyección Mercator): sale de tu posición en la dirección a la
      que apuntas y llega hasta la PARED del mapa (borde izquierdo/derecho o
      arriba/abajo). No da la vuelta al mundo.
   2. Aciertas si el país está en medio de esa recta, o si la recta pasa por
      su ZONA DE ACIERTO: un círculo alrededor de su centro que se calcula con
      el RADIO MÁXIMO del país (lo que mide del centro a su punto más lejano).
      Los países pequeños reciben un margen extra; los grandes no lo necesitan.
   3. Los puntos de un acierto dependen de lo PEQUEÑO QUE SE VE el destino
      desde donde estás: Rusia vale 100 casi siempre; Andorra desde Italia,
      unos 200; desde México, bastantes más.
   ======================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(); // Node (servidor)
  } else {
    root.DondeShot = factory(); // Navegador / app
  }
})(typeof self !== "undefined" ? self : this, function () {
  /* ---------- Ajustes (cambiar aquí cambia el juego y el servidor) ---------- */

  // Zona de acierto de un país = su radio máximo + un margen que se reduce
  // cuanto más grande es el país, y desaparece a partir de LIMIT_KM.
  //   Andorra (~20 km de radio) → ~110 km · Luxemburgo (~45) → ~125 km
  //   Suiza (~180) → ~210 km · países de más de 250 km de radio: sin zona, solo su forma
  const ZONE = { extraKm: 100, limitKm: 250 };
  const CITY_ZONE_KM = 25; // ciudades (modo España)

  // Puntos por acierto: 100 × (REF_ANGLE / tamaño aparente) ^ EXPONENT, entre 1× y MAX_MULT×
  const POINTS_HIT = 100;
  const REF_ANGLE_DEG = 20; // un destino que se ve más grande que esto vale 100
  const EXPONENT = 0.27;
  const MAX_MULT = 4; // como mucho 400 puntos
  const CITY_SIZE_KM = 20; // "radio" de una ciudad para calcular su tamaño aparente
  const MIN_SIZE_KM = 5; // Mónaco o el Vaticano cuentan como de 5 km, si no darían 400 desde cualquier sitio

  const POINTS_MISS_MAX = 75; // fallo: hasta 75 según lo cerca que apuntaste

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  /* ---------- El mapa plano (Mercator) ----------
     x = longitud, y = latitud "estirada" como en el mapa. En estas
     coordenadas el láser es una recta de verdad. El mapa acaba en
     x = ±180 (izquierda/derecha) e y = ±180 (latitud ±85°, arriba/abajo). */
  const MAX_LAT = 85.0511287798;
  const WALL = 180;
  const mercY = (lat) => deg(Math.log(Math.tan(Math.PI / 4 + rad(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))) / 2)));
  const latFromY = (y) => deg(2 * Math.atan(Math.exp(rad(y))) - Math.PI / 2);
  const project = ([lng, lat]) => [lng, mercY(lat)];

  // Copia del país en coordenadas del mapa (se guarda para no repetir el cálculo)
  const projectedCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function projectFeature(turf, feature) {
    if (projectedCache && projectedCache.has(feature)) return projectedCache.get(feature);
    const copy = turf.clone(feature);
    turf.coordEach(copy, (c) => { c[1] = mercY(c[1]); });
    const parts = [];
    turf.featureEach(turf.flatten(copy), (p) => parts.push(p));
    if (projectedCache) projectedCache.set(feature, parts);
    return parts;
  }

  /**
   * El láser: desde el jugador, en la dirección "heading", hasta la pared del mapa.
   * Devuelve el segmento en coordenadas del mapa y en [lng, lat] para dibujarlo.
   */
  function buildLaser(turf, userLocation, heading) {
    const [x0, y0] = project(userLocation);
    const dx = Math.sin(rad(heading));
    const dy = Math.cos(rad(heading));
    const tx = dx > 1e-12 ? (WALL - x0) / dx : dx < -1e-12 ? (-WALL - x0) / dx : Infinity;
    const ty = dy > 1e-12 ? (WALL - y0) / dy : dy < -1e-12 ? (-WALL - y0) / dy : Infinity;
    const t = Math.max(0, Math.min(tx, ty));
    const x1 = x0 + dx * t;
    const y1 = y0 + dy * t;
    return {
      segment: turf.lineString([[x0, y0], [x1, y1]]),
      // Dos puntos bastan: Leaflet une los puntos en línea recta sobre el mapa
      line: turf.lineString([userLocation, [x1, latFromY(y1)]]),
    };
  }

  // ¿El segmento (coordenadas del mapa) toca alguna parte del polígono?
  function laserHits(turf, segment, parts) {
    const start = turf.point(segment.geometry.coordinates[0]);
    return parts.some(
      (part) => turf.booleanPointInPolygon(start, part) || turf.lineIntersect(segment, part).features.length > 0,
    );
  }

  // Círculo de la zona de acierto, sin partirse si cae junto al borde del mapa
  function zoneCircle(turf, center, radiusKm) {
    const circle = turf.circle(center, radiusKm, { units: "kilometers", steps: 48 });
    turf.coordEach(circle, (c) => {
      if (c[0] - center[0] > 180) c[0] -= 360;
      else if (center[0] - c[0] > 180) c[0] += 360;
    });
    return circle;
  }

  /* ---------- Tamaño y puntos ---------- */
  // Radio de un círculo con la misma superficie que el país (para el bonus)
  function equivalentRadiusKm(turf, feature) {
    return Math.sqrt(turf.area(feature) / 1e6 / Math.PI);
  }

  // Radio máximo: del centro del país a su punto más lejano (para la zona de acierto)
  function maxRadiusKm(turf, feature, center) {
    let max = 0;
    turf.coordEach(feature, (c) => {
      const d = turf.distance(center, c, { units: "kilometers" });
      if (d > max) max = d;
    });
    return max;
  }

  function zoneRadiusKm(maxRadius) {
    if (maxRadius >= ZONE.limitKm) return 0; // país grande: basta con su forma
    return maxRadius + ZONE.extraKm * (1 - maxRadius / ZONE.limitKm);
  }

  // Ángulo (grados) que ocupa el destino visto desde el jugador
  function apparentSizeDeg(radiusKm, distanceKm) {
    if (distanceKm <= radiusKm) return 180; // estás dentro o pegado
    return deg(2 * Math.atan(radiusKm / distanceKm));
  }

  function hitPoints(apparentDeg) {
    const mult = Math.pow(REF_ANGLE_DEG / apparentDeg, EXPONENT);
    return Math.round(POINTS_HIT * Math.min(MAX_MULT, Math.max(1, mult)));
  }

  /**
   * Decide si el disparo acierta y cuántos puntos vale.
   *
   * @param turf          la librería Turf
   * @param userLocation  [lng, lat] del jugador
   * @param heading       rumbo en grados (0-360)
   * @param mode          'world' (países) o 'spain' (ciudades)
   * @param target        Feature GeoJSON del país, o {name, lat, lng} de la ciudad
   */
  function judgeShot({ turf, userLocation, heading, mode, target }) {
    const isCity = mode === "spain";
    const targetCenter = isCity ? [target.lng, target.lat] : turf.centroid(target).geometry.coordinates;
    const distanceKm = turf.distance(userLocation, targetCenter, { units: "kilometers" });
    const sizeKm = isCity ? CITY_SIZE_KM : equivalentRadiusKm(turf, target);
    const zoneKm = isCity ? CITY_ZONE_KM : zoneRadiusKm(maxRadiusKm(turf, target, targetCenter));

    // El láser, de tu posición a la pared del mapa
    const laser = buildLaser(turf, userLocation, heading);
    const beam = turf.featureCollection([laser.line]);

    // Zona de acierto (ciudades y países pequeños)
    const zoneGeometry = zoneKm > 0 ? zoneCircle(turf, targetCenter, zoneKm) : null;

    // ¿El país (o su zona) está en medio del láser?
    let isHit = false;
    if (zoneGeometry) isHit = laserHits(turf, laser.segment, projectFeature(turf, zoneGeometry));
    if (!isHit && !isCity) isHit = laserHits(turf, laser.segment, projectFeature(turf, target));

    const targetGeometry = isCity ? zoneGeometry : target;

    // Si falla: distancia al destino y línea amarilla hasta él (recta, sin cruzar la pared)
    let minDistanceKm = 0;
    let errorLine = null;
    if (!isHit) {
      let closest = targetCenter;
      if (isCity) {
        minDistanceKm = Math.max(0, distanceKm - zoneKm);
      } else {
        minDistanceKm = Infinity;
        const userPt = turf.point(userLocation);
        turf.featureEach(turf.explode(target), (pointFeature) => {
          const dist = turf.distance(userPt, pointFeature, { units: "kilometers" });
          if (dist < minDistanceKm) {
            minDistanceKm = dist;
            closest = pointFeature.geometry.coordinates;
          }
        });
      }
      errorLine = turf.lineString([userLocation, closest]);
    }

    // Puntos. Si falla, se mira cuánto se desvió de la recta que iba al centro del destino
    const [ux, uy] = project(userLocation);
    const [cx, cy] = project(targetCenter);
    const bearingIdeal = (deg(Math.atan2(cx - ux, cy - uy)) + 360) % 360;
    let errorAngle = Math.abs((((heading % 360) + 360) % 360) - bearingIdeal);
    if (errorAngle > 180) errorAngle = 360 - errorAngle;

    const apparentDeg = apparentSizeDeg(Math.max(MIN_SIZE_KM, sizeKm), distanceKm);
    const maxPoints = hitPoints(apparentDeg); // lo que vale acertar este destino desde aquí
    let points;
    if (isHit) points = maxPoints;
    else if (errorAngle <= 90) points = Math.round(POINTS_MISS_MAX * (1 - errorAngle / 90));
    else points = 0;

    return {
      isHit,
      points,
      maxPoints,
      bonus: maxPoints - POINTS_HIT,
      minDistanceKm: isHit ? 0 : Math.round(minDistanceKm),
      errorAngle: Math.round(errorAngle),
      distanceKm: Math.round(distanceKm),
      bearingIdeal: Math.round(bearingIdeal),
      beam,
      errorLine,
      targetGeometry,
      zoneGeometry, // null en los países grandes
      zoneKm: Math.round(zoneKm),
      targetCenter,
    };
  }

  /**
   * ¿Está el destino tan cerca que se acertaría apuntando a cualquier sitio?
   * (p. ej. el Vaticano jugando desde Roma). Esos destinos no se eligen.
   */
  const TOO_CLOSE_KM = { world: 200, spain: 50 };
  function tooClose(turf, mode, userLocation, center) {
    if (!userLocation) return false;
    const limit = TOO_CLOSE_KM[mode === "spain" ? "spain" : "world"];
    return turf.distance(userLocation, center, { units: "kilometers" }) < limit;
  }

  /**
   * Los microestados (Andorra, Mónaco...) no vienen en el mapa de países.
   * Se añaden como un círculo con su superficie real; para acertarlos
   * cuenta la zona de acierto, y su tamaño real decide el bonus.
   */
  function withMicrostates(turf, countries, list) {
    if (!countries || !list || !list.length) return countries;
    const have = new Set(countries.features.map((f) => f.id));
    for (const m of list) {
      if (have.has(m.id)) continue;
      const radiusKm = Math.max(0.3, Math.sqrt(m.areaKm2 / Math.PI));
      const f = turf.circle([m.lng, m.lat], radiusKm, { units: "kilometers", steps: 24 });
      f.id = m.id;
      f.properties = { name: m.name, microstate: true };
      countries.features.push(f);
    }
    return countries;
  }

  return {
    judgeShot,
    withMicrostates,
    tooClose,
    hitPoints,
    apparentSizeDeg,
    POINTS_HIT,
    POINTS_MISS_MAX,
  };
});
