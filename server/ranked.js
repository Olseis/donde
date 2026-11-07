/* =======================================
   CLASIFICATORIA (ligas como en el LoL)

   Cada jugador tiene DOS números:
   - MMR (oculto): su Elo de siempre (www/elo.js). Mide su nivel real.
   - Rango visible: liga + división + LP, p. ej. "Oro II · 45 LP".

   Ligas, de abajo arriba:
     Hierro, Bronce, Plata, Oro, Platino, Esmeralda, Diamante  → divisiones IV, III, II, I
     Maestro, Gran Maestro, Aspirante                            → sin divisiones, LP sin tope
   Hierro va de broma: sus divisiones se llaman Puñado de tierra (IV), Bolsa de plástico (III),
   Tablón de madera (II) y Hierro (I).
   Cada división son 100 LP: al pasar de 99 subes de división; al bajar de 0, bajas.
   Gran Maestro y Aspirante no se ganan por LP sino por puesto entre los Maestros
   (los mejores N), y se calculan al ver el ranking.

   Internamente todo el rango es UN número, "ladder" (escalera):
     0 = Hierro IV 0 LP · 100 = Hierro III 0 LP · ... · 2799 = Diamante I 99 LP
     2800 en adelante = Maestro, con LP = ladder - 2800

   Partidas de clasificación: las 5 primeras no dan LP. Al terminar la 5.ª,
   el MMR decide dónde empiezas, entre Hierro IV y Platino IV.

   LP de una partida (hasta 10 jugadores):
   - Los 5 primeros ganan, de más a menos: 1.º 100 % · 2.º 70 % · 3.º 45 % · 4.º 25 % · 5.º 10 %
   - Los 5 últimos pierden igual pero al revés: el último pierde el 100 %
   - Con menos jugadores, gana la mitad de arriba y pierde la de abajo
     (con 4: 1.º +100 %, 2.º +70 %, 3.º -70 %, 4.º -100 %). Si son impares, el del medio se queda igual.
   - El 100 % son 25 LP, corregidos por el MMR como en el LoL: si tu nivel real
     está por encima de tu rango ganas más y pierdes menos (hasta ×1,5), y al revés.
   ======================================= */

const TIERS = [
  { id: "iron", name: "Hierro" },
  { id: "bronze", name: "Bronce" },
  { id: "silver", name: "Plata" },
  { id: "gold", name: "Oro" },
  { id: "platinum", name: "Platino" },
  { id: "emerald", name: "Esmeralda" },
  { id: "diamond", name: "Diamante" },
];
const APEX = {
  master: { id: "master", name: "Maestro" },
  grandmaster: { id: "grandmaster", name: "Gran Maestro" },
  challenger: { id: "challenger", name: "Aspirante" },
};
const DIVISIONS = ["IV", "III", "II", "I"];
// Hierro va de broma: cada división tiene su propio "material" en vez de IV, III, II, I
const DIVISION_NAMES = {
  iron: { IV: "Puñado de tierra", III: "Bolsa de plástico", II: "Tablón de madera", I: "Hierro" },
};

const CFG = {
  PLACEMENT_GAMES: 5,
  PLACEMENT_MAX_LADDER: 4 * 400 + 99, // como mucho Platino IV
  BASE_LP: 25,
  // Peso del LP según el puesto, contando desde arriba (ganadores) o desde abajo (perdedores)
  WEIGHTS: [1, 0.7, 0.45, 0.25, 0.1],
  MASTER_LADDER: TIERS.length * 400, // 2800
  // Gran Maestro y Aspirante: los mejores Maestros por LP, con un mínimo de LP
  CHALLENGER: { top: 10, minLp: 500 },
  GRANDMASTER: { top: 50, minLp: 200 },
};

// MMR que "corresponde" a cada rango: Hierro IV ≈ 600, Plata IV ≈ 1000, Oro IV ≈ 1200, Diamante I ≈ 2000
function rankMmr(ladder) {
  return 600 + ladder / 2;
}

function placementLadder(mmr) {
  return Math.max(0, Math.min(CFG.PLACEMENT_MAX_LADDER, Math.round((mmr - 600) * 2)));
}

/**
 * Convierte el número interno en algo legible.
 * apexTier: 'grandmaster' | 'challenger' si ya se sabe (se calcula en el ranking)
 */
function describe(ladder, gamesPlayed = 0, apexTier = null) {
  if (ladder === null || ladder === undefined) {
    const played = Math.min(gamesPlayed, CFG.PLACEMENT_GAMES);
    return {
      tier: "unranked",
      tierName: "Sin clasificar",
      division: null,
      lp: null,
      label: `Clasificación ${played}/${CFG.PLACEMENT_GAMES}`,
      placement: { played, total: CFG.PLACEMENT_GAMES },
      key: "unranked",
    };
  }
  if (ladder >= CFG.MASTER_LADDER) {
    const t = APEX[apexTier] || APEX.master;
    const lp = ladder - CFG.MASTER_LADDER;
    return { tier: t.id, tierName: t.name, division: null, name: t.name, lp, label: `${t.name} · ${lp} LP`, key: t.id };
  }
  const t = TIERS[Math.floor(ladder / 400)];
  const division = DIVISIONS[Math.floor((ladder % 400) / 100)];
  const lp = ladder % 100;
  const name = DIVISION_NAMES[t.id]?.[division] || `${t.name} ${division}`;
  return {
    tier: t.id,
    tierName: t.name,
    division,
    name, // cómo se llama la división en pantalla: "Oro II", "Bolsa de plástico"...
    lp,
    label: `${name} · ${lp} LP`,
    key: `${t.id}-${division}`,
  };
}

