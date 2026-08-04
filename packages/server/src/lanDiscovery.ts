import dgram from 'node:dgram';
import os from 'node:os';

/**
 * LAN auto-discovery.
 *
 * A phone on the same WiFi broadcasts "WARFRONT_DISCOVER" to UDP 41234; this
 * responder replies with the server's address. That turns "type a 6-character code
 * and an IP address" into "tap the game you can see" — the single biggest usability
 * win available for local multiplayer, and it costs nothing to run.
 *
 * Note: browsers cannot send UDP. This path is used by the Capacitor build via a
 * native plugin; the browser build falls back to typing the host address. Both are
 * supported, so neither is a blocker.
 */
const DISCOVERY_PORT = 41234;
const MAGIC = 'WARFRONT_DISCOVER';

export function startLanDiscovery(gamePort: number): () => void {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (message, remote) => {
    if (message.toString().trim() !== MAGIC) return;
    const reply = JSON.stringify({
      game: 'warfront',
      host: primaryLanAddress(),
      port: gamePort,
      name: os.hostname(),
    });
    socket.send(reply, remote.port, remote.address);
  });

  socket.on('error', (error) => {
    // Discovery is a convenience, never a dependency — log and carry on.
    console.warn('[lan] discovery unavailable:', error.message);
    socket.close();
  });

  socket.bind(DISCOVERY_PORT, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* not fatal */
    }
    console.log(`[lan] discovery responder on udp/${DISCOVERY_PORT}`);
  });

  return () => socket.close();
}

/** The address a phone on the same WiFi should connect to. */
export function primaryLanAddress(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      candidates.push(address.address);
    }
  }
  // Prefer private ranges — a VPN or virtual adapter often sits first in the list.
  const priv = candidates.find((a) => a.startsWith('192.168.'))
    ?? candidates.find((a) => a.startsWith('10.'))
    ?? candidates.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a));
  return priv ?? candidates[0] ?? '127.0.0.1';
}
