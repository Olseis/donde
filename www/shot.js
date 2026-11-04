/* =======================================
   CÁLCULO DEL DISPARO (compartido)

   Este archivo lo usan DOS sitios con exactamente el mismo código:
   - El móvil (index.html lo carga con <script>), para pintar el rayo
     y dar el resultado en los modos sin conexión.
   - El servidor (server/game.js lo carga con require), para decidir
     los puntos en las partidas online. Así nadie puede hacer trampas
     cambiando el JavaScript del móvil.

   Coordenadas siempre en formato Turf: [longitud, latitud].
   ======================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(); // Node (servidor)
  } else {
    root.DondeShot = factory(); // Navegador / app
  }
})(typeof self !== "undefined" ? self : this, function () {
  const SPAIN_CITY_RADIUS_KM = 20;
  const POINTS_HIT = 100;
  const POINTS_MISS_MAX = 75;

  // Puntos a lo largo de la dirección en la que apunta el jugador
  function buildBeamString(turf, origin, heading, maxLength, step, wrapMeridian) {
    const pts = [];
    for (let d = 0; d <= maxLength; d += step) {
      const p = turf.rhumbDestination(origin, d, heading, { units: "kilometers" });
      let lng = p.geometry.coordinates[0];
      const lat = p.geometry.coordinates[1];

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
   * Decide si el disparo acierta y cuántos puntos vale.
   *
   * @param turf          la librería Turf
   * @param userLocation  [lng, lat] del jugador
   * @param heading       rumbo en grados (0-360)
   * @param mode          'world' (países) o 'spain' (ciudades)
   * @param target        Feature GeoJSON del país, o {name, lat, lng} de la ciudad
   */
  function judgeShot({ turf, userLocation, heading, mode, target }) {
    let isHit = false;
    let beam = null;
    let errorLine = null;
    let minDistanceKm = 0;
    let targetCenter;
    let targetGeometry = null;

    if (mode === "spain") {
      targetCenter = [target.lng, target.lat];
      targetGeometry = turf.circle(targetCenter, SPAIN_CITY_RADIUS_KM, { units: "kilometers" });
      const distanceToTarget = turf.distance(userLocation, targetCenter, { units: "kilometers" });
      const rayLengthKm = Math.min(distanceToTarget + 500, 4000);

      const linePoints = buildBeamString(turf, userLocation, heading, rayLengthKm, 20, false);
      beam = turf.featureCollection([turf.lineString(linePoints)]);

      if (turf.lineIntersect(beam.features[0], targetGeometry).features.length > 0) isHit = true;
      if (turf.booleanPointInPolygon(turf.point(linePoints[0]), targetGeometry)) isHit = true;

      if (!isHit) {
        minDistanceKm = Math.max(0, distanceToTarget - SPAIN_CITY_RADIUS_KM);
        errorLine = turf.lineString([userLocation, targetCenter]);
      }
    } else {
      targetCenter = turf.centroid(target).geometry.coordinates;
      targetGeometry = target;
      const distanceToTarget = turf.distance(userLocation, targetCenter, { units: "kilometers" });
      const rayLengthKm = Math.min(distanceToTarget + 1500, 20000);

      const linePoints = buildBeamString(turf, userLocation, heading, rayLengthKm, 100, true);
      beam = turf.featureCollection(breakLinesOnMeridian(turf, linePoints));

      turf.featureEach(turf.flatten(target), (countryPart) => {
        turf.featureEach(beam, (linePart) => {
          if (turf.lineIntersect(linePart, countryPart).features.length > 0) isHit = true;
          const startPoint = turf.point(linePart.geometry.coordinates[0]);
          if (turf.booleanPointInPolygon(startPoint, countryPart)) isHit = true;
        });
      });

      if (!isHit) {
        // El punto del país más cercano al jugador, para la línea amarilla del mapa
        let closest = null;
        minDistanceKm = Infinity;
        const userPt = turf.point(userLocation);
        turf.featureEach(turf.explode(target), (pointFeature) => {
          const dist = turf.distance(userPt, pointFeature, { units: "kilometers" });
          if (dist < minDistanceKm) {
            minDistanceKm = dist;
            closest = pointFeature;
          }
        });
        if (closest) {
          let pt2 = closest.geometry.coordinates;
          if (userLocation[0] - pt2[0] > 180) pt2 = [pt2[0] + 360, pt2[1]];
          else if (pt2[0] - userLocation[0] > 180) pt2 = [pt2[0] - 360, pt2[1]];
          errorLine = turf.lineString([userLocation, pt2]);
        }
      }
    }

    // Si falla, puntos según lo cerca que apuntó del centro (0 si se desvía más de 90°)
    const idealBearing = turf.bearing(userLocation, targetCenter);
    const bearingNorm = idealBearing < 0 ? 360 + idealBearing : idealBearing;
    let errorAngle = Math.abs((heading % 360) - bearingNorm);
    if (errorAngle > 180) errorAngle = 360 - errorAngle;

    let points;
    if (isHit) points = POINTS_HIT;
    else if (errorAngle <= 90) points = Math.round(POINTS_MISS_MAX * (1 - errorAngle / 90));
    else points = 0;

    return {
      isHit,
      points,
      minDistanceKm: isHit ? 0 : Math.round(minDistanceKm),
      errorAngle: Math.round(errorAngle),
      beam,
      errorLine,
      targetGeometry,
      targetCenter,
    };
  }

  return { judgeShot, POINTS_HIT, POINTS_MISS_MAX };
});