// Rango de "ladder" que ocupa una división (para buscar a los de tu tabla)
function divisionRange(ladder) {
  if (ladder >= CFG.MASTER_LADDER) return [CFG.MASTER_LADDER, Number.MAX_SAFE_INTEGER];
  const lo = Math.floor(ladder / 100) * 100;
  return [lo, lo + 99];
}

// Peso de cada puesto (posiciones 1..n, con empates compartidos) según el reparto de arriba
function placementWeights(standings) {
  const n = standings.length;
  const w = Math.min(CFG.WEIGHTS.length, Math.floor(n / 2));
  const sorted = [...standings].sort((a, b) => a.position - b.position);
  const slot = (i) => (i < w ? CFG.WEIGHTS[i] : i >= n - w ? -CFG.WEIGHTS[n - 1 - i] : 0);
  const out = {};
  let i = 0;
  while (i < n) {
    // Los empatados se reparten la media de los huecos que ocupan
    let j = i;
    while (j + 1 < n && sorted[j + 1].position === sorted[i].position) j++;
    let sum = 0;
    for (let k = i; k <= j; k++) sum += slot(k);
    for (let k = i; k <= j; k++) out[sorted[k].id] = sum / (j - i + 1);
    i = j + 1;
  }
  return out;
}

/**
 * LP de cada jugador tras una partida.
 * @param players [{ id, position, mmrBefore, mmrAfter, ladder (null = sin clasificar), games (antes de esta) }]
 * @returns { id: { ladderBefore, ladderAfter, lpDelta, placed, gamesPlayed, before, after, change } }
 */
function applyMatch(players) {
  const weights = placementWeights(players);
  const out = {};
  for (const p of players) {
    const games = p.games + 1;
    const r = { ladderBefore: p.ladder, ladderAfter: p.ladder, lpDelta: 0, placed: false, gamesPlayed: games };

    if (p.ladder === null || p.ladder === undefined) {
      // Partidas de clasificación: sin LP; al acabar la última te colocan según tu MMR
      if (games >= CFG.PLACEMENT_GAMES) {
        r.ladderAfter = placementLadder(p.mmrAfter);
        r.placed = true;
      }
    } else {
      const weight = weights[p.id] || 0;
      const diff = p.mmrBefore - rankMmr(p.ladder);
      const winFactor = clamp(1 + diff / 400, 0.5, 1.5);
      const lossFactor = clamp(1 - diff / 400, 0.5, 1.5);
      const delta = weight > 0
        ? Math.max(1, Math.round(CFG.BASE_LP * weight * winFactor))
        : weight < 0
          ? -Math.max(1, Math.round(CFG.BASE_LP * -weight * lossFactor)) // simétrico con las ganancias
          : 0;
      r.ladderAfter = Math.max(0, p.ladder + delta); // nadie baja de Hierro IV 0 LP
      r.lpDelta = r.ladderAfter - p.ladder;
    }

    const before = describe(r.ladderBefore, p.games);
    const after = describe(r.ladderAfter, games);
    r.before = before.label;
    r.after = after.label;
    r.change = rankChange(before, after);
    out[p.id] = r;
  }
  return out;
}

// "promoted" | "demoted" | "placed" | null (cambio de división o de liga)
function rankChange(before, after) {
  if (before.tier === "unranked") return after.tier === "unranked" ? null : "placed";
  if (before.key === after.key) return null;
  return order(after) > order(before) ? "promoted" : "demoted";
}
function order(d) {
  if (d.tier === "unranked") return -1;
  const t = TIERS.findIndex((x) => x.id === d.tier);
  return t >= 0 ? t * 4 + DIVISIONS.indexOf(d.division) : 100;
}

/**
 * Gran Maestro y Aspirante: entre todos los Maestros (ordenados por LP de mayor a menor),
 * los primeros que cumplan el mínimo. Devuelve { playerId: 'challenger' | 'grandmaster' | 'master' }
 */
function apexTiers(masters) {
  const out = {};
  const sorted = [...masters].sort((a, b) => b.ladder - a.ladder);
  let ch = 0;
  let gm = 0;
  for (const m of sorted) {
    const lp = m.ladder - CFG.MASTER_LADDER;
    if (ch < CFG.CHALLENGER.top && lp >= CFG.CHALLENGER.minLp) {
      out[m.id] = "challenger";
      ch++;
    } else if (gm < CFG.GRANDMASTER.top && lp >= CFG.GRANDMASTER.minLp) {
      out[m.id] = "grandmaster";
      gm++;
    } else out[m.id] = "master";
  }
  return out;
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

module.exports = {
  CFG,
  TIERS,
  DIVISIONS,
  describe,
  divisionRange,
  placementWeights,
  placementLadder,
  rankMmr,
  applyMatch,
  apexTiers,
};
