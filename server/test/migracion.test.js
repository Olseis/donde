/* Migración de una BD del formato anterior (con tabla de disparos, ubicaciones,
   jugadores creados solo por saludar y partidas abandonadas) al formato acotado.
   Uso:  node test/migracion.test.js  */
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "donde-migr-"));
const DB = path.join(dir, "vieja.db");

// 1. BD con el esquema anterior, rellenada a mano
const old = new Database(DB);
old.pragma("journal_mode = WAL");
old.exec(`
  CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    elo INTEGER NOT NULL DEFAULT 1000, elo_games INTEGER NOT NULL DEFAULT 0, ladder INTEGER);
  CREATE TABLE matches (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, region TEXT NOT NULL,
    total_rounds INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'playing',
    started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT);
  CREATE TABLE match_players (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id), name TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
    hits INTEGER NOT NULL DEFAULT 0, position INTEGER, elo_before INTEGER, elo_after INTEGER,
    ladder_before INTEGER, ladder_after INTEGER, lp_delta INTEGER, PRIMARY KEY (match_id, player_id));
  CREATE TABLE rounds (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, round_no INTEGER NOT NULL,
    target_kind TEXT NOT NULL, target_id TEXT, target_name TEXT NOT NULL, PRIMARY KEY (match_id, round_no));
  CREATE TABLE shots (match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, round_no INTEGER NOT NULL,
    player_id TEXT NOT NULL REFERENCES players(id), heading REAL, lng REAL, lat REAL, is_hit INTEGER NOT NULL,
    points INTEGER NOT NULL, distance_km INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (match_id, round_no, player_id));
  CREATE INDEX idx_mp_player ON match_players(player_id);
`);
const ins = {
  player: old.prepare("INSERT INTO players (id, name, elo, elo_games, ladder) VALUES (?, ?, ?, ?, ?)"),
  match: old.prepare("INSERT INTO matches (code, region, total_rounds, status, finished_at) VALUES ('X', 'Europa', 10, ?, datetime('now'))"),
  mp: old.prepare("INSERT INTO match_players (match_id, player_id, name, score, hits, position) VALUES (?, ?, ?, ?, ?, ?)"),
  round: old.prepare("INSERT INTO rounds VALUES (?, ?, 'country', ?, ?)"),
  shot: old.prepare("INSERT INTO shots (match_id, round_no, player_id, heading, lng, lat, is_hit, points) VALUES (?, ?, ?, 90, -3.7, 40.4, ?, ?)"),
};
old.transaction(() => {
  ins.player.run("veterano-0001", "Vera", 1100, 30, 1250);
  ins.player.run("rival-000001", "Rui", 900, 30, 800);
  for (let i = 0; i < 500; i++) ins.player.run(`basura-${i}-xxxx`, "Spam", 1000, 0, null); // solo saludaron
  for (let g = 1; g <= 30; g++) {
    const m = ins.match.run("finished").lastInsertRowid;
    ins.mp.run(m, "veterano-0001", "Vera", 600 + g, 5, 1);
    ins.mp.run(m, "rival-000001", "Rui", 300, 2, 2);
    for (let r = 1; r <= 10; r++) {
      ins.round.run(m, r, r % 2 ? "FRA" : "DEU", r % 2 ? "Francia" : "Alemania");
      ins.shot.run(m, r, "veterano-0001", 1, 100);
      ins.shot.run(m, r, "rival-000001", 0, 10);
    }
  }
  const ab = ins.match.run("abandoned").lastInsertRowid; // partida que se quedó a medias
  ins.mp.run(ab, "veterano-0001", "Vera", 50, 0, null);
})();
old.close();
const sizeBefore = fs.statSync(DB).size + (fs.existsSync(DB + "-wal") ? fs.statSync(DB + "-wal").size : 0);

// 2. Arranca el código nuevo sobre esa BD (en otro proceso, como el servidor)
const log = execFileSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "..", "db.js"))})`], {
  env: { ...process.env, DB_PATH: DB },
}).toString();
process.stdout.write(log.replace(/^/gm, "  "));

// 3. Comprobaciones
const db = new Database(DB, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
assert(!tables.includes("shots") && !tables.includes("rounds"), "se borran disparos y rondas");
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM players").get().n, 2, "fuera los 500 jugadores basura");
const vera = db.prepare("SELECT elo, elo_games, ladder, wins, best_score, hits, secret_hash FROM players WHERE id = 'veterano-0001'").get();
assert.deepStrictEqual(vera, { elo: 1100, elo_games: 30, ladder: 1250, wins: 30, best_score: 630, hits: 150, secret_hash: null },
  "rango y MMR intactos; totales calculados con TODAS las partidas antes de recortar");
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM match_players WHERE player_id = 'veterano-0001'").get().n, 20);
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM matches").get().n, 20, "fuera las 10 más viejas y la abandonada");
assert.strictEqual(db.prepare("SELECT MIN(players_count) n FROM matches").get().n, 2);
const stats = db.prepare("SELECT target_key, shots, hits FROM target_stats ORDER BY target_key").all();
assert.deepStrictEqual(stats, [{ target_key: "DEU", shots: 300, hits: 150 }, { target_key: "FRA", shots: 300, hits: 150 }],
  "los 600 disparos quedan resumidos en 2 filas");
assert.strictEqual(db.pragma("auto_vacuum", { simple: true }), 2, "la BD ya puede encoger sola");
assert.strictEqual(db.pragma("user_version", { simple: true }), 2);
const mode = fs.statSync(DB).mode & 0o777;
assert.strictEqual(mode, 0o600, "solo el servidor puede leer el archivo");
const sizeAfter = fs.statSync(DB).size;
console.log(`✔ migración: ${(sizeBefore / 1024).toFixed(0)} KB → ${(sizeAfter / 1024).toFixed(0)} KB, sin ubicaciones ni basura`);

// 4. Arrancar otra vez no vuelve a migrar ni toca nada
const again = execFileSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "..", "db.js"))})`], {
  env: { ...process.env, DB_PATH: DB },
}).toString();
assert.strictEqual(again.trim(), "", "la segunda vez no hay nada que migrar");
console.log("✔ la migración solo se hace una vez");
console.log("\n✅ Migración correcta");
