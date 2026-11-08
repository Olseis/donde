/* Prueba de punta a punta: arranca el servidor con una BD temporal,
   simula 3 móviles que juegan una partida completa y comprueba la BD y el ranking.
   Uso:  npm test  */
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const assert = require("assert");
const WebSocket = require("ws");

const PORT = 3999;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "donde-")), "test.db");

function startServer() {
  const proc = spawn(process.execPath, [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT, DB_PATH: DB },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve) => proc.stdout.on("data", (d) => /escuchando|en http/.test(d) && resolve(proc)));
}

class Client {
  constructor(name, origin = "https://localhost", headers = {}) {
    this.name = name;
    this.id = `test-${name}-${Math.random().toString(36).slice(2, 10)}`;
    this.inbox = [];
    this.waiters = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin, headers });
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.inbox.push(msg);
    });
    this.open = new Promise((r, j) => { this.ws.on("open", r); this.ws.on("error", j); });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  // Se identifica y guarda la clave que le da el servidor (como hace el móvil)
  async hello() {
    this.send({ t: "hello", playerId: this.id, secret: this.secret, name: this.name, terms: "2026-11-08" });
    const w = await this.wait((m) => m.t === "welcome" || m.t === "error");
    if (w.t === "error") throw Object.assign(new Error(w.message), { code: w.code });
    if (w.secret) this.secret = w.secret;
    this.publicId = w.publicId;
    return w;
  }
  wait(pred, ms = 5000) {
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error(`${this.name}: timeout esperando mensaje`)), ms);
    });
  }
  waitT(t, extra = () => true) { return this.wait((m) => m.t === t && extra(m)); }
}

