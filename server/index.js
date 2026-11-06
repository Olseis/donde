/* =======================================
   SERVIDOR DE ¿DÓNDE QUEDA...?

   - HTTP  /api/...  → salud, ranking online e historial
   - WebSocket /ws   → salas y partidas online en tiempo real

   Escucha solo en 127.0.0.1: desde fuera se entra por Apache con HTTPS,
   que reenvía /api y /ws hasta aquí.
   ======================================= */
const http = require("http");
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

/* ---------- HTTP ---------- */
const app = express();
app.set("trust proxy", "loopback");
app.disable("x-powered-by");

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
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

// Últimas partidas de un jugador
app.get("/api/online/history", (req, res) => {
  if (!PLAYER_ID_REGEX.test(req.query.playerId || ""))
    return res.status(400).json({ error: "playerId no válido" });
  res.json({ matches: store.history(req.query.playerId) });
});

app.use("/api", (req, res) => res.status(404).json({ error: "No existe" }));

/* ---------- WebSocket ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

const connectionsPerIp = new Map();
const MAX_CONN_PER_IP = 12;

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;

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
    ws.playerId = msg.playerId;
    ws.playerName = name;
    store.savePlayer(ws.playerId, name);
    ws.send(JSON.stringify({ t: "welcome", playerId: ws.playerId }));
    return;
  }

  if (!ws.playerId) throw userErr("no_hello", "Primero identifícate.");
  const player = { id: ws.playerId, name: ws.playerName, ws };

  switch (msg.t) {
    case "create":
      if (ws.roomCode) rooms.leaveRoom(ws);
      rooms.createRoom(player, msg.region);
      break;
    case "join":
      if (ws.roomCode && ws.roomCode !== String(msg.code || "").toUpperCase()) rooms.leaveRoom(ws);
      rooms.joinRoom(player, msg.code);
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

server.listen(PORT, HOST, () => {
  console.log(`Servidor de ¿Dónde queda? en http://${HOST}:${PORT}`);
  console.log(`Orígenes permitidos: ${[...ALLOWED_ORIGINS].join(", ")}`);
});

module.exports = { server };
