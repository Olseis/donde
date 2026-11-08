/* =======================================
   SERVIDOR DE ¿DÓNDE QUEDA...?

   - HTTP  /api/...  → salud, ranking online e historial
   - WebSocket /ws   → salas y partidas online en tiempo real

   Escucha solo en 127.0.0.1: desde fuera se entra por Apache con HTTPS,
   que reenvía /api y /ws hasta aquí.
   ======================================= */
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const store = require("./db");
const rooms = require("./rooms");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// Desde dónde puede conectarse el juego:
// la app de Android (https://localhost), la de iOS (capacitor://localhost)
// y la web servida por tu propio Apache (PUBLIC_ORIGIN).
const ALLOWED_ORIGINS = new Set(
  [
    "https://localhost",
    "http://localhost",
    "capacitor://localhost",
    process.env.PUBLIC_ORIGIN,
    ...(process.env.EXTRA_ORIGINS || "").split(","),
  ]
    .map((s) => (s || "").trim())
    .filter(Boolean),
);

function originAllowed(origin) {
  // Sin cabecera Origin = no viene de un navegador (pruebas con curl, etc.)
  return !origin || ALLOWED_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const NAME_REGEX = /^[\p{L}\p{N} _.\-]{1,20}$/u;
const PLAYER_ID_REGEX = /^[a-zA-Z0-9-]{8,64}$/;
const SECRET_REGEX = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url

/* ---------- Identidad ----------
   Cada móvil tiene un identificador privado (playerId) y una clave secreta
   que le da el servidor la primera vez. En la base de datos solo se guarda
   el hash de la clave. Sin la clave nadie puede jugar con tu cuenta.
   A los demás jugadores nunca se les enseña tu playerId, sino un alias
   (publicId) que no sirve para entrar como tú. */
const PUBLIC_ID_KEY = crypto.randomBytes(32); // cambia en cada arranque; las salas también
const newSecret = () => crypto.randomBytes(32).toString("base64url");
const hashSecret = (secret) => crypto.createHash("sha256").update(secret).digest("hex");
const publicIdOf = (playerId) =>
  crypto.createHmac("sha256", PUBLIC_ID_KEY).update(playerId).digest("base64url").slice(0, 12);
function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Comprueba la clave de un jugador. Devuelve { hash, issued } (issued = clave nueva
 * que hay que darle al móvil) o lanza bad_secret si la clave no es la suya.
 */
function authenticate(playerId, secret) {
  const stored = store.secretHashOf(playerId);
  const given = SECRET_REGEX.test(secret || "") ? hashSecret(secret) : null;
  if (stored) {
    if (!sameHash(stored, given)) throw userErr("bad_secret", "Este móvil no tiene la clave de esa cuenta.");
    return { hash: stored, issued: null };
  }
  if (stored === null) {
    // Jugador de antes de las claves: se queda con la cuenta el primero que vuelve a entrar
    const issued = given ? null : newSecret();
    const hash = given || hashSecret(issued);
    if (!store.claimSecret(playerId, hash)) return authenticate(playerId, secret);
    return { hash, issued };
  }
  // Aún no ha jugado ninguna Ranked: no está en la BD hasta que empiece una
  if (given) return { hash: given, issued: null };
  const issued = newSecret();
  return { hash: hashSecret(issued), issued };
}

/* ---------- IP real y límites ----------
   Node solo escucha en 127.0.0.1, así que todo llega desde Apache.
   - X-Real-IP: Apache la ESCRIBE siempre con la IP de verdad (borra la que mande el cliente).
   - Si no está, X-Forwarded-For: Apache AÑADE la IP de verdad al final; lo que venga
     antes lo puede haber escrito cualquiera, así que solo vale la última. */
function clientIp(req) {
  const remote = req.socket.remoteAddress || "";
  const fromProxy = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const real = req.headers["x-real-ip"];
  if (fromProxy && typeof real === "string" && real.trim()) return real.trim();
  const xff = req.headers["x-forwarded-for"];
  if (fromProxy && typeof xff === "string") {
    const last = xff.split(",").pop().trim();
    if (last) return last;
  }
  return remote;
}

// Límite de peticiones a /api por IP: 60 por minuto (en memoria, sin coste apreciable)
const API_LIMIT = 60;
const apiHits = new Map();
setInterval(() => apiHits.clear(), 60_000).unref();

/* ---------- HTTP ---------- */
const app = express();
app.disable("x-powered-by");
app.disable("etag");

app.use("/api", (req, res, next) => {
  const ip = clientIp(req);
  const n = (apiHits.get(ip) || 0) + 1;
  apiHits.set(ip, n);
  if (n > API_LIMIT) return res.status(429).json({ error: "Demasiadas peticiones, espera un minuto." });
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, ...rooms.stats() }));

// Ranking online: la tabla de TU división (Oro II, Plata IV...) y tu rango.
// Sin playerId, o si aún estás en partidas de clasificación, la tabla viene vacía.
app.get("/api/online/ranking", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const me = PLAYER_ID_REGEX.test(req.query.playerId || "") ? req.query.playerId : null;
  if (!me) return res.json({ me: null, table: null, ranking: [] });
  res.json(store.divisionTable(me, limit));
});

// Comprueba playerId + clave en las peticiones de "mis datos". Devuelve el playerId,
// null si ese jugador no tiene nada guardado, o responde con el error y devuelve false.
function ownPlayer(req, res) {
  const { playerId, secret } = req.body || {};
  if (!PLAYER_ID_REGEX.test(playerId || "")) return res.status(400).json({ error: "playerId no válido" }), false;
  const stored = store.secretHashOf(playerId);
  if (stored === undefined) return null; // nunca jugó Ranked: no hay nada suyo en la BD
  if (!stored || !SECRET_REGEX.test(secret || "") || !sameHash(stored, hashSecret(secret)))
    return res.status(403).json({ error: "No autorizado" }), false;
  return playerId;
}
const smallJson = express.json({ limit: "1kb" });

