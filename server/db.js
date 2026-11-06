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

   Elo: players.elo / players.elo_games guardan el Elo actual, y
   match_players.elo_before / elo_after cuánto tenía cada uno antes y
   después de cada partida (para el historial).
   ======================================= */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const WWW_DIR = process.env.WWW_DIR || path.join(__dirname, "..", "www");
const Elo = require(path.join(WWW_DIR, "elo.js"));

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

/* ---------- Migración: columnas de Elo ----------
   Las bases de datos creadas antes del Elo no tienen estas columnas.
   Se añaden y se recalcula el Elo de todas las partidas ya jugadas, en orden. */
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
let needsRecompute = false;
if (!hasColumn("players", "elo")) {
  db.exec(`
    ALTER TABLE players ADD COLUMN elo INTEGER NOT NULL DEFAULT ${Elo.START};
    ALTER TABLE players ADD COLUMN elo_games INTEGER NOT NULL DEFAULT 0;
  `);
  needsRecompute = true;
}
if (!hasColumn("match_players", "elo_before")) {
  db.exec(`
    ALTER TABLE match_players ADD COLUMN elo_before INTEGER;
    ALTER TABLE match_players ADD COLUMN elo_after INTEGER;
  `);
  needsRecompute = true;
}
db.exec("CREATE INDEX IF NOT EXISTS idx_players_elo ON players(elo DESC)");

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
  // Ranking online: ordenado por Elo; solo jugadores con al menos una partida terminada
  ranking: db.prepare(`
    SELECT p.name,
           p.elo,
           p.elo_games                              AS games,
           SUM(CASE WHEN mp.position = 1 THEN 1 ELSE 0 END) AS wins,
           SUM(mp.score)                            AS total_points,
           MAX(mp.score)                            AS best_score,
           SUM(mp.hits)                             AS hits,
           SUM(m.total_rounds)                      AS rounds,
           p.id = @me                               AS you
    FROM players p
    JOIN match_players mp ON mp.player_id = p.id
    JOIN matches m ON m.id = mp.match_id AND m.status = 'finished'
    WHERE p.elo_games > 0
    GROUP BY p.id
    ORDER BY p.elo DESC, wins DESC
    LIMIT @limit
  `),
  playerElo: db.prepare("SELECT id, elo, elo_games FROM players WHERE id = ?"),
  setPlayerElo: db.prepare("UPDATE players SET elo = ?, elo_games = elo_games + 1 WHERE id = ?"),
  setMatchElo: db.prepare(
    "UPDATE match_players SET elo_before = ?, elo_after = ? WHERE match_id = ? AND player_id = ?",
  ),
  history: db.prepare(`
    SELECT m.id, m.region, m.finished_at, mp.score, mp.hits, mp.position, mp.elo_before, mp.elo_after,
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

// Aplica el Elo de una partida terminada. Devuelve { playerId: {before, after, delta} }
function applyElo(matchId, standings) {
  const players = standings.map((s) => {
    const row = q.playerElo.get(s.id);
    return { id: s.id, rating: row ? row.elo : Elo.START, games: row ? row.elo_games : 0, position: s.position };
  });
  const out = {};
  for (const r of Elo.rateMatch(players)) {
    q.setPlayerElo.run(r.after, r.id);
    q.setMatchElo.run(r.before, r.after, matchId, r.id);
    out[r.id] = { before: r.before, after: r.after, delta: r.delta };
  }
  return out;
}

// Vuelve a calcular el Elo de todos desde cero, partida a partida (solo al migrar)
const recomputeElo = db.transaction(() => {
  db.prepare(`UPDATE players SET elo = ${Elo.START}, elo_games = 0`).run();
  const matches = db
    .prepare("SELECT id FROM matches WHERE status = 'finished' ORDER BY finished_at, id")
    .all();
  const standingsOf = db.prepare(
    "SELECT player_id AS id, position FROM match_players WHERE match_id = ? AND position IS NOT NULL",
  );
  for (const m of matches) applyElo(m.id, standingsOf.all(m.id));
  return matches.length;
});
if (needsRecompute) {
  const n = recomputeElo();
  if (n) console.log(`Elo recalculado a partir de ${n} partidas ya jugadas`);
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

  // Cierra la partida. Si terminó de verdad (no abandonada), aplica el Elo y lo devuelve
  finishMatch: db.transaction((matchId, status, standings) => {
    for (const s of standings) {
      q.updateMatchPlayer.run(s.score, s.hits, s.position ?? null, matchId, s.id);
    }
    q.finishMatch.run(status, matchId);
    return status === "finished" ? applyElo(matchId, standings) : {};
  }),

  playerElo(playerId) {
    const row = q.playerElo.get(playerId);
    return row ? { elo: row.elo, games: row.elo_games } : { elo: Elo.START, games: 0 };
  },

  recomputeElo,

  ranking(limit, me) {
    return q.ranking.all({ limit, me: me || "" }).map((r) => ({ ...r, you: !!r.you }));
  },

  history(playerId) {
    return q.history.all(playerId);
  },
};
