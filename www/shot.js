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
   1. El rayo sale de tu posición siguiendo un CÍRCULO MÁXIMO, que es
      lo que de verdad señala una brújula: el camino más corto sobre la
      esfera. (Antes era una línea de rumbo constante, la "recta" de un
      mapa plano, y por eso Japón o Australia eran imposibles de acertar
      apuntando bien.)
   2. Aciertas si el rayo toca el país/ciudad o pasa por su ZONA DE
      ACIERTO: un círculo mínimo alrededor del centro, que ayuda a los
      destinos pequeños y crece un poco con la distancia (la brújula del
      móvil no es perfecta).
   3. Los puntos de un acierto dependen de lo PEQUEÑO QUE SE VE el
      destino desde donde estás: Rusia vale 100 casi siempre; Andorra
      desde Italia, unos 200; desde México, bastantes más.
   ======================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(); // Node (servidor)
  } else {
    root.DondeShot = factory(); // Navegador / app
  }
})(typeof self !== "undefined" ? self : this, function () {
  /* ---------- Ajustes (cambiar aquí cambia el juego y el servidor) ---------- */
  const EARTH_KM = 6371.0088;
  const MAX_RAY_KM = 20015; // media vuelta al mundo: llega a cualquier punto

  // Zona de acierto mínima = un % de la distancia, entre un mínimo y un máximo
  const ZONE = {
    world: { minKm: 100, maxKm: 300, pctOfDistance: 0.03 }, // países
    spain: { minKm: 25, maxKm: 60, pctOfDistance: 0.04 },   // ciudades
  };

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

  /* ---------- Rayo ---------- */
  // Puntos del círculo máximo que sale de "origin" con el rumbo "heading"
  function buildBeamString(turf, origin, heading, maxLength, step) {
    const pts = [];
    for (let d = 0; d <= maxLength + step / 2; d += step) {
      const p = turf.destination(origin, Math.min(d, maxLength), heading, { units: "kilometers" });
      let [lng, lat] = p.geometry.coordinates;
      if (isNaN(lng) || isNaN(lat)) break;
      while (lng > 180) lng -= 360;
      while (lng < -180) lng += 360;
      pts.push([lng, lat]);
    }
    return pts;
  }

  // Corta la línea cuando cruza el meridiano 180 para que no atraviese el mapa entero
  function breakLinesOnMeridian(turf, linePoints) {
    const lines = [];
    let current = [];
    for (const pt of linePoints) {
      if (current.length > 0 && Math.abs(pt[0] - current[current.length - 1][0]) > 180) {
        if (current.length > 1) lines.push(turf.lineString(current));
        current = [];
      }
      current.push(pt);
    }
    if (current.length > 1) lines.push(turf.lineString(current));
    return lines;
  }

  /**
   * Distancia mínima (km) entre un punto y el rayo (arco de círculo máximo
   * desde "origin" con rumbo "heading" y longitud "lengthKm").
   * Fórmulas de distancia transversal y a lo largo del arco.
   */
  function distanceToRayKm(turf, origin, heading, lengthKm, point) {
    const d13 = turf.distance(origin, point, { units: "kilometers" }) / EARTH_KM;
    const b13 = rad(turf.bearing(origin, point));
    const dTheta = b13 - rad(heading);
    const xt = Math.asin(Math.sin(d13) * Math.sin(dTheta)); // transversal (radianes)
    let at = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(xt)))); // a lo largo
    if (Math.cos(dTheta) < 0) at = -at;

    if (at >= 0 && at * EARTH_KM <= lengthKm) return Math.abs(xt) * EARTH_KM;
    if (at < 0) return d13 * EARTH_KM; // el punto queda detrás del jugador
    const end = turf.destination(origin, lengthKm, heading, { units: "kilometers" });
    return turf.distance(end, point, { units: "kilometers" });
  }

  /* ---------- Tamaño y puntos ---------- */
  // Radio de un círculo con la misma superficie que el país
  function equivalentRadiusKm(turf, feature) {
    return Math.sqrt(turf.area(feature) / 1e6 / Math.PI);
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

  function zoneRadiusKm(mode, distanceKm) {
    const z = ZONE[mode === "spain" ? "spain" : "world"];
    return Math.min(z.maxKm, Math.max(z.minKm, distanceKm * z.pctOfDistance));
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
    const zoneKm = Math.max(zoneRadiusKm(mode, distanceKm), isCity ? CITY_SIZE_KM : 0);

    // Rayo: hasta un poco más allá del destino (nunca más de media vuelta)
    const rayKm = Math.min(distanceKm + Math.max(1500, 2 * sizeKm), MAX_RAY_KM);
    const linePoints = buildBeamString(turf, userLocation, heading, rayKm, isCity ? 20 : 100);
    const beam = turf.featureCollection(breakLinesOnMeridian(turf, linePoints));

    // 1) ¿Pasa por la zona de acierto alrededor del centro?
    let isHit = distanceToRayKm(turf, userLocation, heading, rayKm, targetCenter) <= zoneKm;

    // 2) ¿Toca el propio país? (los grandes se salen de la zona)
    if (!isHit && !isCity) {
      turf.featureEach(turf.flatten(target), (part) => {
        if (isHit) return;
        if (turf.booleanPointInPolygon(turf.point(userLocation), part)) isHit = true;
        turf.featureEach(beam, (line) => {
          if (!isHit && turf.lineIntersect(line, part).features.length > 0) isHit = true;
        });
      });
    }

    // Lo que se dibuja en el mapa del resultado
    const zoneGeometry = turf.circle(targetCenter, zoneKm, { units: "kilometers", steps: 48 });
    const targetGeometry = isCity ? zoneGeometry : target;

    // Si falla: distancia al destino y línea amarilla hasta él
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
      let pt2 = closest;
      if (userLocation[0] - pt2[0] > 180) pt2 = [pt2[0] + 360, pt2[1]];
      else if (pt2[0] - userLocation[0] > 180) pt2 = [pt2[0] - 360, pt2[1]];
      errorLine = turf.lineString([userLocation, pt2]);
    }

    // Puntos
    const bearingIdeal = (turf.bearing(userLocation, targetCenter) + 360) % 360;
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
      beam,
      errorLine,
      targetGeometry,
      // La zona solo se dibuja cuando es más grande que el destino (países pequeños y ciudades)
      zoneGeometry: isCity || sizeKm < zoneKm ? zoneGeometry : null,
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
