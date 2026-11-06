/* =======================================
   BASE DE DATOS (SQLite)

   Un único archivo. Por defecto en /var/lib/donde/donde.db en el
   servidor (fuera de la carpeta que publica Apache y fuera del repo,
   para que el cron de git no la toque nunca).

   Tablas:
   - players        cada móvil (id anónimo) con el último nombre que usó
   - matches        cada partida online: sala, región, estado
   - match_players  quién jugó cada partida, puntos finales y puesto
   - rounds         el destino de cada ronda
   - shots          cada disparo: rumbo, ubicación y lo que decidió el servidor

   Clasificatoria (ver ranked.js):
   - players.elo / elo_games: MMR oculto y partidas jugadas
   - players.ladder: rango visible como un solo número (NULL = en clasificación)
   - match_players.elo_before/after, ladder_before/after, lp_delta: cómo cambió
     cada uno en cada partida (para el historial)
   ======================================= */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const WWW_DIR = process.env.WWW_DIR || path.join(__dirname, "..", "www");
const Elo = require(path.join(WWW_DIR, "elo.js")); // MMR oculto
const Ranked = require("./ranked"); // ligas y LP visibles

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "donde.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT NOT NULL,
    region       TEXT NOT NULL,
    total_rounds INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'playing',   -- playing | finished | abandoned
    started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT    NOT NULL REFERENCES players(id),
    name      TEXT    NOT NULL,
    score     INTEGER NOT NULL DEFAULT 0,
    hits      INTEGER NOT NULL DEFAULT 0,
    position  INTEGER,
    PRIMARY KEY (match_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_no    INTEGER NOT NULL,
    target_kind TEXT    NOT NULL,
    target_id   TEXT,
    target_name TEXT    NOT NULL,
    PRIMARY KEY (match_id, round_no)
  );

  CREATE TABLE IF NOT EXISTS shots (
    match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    round_no        INTEGER NOT NULL,
    player_id       TEXT    NOT NULL REFERENCES players(id),
    heading         REAL,
    lng             REAL,
    lat             REAL,
    is_hit          INTEGER NOT NULL,
    points          INTEGER NOT NULL,
    distance_km     INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (match_id, round_no, player_id)
  );

  CREATE INDEX IF NOT EXISTS idx_mp_player ON match_players(player_id);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status, finished_at);