// Últimas partidas de un jugador: solo las suyas, con su clave
app.post("/api/online/history", smallJson, (req, res) => {
  const id = ownPlayer(req, res);
  if (id === false) return;
  res.json({ matches: id ? store.history(id) : [] });
});

// Derecho de acceso y portabilidad (RGPD art. 15 y 20): todo lo que hay guardado de ti
app.post("/api/online/me", smallJson, (req, res) => {
  const id = ownPlayer(req, res);
  if (id === false) return;
  res.json({
    exported_at: new Date().toISOString(),
    player: id ? store.myData(id) : null,
    note: id ? undefined : "No hay ningún dato tuyo guardado: solo se guarda algo al jugar Ranked.",
  });
});

// Derecho de supresión (RGPD art. 17): borra la cuenta y sus partidas
app.post("/api/online/delete", smallJson, (req, res) => {
  const id = ownPlayer(req, res);
  if (id === false) return;
  res.json({ deleted: id ? store.deletePlayer(id) : false });
});

app.use("/api", (req, res) => res.status(404).json({ error: "No existe" }));

/* ---------- WebSocket ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

const connectionsPerIp = new Map();
const MAX_CONN_PER_IP = 12;

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const ip = clientIp(req);

  if (url.pathname !== "/ws" || !originAllowed(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    return socket.destroy();
  }
  if ((connectionsPerIp.get(ip) || 0) >= MAX_CONN_PER_IP) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.ip = ip;
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  connectionsPerIp.set(ws.ip, (connectionsPerIp.get(ws.ip) || 0) + 1);
  ws.isAlive = true;
  ws.playerId = null;
  ws.playerName = null;
  ws.roomCode = null;
  ws.msgCount = 0;

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    // Límite sencillo: 60 mensajes cada 10 segundos (una partida normal usa muchos menos)
    if (++ws.msgCount > 60) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handleMessage(ws, msg);
    } catch (err) {
      if (err.isUserError) {
        ws.send(JSON.stringify({ t: "error", code: err.code, message: err.message, for: msg.t }));
      } else {
        console.error("Error procesando", msg && msg.t, err);
        ws.send(JSON.stringify({ t: "error", code: "server", message: "Error en el servidor.", for: msg.t }));
      }
    }
  });

  ws.on("close", () => {
    const n = (connectionsPerIp.get(ws.ip) || 1) - 1;
    if (n <= 0) connectionsPerIp.delete(ws.ip);
    else connectionsPerIp.set(ws.ip, n);
    rooms.onDisconnect(ws);
  });
});

function handleMessage(ws, msg) {
  if (msg.t === "hello") {
    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    if (!PLAYER_ID_REGEX.test(msg.playerId || "")) throw userErr("bad_id", "Identificador no válido.");
    if (!NAME_REGEX.test(name)) throw userErr("bad_name", "Escribe un nombre de 1 a 20 letras o números.");
    if (ws.playerId && ws.playerId !== msg.playerId) throw userErr("bad_id", "Ya te has identificado.");
    const { hash, issued } = authenticate(msg.playerId, msg.secret);
    ws.playerId = msg.playerId;
    ws.playerName = name;
    ws.secretHash = hash;
    ws.publicId = publicIdOf(msg.playerId);
    // Versión de las condiciones que el jugador aceptó en el móvil (se guarda al jugar Ranked)
    ws.terms = /^\d{4}-\d{2}-\d{2}$/.test(msg.terms || "") ? msg.terms : null;
    // Nada se guarda en la BD aquí: solo al empezar una Ranked
    ws.send(JSON.stringify({ t: "welcome", publicId: ws.publicId, ...(issued ? { secret: issued } : {}) }));
    return;
  }

  if (!ws.playerId) throw userErr("no_hello", "Primero identifícate.");
  const player = {
    id: ws.playerId, pub: ws.publicId, name: ws.playerName, secretHash: ws.secretHash, ip: ws.ip,
    termsVersion: ws.terms, ws,
  };

  switch (msg.t) {
    case "create":
      if (ws.roomCode) rooms.leaveRoom(ws);
      rooms.createRoom(player, msg.region, msg.ranked === true);
      break;
    case "join":
      if (ws.roomCode && ws.roomCode !== String(msg.code || "").toUpperCase()) rooms.leaveRoom(ws);
      rooms.joinRoom(player, msg.code, typeof msg.ranked === "boolean" ? msg.ranked : undefined);
      break;
    case "location":
      rooms.setLocation(ws, msg.location);
      break;
    case "start":
      rooms.startMatch(ws);
      break;
    case "shot":
      rooms.handleShot(ws, msg.round, msg.heading);
      break;
    case "next":
      rooms.voteNext(ws, msg.round);
      break;
    case "leave":
      rooms.leaveRoom(ws);
      break;
    case "ping":
      ws.send(JSON.stringify({ t: "pong" }));
      break;
  }
}

function userErr(code, message) {
  const e = new Error(message);
  e.code = code;
  e.isUserError = true;
  return e;
}

// Cada 10 s: reinicia el contador de mensajes y cierra conexiones muertas
setInterval(() => {
  for (const ws of wss.clients) {
    ws.msgCount = 0;
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 10_000).unref();

// Cada 6 horas: devuelve al disco el espacio de las partidas borradas
setInterval(() => store.maintenance(), 6 * 3600_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Servidor de ¿Dónde queda? en http://${HOST}:${PORT}`);
  console.log(`Orígenes permitidos: ${[...ALLOWED_ORIGINS].join(", ")}`);
});

module.exports = { server };