/* ---------- Las pruebas de la auditoría de seguridad ---------- */
async function seguridad(ana, beto, db) {
  // 1. Suplantación: con el identificador de Ana pero sin su clave, el servidor no deja entrar
  const impostor = new Client("Impostor"); await impostor.open;
  impostor.id = ana.id;
  await assert.rejects(impostor.hello(), (e) => e.code === "bad_secret");
  impostor.secret = "A".repeat(43);
  await assert.rejects(impostor.hello(), (e) => e.code === "bad_secret");
  // Con la clave buena, sí (es el móvil de Ana de verdad)
  const ana3 = new Client("Ana"); await ana3.open;
  Object.assign(ana3, { id: ana.id, secret: ana.secret });
  assert.ok(!(await ana3.hello()).secret, "a un jugador que ya tiene clave no se le da otra");
  console.log("✔ sin la clave no se puede jugar con la cuenta de otro");

  // Lo mismo en una sala con alguien que aún no está en la BD (nunca jugó Ranked)
  const nuevo = new Client("Nuevo"); await nuevo.open; await nuevo.hello();
  nuevo.send({ t: "create", region: "Europa", ranked: false });
  const sala = (await nuevo.waitT("room")).room.code;
  const copia = new Client("Copia"); await copia.open;
  copia.id = nuevo.id; await copia.hello(); // otra clave distinta
  copia.send({ t: "join", code: sala, ranked: false });
  assert.strictEqual((await copia.waitT("error")).code, "in_use");
  console.log("✔ en una sala tampoco se puede echar a nadie usando su identificador");

  // 2. Historial: solo con la clave
  const hist = (body) => fetch(`http://127.0.0.1:${PORT}/api/online/history`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.strictEqual((await hist({ playerId: ana.id })).status, 403);
  assert.strictEqual((await hist({ playerId: ana.id, secret: beto.secret })).status, 403);
  const h = await (await hist({ playerId: ana.id, secret: ana.secret })).json();
  assert.strictEqual(h.matches.length, 1);
  assert.strictEqual(h.matches[0].players, 3);
  assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/api/online/history?playerId=${ana.id}`)).status, 404);
  console.log("✔ el historial solo lo ve su dueño");

  // 3. Saludar no crea filas en la BD
  const before = db.prepare("SELECT COUNT(*) n FROM players").get().n;
  const spam = new Client("Spam"); await spam.open;
  for (let i = 0; i < 30; i++) spam.send({ t: "hello", playerId: `spam-${i}-xxxxxxxx`, name: "Spam" });
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM players").get().n, before);
  console.log("✔ abrir el modo online no crea jugadores en la BD");

  // 4. X-Forwarded-For falso: cuenta la IP que añade Apache (la última), no la inventada
  const conns = [];
  let rejected = 0;
  for (let i = 0; i < 16; i++) {
    // La mitad como lo manda Apache con X-Real-IP y la otra mitad solo con X-Forwarded-For
    const headers = i % 2
      ? { "X-Forwarded-For": `10.0.0.${i}`, "X-Real-IP": "203.0.113.7" }
      : { "X-Forwarded-For": `10.0.0.${i}, 203.0.113.7` };
    const c = new Client(`ip${i}`, "https://localhost", headers);
    conns.push(c);
    await c.open.catch(() => rejected++);
  }
  assert.strictEqual(rejected, 4, "solo 12 conexiones por IP aunque se invente la cabecera");
  console.log("✔ no se puede saltar el límite por IP inventando X-Forwarded-For");

  // 5. Salas por IP: como mucho 3 abiertas a la vez
  const errors = [];
  for (const c of conns.slice(0, 4)) {
    if (c.ws.readyState !== 1) continue;
    await c.hello();
    c.send({ t: "create", region: "Europa", ranked: false });
    const m = await c.wait((x) => x.t === "room" || x.t === "error");
    if (m.t === "error") errors.push(m.code);
  }
  assert.deepStrictEqual(errors, ["too_many_rooms"]);
  console.log("✔ como mucho 3 salas abiertas por IP");
  conns.forEach((c) => c.ws.terminate());

  // 6. Mis datos: descargar y borrar (RGPD), solo con la clave
  const api = (path, body) => fetch(`http://127.0.0.1:${PORT}/api/online/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.strictEqual((await api("me", { playerId: ana.id })).status, 403);
  assert.strictEqual((await api("delete", { playerId: ana.id, secret: beto.secret })).status, 403);
  const mine = await (await api("me", { playerId: ana.id, secret: ana.secret })).json();
  assert.strictEqual(mine.player.name, "Ana");
  assert.strictEqual(mine.player.terms_version, "2026-11-08", "se guarda qué condiciones aceptó");
  assert.strictEqual(mine.player.matches.length, 1);
  assert(!JSON.stringify(mine).includes("secret_hash") && !JSON.stringify(mine).includes(ana.secret));
  const nobody = await (await api("me", { playerId: "nunca-jugo-0001" })).json();
  assert.strictEqual(nobody.player, null);
  assert.deepStrictEqual(await (await api("delete", { playerId: ana.id, secret: ana.secret })).json(), { deleted: true });
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM players WHERE id = ?").get(ana.id).n, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM match_players WHERE player_id = ?").get(ana.id).n, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM match_players WHERE player_id = ?").get(beto.id).n, 1,
    "la partida sigue para los demás");
  const again = new Client("Ana"); await again.open; again.id = ana.id;
  assert.ok((await again.hello()).secret, "tras borrar, ese móvil empieza de cero");
  console.log("✔ descargar y borrar mis datos");

  // 7. API: 60 peticiones por minuto y por IP
  let limited = 0;
  for (let i = 0; i < 70; i++) {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { headers: { "X-Forwarded-For": `1.1.1.${i}, 198.51.100.9` } });
    if (r.status === 429) limited++;
  }
  assert(limited >= 9, "la API corta a partir de 60 por minuto");
  console.log("✔ límite de peticiones en la API");
}