`);

/* ---------- Migraciones ----------
   Las bases de datos creadas antes no tienen estas columnas. Se añaden y se
   recalcula el MMR y el rango de todas las partidas ya jugadas, en orden. */
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
let needsRecompute = false;
function addColumns(table, check, sql) {
  if (hasColumn(table, check)) return;
  db.exec(sql);
  needsRecompute = true;
}
// MMR oculto (Elo)
addColumns("players", "elo", `
  ALTER TABLE players ADD COLUMN elo INTEGER NOT NULL DEFAULT ${Elo.START};
  ALTER TABLE players ADD COLUMN elo_games INTEGER NOT NULL DEFAULT 0;`);
addColumns("match_players", "elo_before", `
  ALTER TABLE match_players ADD COLUMN elo_before INTEGER;
  ALTER TABLE match_players ADD COLUMN elo_after INTEGER;`);
// Rango visible: "ladder" (ver ranked.js). NULL = en partidas de clasificación
addColumns("players", "ladder", `ALTER TABLE players ADD COLUMN ladder INTEGER;`);
addColumns("match_players", "ladder_before", `
  ALTER TABLE match_players ADD COLUMN ladder_before INTEGER;
  ALTER TABLE match_players ADD COLUMN ladder_after INTEGER;
  ALTER TABLE match_players ADD COLUMN lp_delta INTEGER;`);
db.exec("CREATE INDEX IF NOT EXISTS idx_players_ladder ON players(ladder DESC)");

// Estadísticas de cada jugador, para las tablas
const STATS = `
  SELECT p.id, p.name, p.ladder, p.elo_games AS games,
         SUM(CASE WHEN mp.position = 1 THEN 1 ELSE 0 END) AS wins,
         MAX(mp.score) AS best_score,
         SUM(mp.hits)  AS hits
  FROM players p
  JOIN match_players mp ON mp.player_id = p.id
  JOIN matches m ON m.id = mp.match_id AND m.status = 'finished'`;

const q = {
  upsertPlayer: db.prepare(`
    INSERT INTO players (id, name) VALUES (@id, @name)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = datetime('now')
  `),
  insertMatch: db.prepare(
    "INSERT INTO matches (code, region, total_rounds) VALUES (?, ?, ?)",
  ),
  insertMatchPlayer: db.prepare(
    "INSERT INTO match_players (match_id, player_id, name) VALUES (?, ?, ?)",
  ),
  insertRound: db.prepare(
    "INSERT INTO rounds (match_id, round_no, target_kind, target_id, target_name) VALUES (?, ?, ?, ?, ?)",
  ),
  insertShot: db.prepare(`
    INSERT OR IGNORE INTO shots (match_id, round_no, player_id, heading, lng, lat, is_hit, points, distance_km)
    VALUES (@matchId, @round, @playerId, @heading, @lng, @lat, @isHit, @points, @distanceKm)
  `),
  updateMatchPlayer: db.prepare(
    "UPDATE match_players SET score = ?, hits = ?, position = ? WHERE match_id = ? AND player_id = ?",
  ),
  finishMatch: db.prepare(
    "UPDATE matches SET status = ?, finished_at = datetime('now') WHERE id = ?",
  ),
  closeOrphans: db.prepare(
    "UPDATE matches SET status = 'abandoned', finished_at = datetime('now') WHERE status = 'playing'",
  ),
  player: db.prepare("SELECT id, name, elo, elo_games, ladder FROM players WHERE id = ?"),
  setPlayerRank: db.prepare(
    "UPDATE players SET elo = ?, elo_games = elo_games + 1, ladder = ? WHERE id = ?",
  ),
  setMatchRank: db.prepare(`
    UPDATE match_players SET elo_before = ?, elo_after = ?, ladder_before = ?, ladder_after = ?, lp_delta = ?
    WHERE match_id = ? AND player_id = ?`),
  // Los de una división (Hierro IV ... Diamante I): un tramo de 100 de "ladder"
  division: db.prepare(`${STATS}
    WHERE p.ladder BETWEEN ? AND ?
    GROUP BY p.id
    ORDER BY p.ladder DESC, wins DESC
    LIMIT ?`),
  // Maestro y superiores: se reparten por puesto, así que se leen todos
  masters: db.prepare(`${STATS}
    WHERE p.ladder >= ?
    GROUP BY p.id
    ORDER BY p.ladder DESC, wins DESC`),
  history: db.prepare(`
    SELECT m.id, m.region, m.finished_at, mp.score, mp.hits, mp.position,
           mp.ladder_before, mp.ladder_after, mp.lp_delta,
           (SELECT COUNT(*) FROM match_players x WHERE x.match_id = m.id) AS players
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id AND m.status = 'finished'
    WHERE mp.player_id = ?
    ORDER BY m.finished_at DESC
    LIMIT 20
  `),
};

// Si el servidor se reinició a mitad de partida, esas partidas ya no existen en memoria
q.closeOrphans.run();

/**
 * Aplica una partida terminada: MMR (Elo, oculto) y rango (LP, visible).
 * Devuelve { playerId: { lpDelta, before, after, change, placed, gamesPlayed, mmrBefore, mmrAfter } }
 */
function applyRanked(matchId, standings) {
  const rows = standings.map((s) => {
    const row = q.player.get(s.id);
    return {
      id: s.id,
      position: s.position,
      rating: row ? row.elo : Elo.START,
      games: row ? row.elo_games : 0,
      ladder: row ? row.ladder : null,
    };
  });
  const mmr = Object.fromEntries(Elo.rateMatch(rows).map((r) => [r.id, r]));
  const lp = Ranked.applyMatch(rows.map((r) => ({
    id: r.id,
    position: r.position,
    games: r.games,
    ladder: r.ladder,
    mmrBefore: r.rating,
    mmrAfter: mmr[r.id].after,
  })));

  const out = {};
  for (const r of rows) {
    const m = mmr[r.id];
    const l = lp[r.id];
    q.setPlayerRank.run(m.after, l.ladderAfter, r.id);
    q.setMatchRank.run(m.before, m.after, l.ladderBefore, l.ladderAfter, l.lpDelta, matchId, r.id);
    out[r.id] = { ...l, mmrBefore: m.before, mmrAfter: m.after };
  }
  return out;
}

// Vuelve a calcular todo desde cero, partida a partida (solo al migrar)
const recompute = db.transaction(() => {
  db.prepare(`UPDATE players SET elo = ${Elo.START}, elo_games = 0, ladder = NULL`).run();
  const matches = db
    .prepare("SELECT id FROM matches WHERE status = 'finished' ORDER BY finished_at, id")
    .all();
  const standingsOf = db.prepare(
    "SELECT player_id AS id, position FROM match_players WHERE match_id = ? AND position IS NOT NULL",
  );
  for (const m of matches) applyRanked(m.id, standingsOf.all(m.id));
  return matches.length;
});
if (needsRecompute) {
  const n = recompute();
  if (n) console.log(`MMR y rangos recalculados a partir de ${n} partidas ya jugadas`);
}

// Rango legible de un jugador (con Gran Maestro / Aspirante resueltos)
function rankOf(playerId) {
  const row = q.player.get(playerId);
  if (!row) return Ranked.describe(null, 0);
  let apex = null;
  if (row.ladder !== null && row.ladder >= Ranked.CFG.MASTER_LADDER) {
    apex = Ranked.apexTiers(q.masters.all(Ranked.CFG.MASTER_LADDER))[row.id];
  }
  return Ranked.describe(row.ladder, row.elo_games, apex);
}

/**
 * La tabla de la división del jugador. Si aún no tiene rango, tabla vacía.
 * Devuelve { me, table: { key, name } | null, ranking: [...] }
 */
function divisionTable(playerId, limit) {
  const me = rankOf(playerId);
  if (me.tier === "unranked") return { me, table: null, ranking: [] };

  let rows;
  if (me.division) {
    const row = q.player.get(playerId);
    const [lo, hi] = Ranked.divisionRange(row.ladder);
    rows = q.division.all(lo, hi, limit);
  } else {
    // Maestro, Gran Maestro y Aspirante: misma liga, ya repartida por puesto
    const all = q.masters.all(Ranked.CFG.MASTER_LADDER);
    const apex = Ranked.apexTiers(all);
    rows = all.filter((r) => apex[r.id] === me.tier).slice(0, limit);
  }
  return {
    me,
    table: { key: me.key, name: me.division ? `${me.tierName} ${me.division}` : me.tierName, tier: me.tier },
    ranking: rows.map((r, i) => ({
      position: i + 1,
      name: r.name,
      lp: Ranked.describe(r.ladder).lp,
      games: r.games,
      wins: r.wins,
      best_score: r.best_score,
      you: r.id === playerId,
    })),
  };
}

module.exports = {
  db,
  savePlayer(id, name) {
    q.upsertPlayer.run({ id, name });
  },

  // Crea la partida con sus jugadores y sus rondas en una sola transacción
  createMatch: db.transaction((code, region, targets, players) => {
    const matchId = Number(q.insertMatch.run(code, region, targets.length).lastInsertRowid);
    for (const p of players) q.insertMatchPlayer.run(matchId, p.id, p.name);
    targets.forEach((t, i) =>
      q.insertRound.run(matchId, i + 1, t.kind, t.id || null, t.name),
    );
    return matchId;
  }),

  saveShot(row) {
    q.insertShot.run({ ...row, isHit: row.isHit ? 1 : 0 });
  },

  // Cierra la partida. Si terminó de verdad (no abandonada), aplica MMR y LP y lo devuelve
  finishMatch: db.transaction((matchId, status, standings) => {
    for (const s of standings) {
      q.updateMatchPlayer.run(s.score, s.hits, s.position ?? null, matchId, s.id);
    }
    q.finishMatch.run(status, matchId);
    return status === "finished" ? applyRanked(matchId, standings) : {};
  }),

  rankOf,
  divisionTable,
  recompute,

  history(playerId) {
    return q.history.all(playerId);
  },
};
