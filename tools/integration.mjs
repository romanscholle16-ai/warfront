/**
 * End-to-end multiplayer check against a running server.
 *
 *   npm run dev:server        (in one terminal)
 *   node tools/integration.mjs [ws://host:2567]
 *
 * Simulates what two phones actually do: host creates a game, friend joins by code,
 * host starts, both send commands, and both must observe the same authoritative world.
 */
import { Client } from 'colyseus.js';

const endpoint = process.argv[2] ?? 'ws://localhost:2567';
const httpEndpoint = endpoint.replace(/^ws/, 'http');

const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  console.error(`  ✗ ${m}`);
  process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs = 8000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

console.log(`\nWARFRONT integration test → ${endpoint}\n`);

const { code } = await fetch(`${httpEndpoint}/api/code`).then((r) => r.json());
pass(`server issued match code ${code}`);

const hostClient = new Client(endpoint);
const guestClient = new Client(endpoint);

const host = await hostClient.create('war', { code, name: 'Host', leaderClass: 'economic' });
pass(`host created room ${host.id}`);

const lobbyInfo = await fetch(`${httpEndpoint}/api/lobby/${code}`).then((r) => r.json());
if (lobbyInfo.code !== code) fail('lobby lookup by code failed');
else pass('lobby is discoverable by code');

const guest = await guestClient.join('war', { code, name: 'Guest', leaderClass: 'military' });
pass('guest joined using only the code');

await waitFor(() => host.state.players.size === 2, 5000, 'both players in lobby');
pass('both clients see 2 players in the lobby');

// The guest must not be able to start the match — only the host.
let rejected = null;
guest.onMessage('reject', (payload) => { rejected = payload; });
guest.send('start');
await wait(600);
if (rejected?.reason === 'not_host') pass('non-host start was rejected by the server');
else fail(`expected not_host rejection, got ${JSON.stringify(rejected)}`);

host.send('start');
await waitFor(() => host.state.phase === 'playing', 5000, 'match to start');
pass('host started the match');

await waitFor(() => guest.state.phase === 'playing', 5000, 'guest to see match start');
pass('guest observed the match start');

await waitFor(() => guest.state.armies.size >= 2, 5000, 'starting armies');
pass(`starting armies replicated (${guest.state.armies.size} armies)`);

// The tick must be advancing on the server and reaching both clients.
const tickBefore = guest.state.tick;
await wait(1500);
const ticksElapsed = guest.state.tick - tickBefore;
if (ticksElapsed >= 5) pass(`simulation ticking (${ticksElapsed} ticks in 1.5 s)`);
else fail(`simulation appears stalled (${ticksElapsed} ticks in 1.5 s)`);

// A build issued by the host must appear in the guest's view of the world.
const hostTerritory = [...host.state.territories.values()].find((t) => t.ownerId === host.sessionId);
if (!hostTerritory) fail('host has no territory');
host.send('cmd', { t: 'BUILD', territoryId: hostTerritory.id, building: 'farm' });

await waitFor(
  () => (guest.state.territories.get(hostTerritory.id)?.buildings.length ?? 0) > 0,
  5000,
  'building to replicate to the guest',
);
pass('host built a farm and the guest saw it');

// Cheat attempt: the guest tries to build inside the host's territory.
rejected = null;
guest.send('cmd', { t: 'BUILD', territoryId: hostTerritory.id, building: 'barracks' });
await wait(800);
if (rejected?.reason === 'not_owner') pass('server rejected a build in another player\'s territory');
else fail(`expected not_owner rejection, got ${JSON.stringify(rejected)}`);

// Resources must be ticking up authoritatively.
const guestView = guest.state.players.get(host.sessionId);
const moneyBefore = guestView.resources.money;
await wait(2000);
if (guestView.resources.money !== moneyBefore) pass('economy is replicating in real time');
else fail('resources are not changing');

// Advisor round-trip — this is what drives the in-game suggestion panel.
let advice = null;
guest.onMessage('advice', (payload) => { advice = payload; });
guest.send('advice');
await waitFor(() => advice !== null, 5000, 'advice response');
pass(`advisor returned ${advice.length} suggestion(s): "${advice[0]?.title ?? 'none'}"`);

await host.leave();
await guest.leave();

console.log(process.exitCode ? '\n  INTEGRATION TEST FAILED\n' : '\n  All integration checks passed.\n');
process.exit(process.exitCode ?? 0);