(async () => {
  const proc = await startServer();
  try {
    // Origen no permitido: el servidor rechaza la conexión
    await assert.rejects(new Client("malo", "https://evil.example").open);

    const ana = new Client("Ana"), beto = new Client("Beto"), cris = new Client("Cris");
    await Promise.all([ana.open, beto.open, cris.open]);
    for (const c of [ana, beto, cris]) {
      const w = await c.hello();
      assert.match(w.secret, /^[A-Za-z0-9_-]{43}$/, "el servidor da una clave nueva");
    }

    // Nombre con HTML: rechazado
    const raro = new Client("raro"); await raro.open;
    raro.send({ t: "hello", playerId: "test-raro-123456", name: "<script>" });
    assert.strictEqual((await raro.waitT("error")).code, "bad_name");

    ana.send({ t: "create", region: "Europa", ranked: true });
    const { room } = await ana.waitT("room");
    assert.match(room.code, /^[A-Z2-9]{4}$/);
    console.log("Sala creada:", room.code);

    // Un código de Ranked no vale desde Local
    beto.send({ t: "join", code: room.code, ranked: false });
    assert.strictEqual((await beto.waitT("error")).code, "wrong_mode");
    beto.send({ t: "join", code: room.code.toLowerCase(), ranked: true }); // el código no distingue mayúsculas
    cris.send({ t: "join", code: room.code, ranked: true });
    const full = (await ana.waitT("room", (m) => m.room.players.length === 3)).room;
    // Los demás solo ven alias, nunca el identificador privado de nadie
    const ids = [ana.id, beto.id, cris.id];
    assert(full.players.every((p) => !ids.includes(p.id)) && !ids.includes(full.hostId));
    assert.strictEqual(full.hostId, ana.publicId);

    // Beto intenta empezar sin ser anfitrión
    beto.send({ t: "start" });
    assert.strictEqual((await beto.waitT("error")).code, "not_host");

    // Ana intenta empezar sin ubicaciones
    ana.send({ t: "start" });
    assert.strictEqual((await ana.waitT("error")).code, "not_ready");

    ana.send({ t: "location", location: [-3.7038, 40.4168] });   // Madrid
    beto.send({ t: "location", location: [2.3522, 48.8566] });   // París
    cris.send({ t: "location", location: [12.4964, 41.9028] });  // Roma
    await ana.waitT("room", (m) => m.room.players.every((p) => p.ready));

    ana.send({ t: "start" });
    let total = 0;
    for (let r = 1; r <= 10; r++) {
      const rounds = await Promise.all([ana, beto, cris].map((c) => c.waitT("round", (m) => m.round === r)));
      const target = rounds[0].target;
      assert(rounds.every((m) => m.target.name === target.name), "todos ven el mismo destino");
      assert(!["ESP", "FRA", "ITA"].includes(target.id), "nunca sale el país de un jugador");

      // Cada uno apunta a un sitio distinto; Cris intenta disparar dos veces
      ana.send({ t: "shot", round: r, heading: 45 });
      beto.send({ t: "shot", round: r, heading: 120 });
      cris.send({ t: "shot", round: r, heading: 300 });
      cris.send({ t: "shot", round: r, heading: 90 });

      const results = await Promise.all([ana, beto, cris].map((c) => c.waitT("roundResult", (m) => m.round === r)));
      assert.strictEqual(results[0].results.length, 3);
      total += results[0].results.reduce((s, x) => s + x.points, 0);
      if (r < 10) for (const c of [ana, beto, cris]) c.send({ t: "next", round: r });
      process.stdout.write(`ronda ${r}: ${target.name} → ${results[0].results.map((x) => `${x.name} ${x.points}`).join(", ")}\n`);
    }

    const fin = await ana.waitT("finished");
    assert.strictEqual(fin.standings.length, 3);
    assert.strictEqual(fin.standings.reduce((s, p) => s + p.score, 0), total);
    console.log("Clasificación:", fin.standings.map((p) => `${p.position}. ${p.name} ${p.score}`).join(" | "));

    // Elo: todos empiezan en 1000; el primero sube, el último baja y la suma no cambia
    for (const p of fin.standings) assert.strictEqual(p.eloBefore, 1000);
    const first = fin.standings[0], last = fin.standings[fin.standings.length - 1];
    if (first.position !== last.position) {
      assert(first.eloDelta > 0 && last.eloDelta < 0, "Elo: gana el primero, pierde el último");
    }
    assert(Math.abs(fin.standings.reduce((s, p) => s + p.eloDelta, 0)) <= 1, "el Elo se reparte, no se crea");
    console.log("Elo:", fin.standings.map((p) => `${p.name} ${p.eloAfter} (${p.eloDelta >= 0 ? "+" : ""}${p.eloDelta})`).join(" | "));

    // La BD tiene la partida y las estadísticas de los 10 destinos: 30 disparos (el segundo de Cris no cuenta)
    const db = require("better-sqlite3")(DB, { readonly: true });
    assert.strictEqual(db.prepare("SELECT status FROM matches WHERE id = ?").get(fin.matchId).status, "finished");
    assert.strictEqual(db.prepare("SELECT SUM(shots) n FROM target_stats").get().n, 30);
    const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    assert(!tablas.includes("shots") && !tablas.includes("rounds"), "no hay tabla de disparos");
    for (const t of tablas) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      assert(!cols.includes("lat") && !cols.includes("lng"), `la tabla ${t} no guarda ubicaciones`);
    }
    // Solo el hash de la clave
    const row = db.prepare("SELECT secret_hash FROM players WHERE id = ?").get(ana.id);
    assert.match(row.secret_hash, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(row.secret_hash, ana.secret);

    const ranking = await (await fetch(`http://127.0.0.1:${PORT}/api/online/ranking?playerId=${ana.id}`)).json();
    // Primera partida: todos siguen en clasificación (1/5) y no tienen tabla todavía
    assert.strictEqual(ranking.me.label, "Clasificación 1/5");
    assert.strictEqual(ranking.table, null);
    for (const p of fin.standings) {
      assert.strictEqual(p.placement, 1);
      assert.strictEqual(p.lpDelta, 0);
      assert.strictEqual(p.rankAfter, "Clasificación 1/5");
    }
    const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
    assert(health.ok);

    // Segunda partida: Beto cierra la app a mitad de ronda y la partida sigue sin esperarle
    const ana2 = new Client("Ana2"), beto2 = new Client("Beto2");
    await Promise.all([ana2.open, beto2.open]);
    for (const c of [ana2, beto2]) await c.hello();
    ana2.send({ t: "create", region: "España", ranked: false }); // sala Local
    const sala2 = (await ana2.waitT("room")).room.code;
    beto2.send({ t: "join", code: sala2 });
    ana2.send({ t: "location", location: [-6.3437, 38.9161] }); // Mérida
    beto2.send({ t: "location", location: [-3.7038, 40.4168] });
    await ana2.waitT("room", (m) => m.room.players.length === 2 && m.room.players.every((p) => p.ready));
    ana2.send({ t: "start" });
    const r1 = await ana2.waitT("round");
    assert.strictEqual(r1.target.kind, "city");
    beto2.ws.terminate();
    ana2.send({ t: "shot", round: 1, heading: 10 });
    const res2 = await ana2.waitT("roundResult");
    const beto2Res = res2.results.find((r) => r.name === "Beto2");
    assert(beto2Res.timedOut && beto2Res.points === 0, "quien se va se lleva 0 en esa ronda");
    console.log("Desconexión a mitad de ronda: la partida sigue ✔");

    // La sala Local cuenta puntos pero no guarda nada
    const r1Points = res2.results.find((r) => r.name === "Ana2").points;
    assert(typeof r1Points === "number", "en Local también hay puntos para saber quién gana");
    ana2.send({ t: "next", round: 1 });
    for (let r = 2; r <= 10; r++) {
      await ana2.waitT("round", (m) => m.round === r);
      ana2.send({ t: "shot", round: r, heading: 10 });
      await ana2.waitT("roundResult", (m) => m.round === r);
      if (r < 10) ana2.send({ t: "next", round: r });
    }
    const fin2 = await ana2.waitT("finished");
    assert.strictEqual(fin2.matchId, null, "Local: no hay partida en la BD");
    assert(fin2.standings.every((p) => p.lpDelta === undefined), "Local: sin LP");
    const dbl = require("better-sqlite3")(DB, { readonly: true });
    assert.strictEqual(dbl.prepare("SELECT COUNT(*) n FROM matches").get().n, 1, "solo se guardó la Ranked");
    assert.strictEqual(dbl.prepare("SELECT COUNT(*) n FROM match_players WHERE player_id = ?").get(ana2.id).n, 0);
    assert.strictEqual(dbl.prepare("SELECT COUNT(*) n FROM players WHERE id IN (?, ?)").get(ana2.id, beto2.id).n, 0,
      "Local: los jugadores ni siquiera entran en la BD");
    console.log("Sala Local: ganador anunciado, nada guardado ✔");

    await seguridad(ana, beto, dbl);

    console.log("\n✅ Todas las comprobaciones han pasado");
    process.exitCode = 0;
  } catch (e) {
    console.error("\n❌", e);
    process.exitCode = 1;
  } finally {
    proc.kill();
    setTimeout(() => process.exit(), 200);
  }
})();
