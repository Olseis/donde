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
   ======================================= */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

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
  ranking: db.prepare(`
    SELECT p.name,
           COUNT(*)                                 AS games,
           SUM(CASE WHEN mp.position = 1 THEN 1 ELSE 0 END) AS wins,
           SUM(mp.score)                            AS total_points,
           MAX(mp.score)                            AS best_score,
           SUM(mp.hits)                             AS hits,
           SUM(m.total_rounds)                      AS rounds,
           mp.player_id = @me                       AS you
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id AND m.status = 'finished'
    JOIN players p ON p.id = mp.player_id
    GROUP BY mp.player_id
    ORDER BY wins DESC, total_points DESC
    LIMIT @limit
  `),
  history: db.prepare(`
    SELECT m.id, m.region, m.finished_at, mp.score, mp.hits, mp.position,
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

  finishMatch: db.transaction((matchId, status, standings) => {
    for (const s of standings) {
      q.updateMatchPlayer.run(s.score, s.hits, s.position ?? null, matchId, s.id);
    }
    q.finishMatch.run(status, matchId);
  }),

  ranking(limit, me) {
    return q.ranking.all({ limit, me: me || "" }).map((r) => ({ ...r, you: !!r.you }));
  },

  history(playerId) {
    return q.history.all(playerId);
  },
};
