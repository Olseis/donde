/* Pruebas de la clasificatoria: reparto de LP por puesto, partidas de clasificación,
   ascensos, Maestro+ y tabla de cada división, con una BD temporal.
   Uso:  node test/ranked.test.js  */
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "donde-ranked-")), "r.db");
const R = require("../ranked");
const store = require("../db");

// 1. Pesos por puesto
const ten = Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, position: i + 1 }));
const w10 = R.placementWeights(ten);
assert.deepStrictEqual(
  ten.map((p) => w10[p.id]),
  [1, 0.7, 0.45, 0.25, 0.1, -0.1, -0.25, -0.45, -0.7, -1],
);
const w4 = R.placementWeights(ten.slice(0, 4));
assert.deepStrictEqual([w4.p1, w4.p2, w4.p3, w4.p4], [1, 0.7, -0.7, -1]);
const w3 = R.placementWeights(ten.slice(0, 3));
assert.deepStrictEqual([w3.p1, w3.p2, w3.p3], [1, 0, -1]);
const tie = R.placementWeights([{ id: "a", position: 1 }, { id: "b", position: 1 }]);
assert.deepStrictEqual([tie.a, tie.b], [0, 0], "empate entre dos: nadie gana ni pierde");
console.log("✔ reparto por puesto (10, 4, 3 jugadores y empate)");

// 2. Nombres de rango
assert.strictEqual(R.describe(0).label, "Puñado de tierra · 0 LP");
assert.strictEqual(R.describe(150).label, "Bolsa de plástico · 50 LP");
assert.strictEqual(R.describe(299).label, "Tablón de madera · 99 LP");
assert.strictEqual(R.describe(399).label, "Hierro · 99 LP");
assert.strictEqual(R.describe(400).label, "Bronce IV · 0 LP");
assert.strictEqual(R.describe(1345).label, "Oro III · 45 LP");
assert.strictEqual(R.describe(2799).label, "Diamante I · 99 LP");
assert.strictEqual(R.describe(3150).label, "Maestro · 350 LP");
assert.strictEqual(R.describe(null, 2).label, "Clasificación 2/5");
console.log("✔ nombres de rango");

// 3. LP en una partida de 10 con todos en Oro IV y MMR acorde (factor 1)
const gold4 = 1200;
const mmr = R.rankMmr(gold4);
const res = R.applyMatch(ten.map((p) => ({ ...p, games: 20, ladder: gold4, mmrBefore: mmr, mmrAfter: mmr })));
const lps = ten.map((p) => res[p.id].lpDelta);
console.log("  LP Oro IV, 10 jugadores:", lps.join(" "));
assert.deepStrictEqual(lps, [25, 18, 11, 6, 3, -3, -6, -11, -18, -25]);
assert.strictEqual(res.p10.after, "Plata I · 75 LP", "perder en Oro IV con 0 LP baja a Plata I");
assert.strictEqual(res.p10.change, "demoted");

// MMR por encima del rango: gana más, pierde menos
const strong = R.applyMatch([
  { id: "a", position: 1, games: 20, ladder: gold4, mmrBefore: mmr + 200, mmrAfter: mmr + 210 },
  { id: "b", position: 2, games: 20, ladder: gold4, mmrBefore: mmr + 200, mmrAfter: mmr + 190 },
]);
assert(strong.a.lpDelta > 25 && strong.b.lpDelta > -25, "MMR alto: +más / -menos");
console.log("✔ LP por puesto y corrección por MMR");

// Ascenso de división
const up = R.applyMatch([
  { id: "a", position: 1, games: 20, ladder: 1290, mmrBefore: R.rankMmr(1290), mmrAfter: 0 },
  { id: "b", position: 2, games: 20, ladder: 1290, mmrBefore: R.rankMmr(1290), mmrAfter: 0 },
]);
assert.strictEqual(up.a.after, "Oro III · 15 LP");
assert.strictEqual(up.a.change, "promoted");
// Suelo en Hierro IV
const floor = R.applyMatch([
  { id: "a", position: 1, games: 20, ladder: 5, mmrBefore: 600, mmrAfter: 600 },
  { id: "b", position: 2, games: 20, ladder: 5, mmrBefore: 600, mmrAfter: 600 },
]);
assert.strictEqual(floor.b.after, "Puñado de tierra · 0 LP");
console.log("✔ ascensos, descensos y suelo en Hierro IV");

