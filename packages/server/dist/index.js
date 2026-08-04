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
const gameServer = new Server({
    transport: new WebSocketTransport({
        server: httpServer,
        // Phones sleep, tunnels stall — be patient before declaring a client gone.
        pingInterval: 8000,
        pingMaxRetries: 4,
    }),
});
gameServer.define('war', WarRoom).filterBy(['code']);
gameServer.listen(PORT, '0.0.0.0').then(() => {
    const lan = primaryLanAddress();
    console.log('');
    console.log('  WARFRONT server running');
    console.log(`   local     ws://localhost:${PORT}`);
    console.log(`   this WiFi ws://${lan}:${PORT}   <- use this on phones`);
    console.log(`   tick      ${TICK_MS} ms (${1000 / TICK_MS} Hz)`);
    console.log('');
    startLanDiscovery(PORT);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log(`\n[server] ${signal} — shutting down`);
        gameServer.gracefullyShutdown().then(() => process.exit(0), () => process.exit(1));
    });
}
//# sourceMappingURL=index.js.map