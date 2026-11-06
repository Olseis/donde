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
  constructor(name, origin = "https://localhost") {
    this.name = name;
    this.id = `test-${name}-${Math.random().toString(36).slice(2, 10)}`;
    this.inbox = [];
    this.waiters = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { origin });
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.inbox.push(msg);
    });
    this.open = new Promise((r, j) => { this.ws.on("open", r); this.ws.on("error", j); });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
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

(async () => {
  const proc = await startServer();
  try {
    // Origen no permitido: el servidor rechaza la conexión
    await assert.rejects(new Client("malo", "https://evil.example").open);

    const ana = new Client("Ana"), beto = new Client("Beto"), cris = new Client("Cris");
    await Promise.all([ana.open, beto.open, cris.open]);
    for (const c of [ana, beto, cris]) {
      c.send({ t: "hello", playerId: c.id, name: c.name });
      await c.waitT("welcome");
    }

    // Nombre con HTML: rechazado
    const raro = new Client("raro"); await raro.open;
    raro.send({ t: "hello", playerId: "test-raro-123456", name: "<script>" });
    assert.strictEqual((await raro.waitT("error")).code, "bad_name");

    ana.send({ t: "create", region: "Europa" });
    const { room } = await ana.waitT("room");
    assert.match(room.code, /^[A-Z2-9]{4}$/);
    console.log("Sala creada:", room.code);

    beto.send({ t: "join", code: room.code.toLowerCase() }); // el código no distingue mayúsculas
    cris.send({ t: "join", code: room.code });
    await ana.waitT("room", (m) => m.room.players.length === 3);

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

    // La BD tiene la partida, las 10 rondas y 30 disparos (el segundo de Cris se ignoró)
    const db = require("better-sqlite3")(DB, { readonly: true });
    assert.strictEqual(db.prepare("SELECT status FROM matches WHERE id = ?").get(fin.matchId).status, "finished");
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM rounds WHERE match_id = ?").get(fin.matchId).n, 10);
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM shots WHERE match_id = ?").get(fin.matchId).n, 30);
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) n FROM shots WHERE player_id = ? AND heading = 90").get(cris.id).n, 0,
      "el segundo disparo no cuenta",
    );

    const ranking = await (await fetch(`http://127.0.0.1:${PORT}/api/online/ranking?playerId=${ana.id}`)).json();
    assert.strictEqual(ranking.ranking.length, 3);
    assert(ranking.ranking.some((r) => r.you && r.name === "Ana"));
    assert.strictEqual(ranking.ranking[0].name, first.name, "el ranking va por Elo");
    assert.strictEqual(ranking.ranking[0].elo, first.eloAfter);
    const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
    assert(health.ok);

    // Segunda partida: Beto cierra la app a mitad de ronda y la partida sigue sin esperarle
    const ana2 = new Client("Ana2"), beto2 = new Client("Beto2");
    await Promise.all([ana2.open, beto2.open]);
    for (const c of [ana2, beto2]) { c.send({ t: "hello", playerId: c.id, name: c.name }); await c.waitT("welcome"); }
    ana2.send({ t: "create", region: "España" });
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
