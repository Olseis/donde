/* =======================================
   SISTEMA ELO (compartido)

   Lo usan el servidor (ranking online) y el móvil (ranking local),
   así los dos cuentan igual.

   Cómo funciona:
   - Todo jugador empieza con 1000.
   - Una partida de N jugadores se cuenta como si cada uno hubiera jugado
     contra cada uno de los demás: ganas a quien queda por debajo de ti,
     pierdes con quien queda por encima, empatas si quedáis igual.
   - Ganar a alguien con más Elo que tú da muchos puntos; ganar a alguien
     con mucho menos, casi ninguno. Perder funciona al revés.
   - Los primeros partidos mueven más el Elo (K alto) para que cada
     jugador llegue rápido a su nivel real.
   ======================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DondeElo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const START = 1000;

  // Cuánto se mueve el Elo en una partida, según cuántas lleva el jugador
  function kFactor(games) {
    if (games < 10) return 40; // jugador nuevo
    if (games < 30) return 32;
    return 24; // veterano
  }

  // Probabilidad de que A gane a B
  function expected(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  /**
   * Calcula el Elo nuevo de todos los jugadores de una partida.
   * @param players [{ id, rating, games, position }]  position: 1 = primero (empates comparten)
   * @returns [{ id, before, after, delta }]
   */
  function rateMatch(players) {
    const n = players.length;
    if (n < 2) return players.map((p) => ({ id: p.id, before: p.rating, after: p.rating, delta: 0 }));

    return players.map((a) => {
      let sum = 0;
      for (const b of players) {
        if (b === a) continue;
        const result = a.position < b.position ? 1 : a.position === b.position ? 0.5 : 0;
        sum += result - expected(a.rating, b.rating);
      }
      // Se divide entre los rivales para que una partida de 6 no mueva 5 veces más que una de 2
      const delta = Math.round((kFactor(a.games) / (n - 1)) * sum);
      return { id: a.id, before: a.rating, after: a.rating + delta, delta };
    });
  }

  return { START, kFactor, expected, rateMatch };
});
