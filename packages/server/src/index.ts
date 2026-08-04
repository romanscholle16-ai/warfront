import http from 'node:http';
import cors from 'cors';
import express from 'express';
import colyseus from 'colyseus';
import wsTransport from '@colyseus/ws-transport';
import { TICK_MS } from '@warfront/shared';
import { WarRoom } from './rooms/WarRoom.js';
import { generateCode, isValidCode } from './codes.js';
import { primaryLanAddress, startLanDiscovery } from './lanDiscovery.js';

const { Server, matchMaker } = colyseus;
const { WebSocketTransport } = wsTransport;

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ ok: true, tickMs: TICK_MS, uptime: process.uptime() });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, tickMs: TICK_MS, uptime: process.uptime() });
});

/**
 * Codes are issued by the server so two hosts can never collide on one, and the
 * client never has to guess. Creating a game is: GET /api/code, then create the room.
 */
app.get('/api/code', (_req, res) => {
  res.json({ code: generateCode() });
});

/** Open lobbies — powers the "games on this WiFi" list without any UDP on the client. */
app.get('/api/lobbies', async (_req, res) => {
  const rooms = await matchMaker.query({ name: 'war', locked: false });
  res.json({
    host: primaryLanAddress(),
    port: PORT,
    lobbies: rooms
      .filter((room) => room.metadata?.phase === 'lobby')
      .map((room) => ({
        code: room.metadata?.code ?? '',
        mode: room.metadata?.mode ?? 'casual',
        players: room.clients,
        maxPlayers: room.maxClients,
      })),
  });
});

/** Lets a client check a code before trying to join, so errors are friendly. */
app.get('/api/lobby/:code', async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!isValidCode(code)) {
    res.status(400).json({ error: 'invalid_code' });
    return;
  }
  const rooms = await matchMaker.query({ name: 'war' });
  const room = rooms.find((r) => r.metadata?.code === code);
  if (!room) {
    res.status(404).json({ error: 'no_such_game' });
    return;
  }
  res.json({
    code,
    roomId: room.roomId,
    players: room.clients,
    maxPlayers: room.maxClients,
    phase: room.metadata?.phase ?? 'lobby',
  });
});

const httpServer = http.createServer(app);

httpServer.on('error', (error: Error) => {
  console.error('[server] HTTP error:', error.message);
  process.exit(1);
});

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 8000,
    pingMaxRetries: 4,
  }),
});

gameServer.define('war', WarRoom).filterBy(['code']);

// Listen manually — Colyseus's listen() sometimes doesn't forward the host
// parameter to Node's HTTP server correctly on all transports.
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] WARFRONT server running on port ${PORT}`);
  try { startLanDiscovery(PORT); } catch { /* optional */ }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} — shutting down`);
    gameServer.gracefullyShutdown().then(() => process.exit(0), () => process.exit(1));
  });
}