// 4. Con la base de datos: 10 jugadores, 6 partidas siempre en el mismo orden
const ids = ten.map((p) => `jugador-${p.id}-xx`);
for (let g = 1; g <= 6; g++) {
  const matchId = store.createMatch("TEST", "Europa", 10, ids.map((id, i) => ({ id, name: `J${i + 1}` })));
  const out = store.finishMatch(matchId,
    ids.map((id, i) => ({ id, score: 1000 - i * 50, hits: 10 - i, position: i + 1 })),
    [{ kind: "country", key: "FRA", name: "Francia", shots: 10, hits: 4 }]);
  if (g <= 4) assert.strictEqual(store.rankOf(ids[0]).label, `Clasificación ${g}/5`);
  if (g === 5) {
    assert(Object.values(out).every((r) => r.change === "placed"), "tras la 5.ª todos tienen rango");
    console.log("  Tras la clasificación:", ids.map((id) => store.rankOf(id).label).join(" | "));
  }
  if (g === 6) console.log("  Tras la 6.ª:", ids.slice(0, 3).map((id) => `${store.rankOf(id).label} (${out[id].lpDelta >= 0 ? "+" : ""}${out[id].lpDelta})`).join(" | "));
}
const best = store.rankOf(ids[0]);
const worst = store.rankOf(ids[9]);
assert(best.tier !== "unranked" && worst.tier !== "unranked");
assert(R.TIERS.findIndex((t) => t.id === best.tier) >= R.TIERS.findIndex((t) => t.id === worst.tier),
  "el que siempre gana queda igual o por encima");

// La tabla de cada uno solo tiene jugadores de su misma división
for (const id of [ids[0], ids[5], ids[9]]) {
  const t = store.divisionTable(id, 50);
  const mine = store.rankOf(id);
  assert(t.ranking.some((r) => r.you), "te ves en tu tabla");
  for (const r of t.ranking) assert(r.lp >= 0 && r.lp <= 99);
  assert.strictEqual(t.table.key, mine.key);
  console.log(`  Tabla de ${mine.name}:`, t.ranking.map((r) => `${r.name} ${r.lp}`).join(", "));
}
const unranked = "jugador-nuevo-123";
assert.strictEqual(store.divisionTable(unranked, 50).table, null);
console.log("✔ clasificación, tablas por división y jugador sin rango");

// 5. Maestro, Gran Maestro y Aspirante
const apex = R.apexTiers([
  { id: "x", ladder: 2800 + 900 }, { id: "y", ladder: 2800 + 300 }, { id: "z", ladder: 2800 + 50 },
]);
assert.deepStrictEqual(apex, { x: "challenger", y: "grandmaster", z: "master" });
console.log("✔ Maestro / Gran Maestro / Aspirante");

// 6. Tamaño acotado: de cada jugador solo quedan sus últimas 20 partidas,
//    pero su rango, victorias y mejor puntuación siguen contando todas
const pair = ["poda-a-000001", "poda-b-000001"];
let firstId;
for (let g = 1; g <= 25; g++) {
  const m = store.createMatch("PODA", "Europa", 10, pair.map((id) => ({ id, name: id.slice(5, 6) })));
  if (g === 1) firstId = m;
  store.finishMatch(m, [{ id: pair[0], score: 500 + g, hits: 3, position: 1 }, { id: pair[1], score: 100, hits: 1, position: 2 }]);
}
const sql = store.db;
assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM match_players WHERE player_id = ?").get(pair[0]).n, store.KEEP_MATCHES);
assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM matches WHERE code = 'PODA'").get().n, store.KEEP_MATCHES);
assert(!sql.prepare("SELECT 1 FROM matches WHERE id = ?").get(firstId), "las partidas viejas se borran");
const a = sql.prepare("SELECT wins, best_score, hits, elo_games FROM players WHERE id = ?").get(pair[0]);
assert.deepStrictEqual(a, { wins: 25, best_score: 525, hits: 75, elo_games: 25 });
assert.strictEqual(store.history(pair[0]).length, store.KEEP_MATCHES);
const fra = sql.prepare("SELECT shots, hits FROM target_stats WHERE kind = 'country' AND target_key = 'FRA'").get();
assert.deepStrictEqual(fra, { shots: 60, hits: 24 });
console.log("✔ solo las últimas 20 partidas por jugador; los totales no se pierden");

// 7. Cuentas inactivas: a los 2 años sin jugar Ranked se borran solas
sql.prepare("UPDATE players SET last_seen = datetime('now', '-25 months') WHERE id = ?").run(pair[1]);
store.maintenance();
assert(!sql.prepare("SELECT 1 FROM players WHERE id = ?").get(pair[1]), "la cuenta inactiva se borra");
assert.strictEqual(sql.prepare("SELECT COUNT(*) n FROM match_players WHERE player_id = ?").get(pair[0]).n, store.KEEP_MATCHES,
  "las partidas siguen para los demás");
console.log("✔ cuentas sin jugar en 2 años se borran solas");

console.log("\n✅ Clasificatoria correcta");
