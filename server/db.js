/* =======================================
   BASE DE DATOS (SQLite)

   Un único archivo. Por defecto en /var/lib/donde/donde.db en el
   servidor (fuera de la carpeta que publica Apache y fuera del repo,
   para que el cron de git no la toque nunca).

   Solo se guardan las partidas RANKED. Un jugador entra en la base de
   datos la primera vez que empieza una Ranked (no al abrir el juego).

   Tablas:
   - players        cada jugador de Ranked: nombre, hash de su clave secreta,
                    MMR, rango y totales (victorias, mejor puntuación, aciertos)
   - matches        las partidas Ranked terminadas
   - match_players  quién jugó cada partida, puntos, puesto y cómo cambió su rango.
                    Solo se guardan las ÚLTIMAS 20 de cada jugador (KEEP_MATCHES)
   - target_stats   por destino: cuántas veces se ha disparado y cuántas se ha acertado

   Qué NO se guarda: dónde estaba cada jugador ni cada disparo suelto,
   ni nada de las partidas Local o de Un jugador.

   El tamaño queda acotado: unos 3 KB por jugador de Ranked, por muchas
   partidas que juegue, más una fila por destino.

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
const KEEP_MATCHES = 20; // partidas que se guardan de cada jugador

// La carpeta y el archivo solo los puede leer el propio servidor
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true, mode: 0o700 });
const oldUmask = process.umask(0o077);
const db = new Database(DB_PATH);
process.umask(oldUmask);

// En una BD nueva esto deja que el archivo encoja al borrar; en una vieja se activa al migrar
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL"); // con WAL es seguro y escribe menos en disco
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
    status       TEXT NOT NULL DEFAULT 'playing',   -- playing | finished
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

  CREATE TABLE IF NOT EXISTS target_stats (
    kind        TEXT    NOT NULL,             -- country | city
    target_key  TEXT    NOT NULL,             -- código del país o nombre de la ciudad
    name        TEXT    NOT NULL,
    shots       INTEGER NOT NULL DEFAULT 0,   -- disparos a ese destino
    hits        INTEGER NOT NULL DEFAULT 0,   -- aciertos
    PRIMARY KEY (kind, target_key)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status, finished_at);
  DROP INDEX IF EXISTS idx_mp_player;
  CREATE INDEX IF NOT EXISTS idx_mp_player_match ON match_players(player_id, match_id);
`);

/* ---------- Migraciones ---------- */
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
function hasTable(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

// Columnas de la clasificatoria. En BD de antes de las ligas, al añadirlas
// se recalcula el MMR y el rango de todas las partidas ya jugadas, en orden.
let needsRecompute = false;
function addColumns(table, check, sql, recompute = true) {
  if (hasColumn(table, check)) return false;
  db.exec(sql);
  if (recompute) needsRecompute = true;
  return true;
}
addColumns("players", "elo", `
  ALTER TABLE players ADD COLUMN elo INTEGER NOT NULL DEFAULT ${Elo.START};
  ALTER TABLE players ADD COLUMN elo_games INTEGER NOT NULL DEFAULT 0;`);
addColumns("match_players", "elo_before", `
  ALTER TABLE match_players ADD COLUMN elo_before INTEGER;
  ALTER TABLE match_players ADD COLUMN elo_after INTEGER;`);
addColumns("players", "ladder", `ALTER TABLE players ADD COLUMN ladder INTEGER;`);
addColumns("match_players", "ladder_before", `
  ALTER TABLE match_players ADD COLUMN ladder_before INTEGER;
  ALTER TABLE match_players ADD COLUMN ladder_after INTEGER;
  ALTER TABLE match_players ADD COLUMN lp_delta INTEGER;`);

// Seguridad y tamaño acotado: clave secreta, totales en players, jugadores por partida
const addedTotals = addColumns("players", "secret_hash", `
  ALTER TABLE players ADD COLUMN secret_hash TEXT;
  ALTER TABLE players ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN best_score INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN hits INTEGER NOT NULL DEFAULT 0;`, false);
const addedCount = addColumns("matches", "players_count",
  `ALTER TABLE matches ADD COLUMN players_count INTEGER NOT NULL DEFAULT 0;`, false);
db.exec("CREATE INDEX IF NOT EXISTS idx_players_ladder ON players(ladder DESC)");

const q = {
  upsertPlayer: db.prepare(`
    INSERT INTO players (id, name, secret_hash) VALUES (@id, @name, @secretHash)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      last_seen = datetime('now'),
      secret_hash = COALESCE(players.secret_hash, excluded.secret_hash)
  `),
  auth: db.prepare("SELECT secret_hash FROM players WHERE id = ?"),
  setSecret: db.prepare("UPDATE players SET secret_hash = ? WHERE id = ? AND secret_hash IS NULL"),
  insertMatch: db.prepare(
    "INSERT INTO matches (code, region, total_rounds, players_count) VALUES (?, ?, ?, ?)",
  ),
  insertMatchPlayer: db.prepare(
    "INSERT INTO match_players (match_id, player_id, name) VALUES (?, ?, ?)",
  ),
  updateMatchPlayer: db.prepare(
    "UPDATE match_players SET score = ?, hits = ?, position = ? WHERE match_id = ? AND player_id = ?",
  ),
  finishMatch: db.prepare("UPDATE matches SET status = 'finished', finished_at = datetime('now') WHERE id = ?"),
  deleteMatch: db.prepare("DELETE FROM matches WHERE id = ?"),
  // Si el servidor se reinició a mitad de partida, esas partidas no cuentan
  deleteUnfinished: db.prepare("DELETE FROM matches WHERE status != 'finished'"),
  player: db.prepare("SELECT id, name, elo, elo_games, ladder FROM players WHERE id = ?"),
  setPlayerRank: db.prepare(
    "UPDATE players SET elo = ?, elo_games = elo_games + 1, ladder = ? WHERE id = ?",
  ),
  setMatchRank: db.prepare(`
    UPDATE match_players SET elo_before = ?, elo_after = ?, ladder_before = ?, ladder_after = ?, lp_delta = ?
    WHERE match_id = ? AND player_id = ?`),
  addTotals: db.prepare(`
    UPDATE players SET wins = wins + ?, hits = hits + ?, best_score = MAX(best_score, ?) WHERE id = ?`),
  addTargetStats: db.prepare(`
    INSERT INTO target_stats (kind, target_key, name, shots, hits) VALUES (@kind, @key, @name, @shots, @hits)
    ON CONFLICT(kind, target_key) DO UPDATE SET shots = shots + excluded.shots, hits = hits + excluded.hits`),
  // Partidas de un jugador más allá de las últimas KEEP_MATCHES
  oldMatchesOf: db.prepare(
    `SELECT match_id FROM match_players WHERE player_id = ? ORDER BY match_id DESC LIMIT -1 OFFSET ${KEEP_MATCHES}`,
  ),
  dropMatchPlayer: db.prepare("DELETE FROM match_players WHERE match_id = ? AND player_id = ?"),
  dropIfEmpty: db.prepare(
    "DELETE FROM matches WHERE id = ? AND NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = ?)",
  ),
  // Los de una división (Hierro IV ... Diamante I): un tramo de 100 de "ladder"
  division: db.prepare(`
    SELECT id, name, ladder, elo_games AS games, wins, best_score FROM players
    WHERE ladder BETWEEN ? AND ?
    ORDER BY ladder DESC, wins DESC
    LIMIT ?`),
  // Maestro y superiores: se reparten por puesto, así que se leen todos
  masters: db.prepare(`
    SELECT id, name, ladder, elo_games AS games, wins, best_score FROM players
    WHERE ladder >= ?
    ORDER BY ladder DESC, wins DESC`),
  history: db.prepare(`
    SELECT m.id, m.region, m.finished_at, mp.score, mp.hits, mp.position,
           mp.ladder_before, mp.ladder_after, mp.lp_delta, m.players_count AS players
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id AND m.status = 'finished'
    WHERE mp.player_id = ?
    ORDER BY m.id DESC
    LIMIT ${KEEP_MATCHES}
  `),
};

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

// Deja a cada jugador solo con sus últimas KEEP_MATCHES partidas y borra
// las partidas que se quedan sin nadie
function prunePlayer(playerId) {
  for (const { match_id } of q.oldMatchesOf.all(playerId)) {
    q.dropMatchPlayer.run(match_id, playerId);
    q.dropIfEmpty.run(match_id, match_id);
  }
}

/* ---------- Migración a la BD acotada ----------
   Para BD creadas antes: pasa los totales a players, resume los disparos en
   target_stats y borra lo que ya no se guarda (disparos con ubicación, rondas,
   partidas abandonadas, jugadores que nunca jugaron y partidas antiguas). */
const migrateBounded = db.transaction(() => {
  // Si es una BD de antes de las ligas: primero se recalcula todo, con todas las partidas
  if (needsRecompute) {
    db.prepare(`UPDATE players SET elo = ${Elo.START}, elo_games = 0, ladder = NULL`).run();
    const matches = db.prepare("SELECT id FROM matches WHERE status = 'finished' ORDER BY finished_at, id").all();
    const standingsOf = db.prepare(
      "SELECT player_id AS id, position FROM match_players WHERE match_id = ? AND position IS NOT NULL",
    );
    for (const m of matches) applyRanked(m.id, standingsOf.all(m.id));
    if (matches.length) console.log(`MMR y rangos recalculados a partir de ${matches.length} partidas ya jugadas`);
  }

  if (addedTotals) {
    db.exec(`
      UPDATE players SET
        wins = (SELECT COUNT(*) FROM match_players mp WHERE mp.player_id = players.id AND mp.position = 1),
        best_score = COALESCE((SELECT MAX(score) FROM match_players mp WHERE mp.player_id = players.id), 0),
        hits = COALESCE((SELECT SUM(hits) FROM match_players mp WHERE mp.player_id = players.id), 0);`);
  }
  if (addedCount) {
    db.exec(`UPDATE matches SET players_count =
      (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = matches.id);`);
  }

  if (hasTable("shots") && hasTable("rounds")) {
    db.exec(`
      INSERT INTO target_stats (kind, target_key, name, shots, hits)
        SELECT r.target_kind, COALESCE(r.target_id, r.target_name), MAX(r.target_name),
               COUNT(*), SUM(s.is_hit)
        FROM shots s JOIN rounds r ON r.match_id = s.match_id AND r.round_no = s.round_no
        GROUP BY r.target_kind, COALESCE(r.target_id, r.target_name)
      ON CONFLICT(kind, target_key) DO UPDATE SET shots = shots + excluded.shots, hits = hits + excluded.hits;`);
  }
  db.exec("DROP TABLE IF EXISTS shots; DROP TABLE IF EXISTS rounds;");

  // Jugadores sin ninguna partida (antes se creaban solo por abrir el modo online)
  const junk = db.prepare(`DELETE FROM players WHERE elo_games = 0
    AND NOT EXISTS (SELECT 1 FROM match_players mp WHERE mp.player_id = players.id)`).run().changes;
  if (junk) console.log(`Borrados ${junk} jugadores que nunca terminaron una Ranked`);

  for (const { id } of db.prepare("SELECT id FROM players").all()) prunePlayer(id);
  db.pragma("user_version = 2");
});

const sizeBefore = fs.statSync(DB_PATH).size;
q.deleteUnfinished.run();
if (db.pragma("user_version", { simple: true }) < 2) migrateBounded();
// Las BD antiguas no podían encoger: se activa y se compacta una vez
if (db.pragma("auto_vacuum", { simple: true }) !== 2) {
  db.exec("VACUUM");
  db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(`BD compactada: ${(sizeBefore / 1024).toFixed(0)} KB → ${(fs.statSync(DB_PATH).size / 1024).toFixed(0)} KB`);
}
try { fs.chmodSync(DB_PATH, 0o600); } catch {}

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
  KEEP_MATCHES,

  // Hash de la clave del jugador (o undefined si aún no ha jugado ninguna Ranked)
  secretHashOf(id) {
    const row = q.auth.get(id);
    return row ? row.secret_hash : undefined;
  },
  // Para jugadores de antes de las claves: la primera clave que llega se queda
  claimSecret(id, hash) {
    return q.setSecret.run(hash, id).changes === 1;
  },

  // Crea la partida y, si hacía falta, los jugadores. players: [{ id, name, secretHash }]
  createMatch: db.transaction((code, region, totalRounds, players) => {
    for (const p of players) q.upsertPlayer.run({ id: p.id, name: p.name, secretHash: p.secretHash || null });
    const matchId = Number(q.insertMatch.run(code, region, totalRounds, players.length).lastInsertRowid);
    for (const p of players) q.insertMatchPlayer.run(matchId, p.id, p.name);
    return matchId;
  }),

  /**
   * Cierra una partida terminada: puntos, MMR y LP, totales del jugador,
   * estadísticas por destino y recorte a las últimas partidas.
   * targetStats: [{ kind, key, name, shots, hits }]
   */
  finishMatch: db.transaction((matchId, standings, targetStats = []) => {
    for (const s of standings) {
      q.updateMatchPlayer.run(s.score, s.hits, s.position ?? null, matchId, s.id);
      q.addTotals.run(s.position === 1 ? 1 : 0, s.hits, s.score, s.id);
    }
    q.finishMatch.run(matchId);
    const out = applyRanked(matchId, standings);
    for (const t of targetStats) if (t.shots > 0) q.addTargetStats.run(t);
    for (const s of standings) prunePlayer(s.id);
    return out;
  }),

  // Una partida que no se terminó no cuenta: se borra entera
  discardMatch(matchId) {
    q.deleteMatch.run(matchId);
  },

  rankOf,
  divisionTable,

  history(playerId) {
    return q.history.all(playerId);
  },

  // Devuelve al disco el espacio de lo borrado, poco a poco (barato)
  maintenance() {
    db.pragma("incremental_vacuum(500)");
    db.pragma("optimize");
  },
};
