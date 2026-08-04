/**
 * Phase 2 end-to-end check against a running server.
 *
 *   npm run dev:server
 *   node tools/integration-phase2.mjs [ws://host:2567]
 *
 * Covers the things that only break over a real socket: schema mirroring of the new
 * leader/diplomacy state, two-sided alliances, escrowed trades between two clients,
 * skill spending, cosmetics, pings, and persistence of leader progress across matches.
 */
import { Client } from 'colyseus.js';

const endpoint = process.argv[2] ?? 'ws://localhost:2567';
const httpEndpoint = endpoint.replace(/^ws/, 'http');

const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeoutMs = 8000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Runs a full lobby → match with two clients using stable device ids. */
async function startMatch(deviceA, deviceB) {
  const { code } = await fetch(`${httpEndpoint}/api/code`).then((r) => r.json());
  const hostClient = new Client(endpoint);
  const guestClient = new Client(endpoint);
  const host = await hostClient.create('war', {
    code, name: 'Host', leaderClass: 'diplomatic', deviceId: deviceA,
  });
  const guest = await guestClient.join('war', {
    code, name: 'Guest', leaderClass: 'military', deviceId: deviceB,
  });
  await waitFor(() => host.state.players.size === 2, 5000, 'both players');
  host.send('start');
  await waitFor(() => host.state.phase === 'playing' && guest.state.phase === 'playing', 5000, 'match start');
  return { code, host, guest };
}

console.log(`\nWARFRONT phase 2 integration → ${endpoint}\n`);

const deviceA = `test-host-${Date.now()}`;
const deviceB = `test-guest-${Date.now()}`;
const { host, guest } = await startMatch(deviceA, deviceB);
pass('two clients in a running match');

// ── leader state on the wire ───────────────────────────────────────────────
const hostView = () => guest.state.players.get(host.sessionId);
if (hostView()?.leaderLevel >= 1 && hostView()?.leaderXpNeeded > 0) {
  pass(`leader level + XP curve replicated (level ${hostView().leaderLevel}, next at ${hostView().leaderXpNeeded})`);
} else {
  fail('leader progression not visible to the other client');
}

// ── skill points ───────────────────────────────────────────────────────────
let rejected = null;
host.onMessage('reject', (p) => { rejected = p; });
host.send('cmd', { t: 'SPEND_SKILL', branch: 'warfare' });
await wait(600);
if (rejected?.reason === 'no_points') pass('spending a skill point with none available is rejected');
else fail(`expected no_points rejection, got ${JSON.stringify(rejected)}`);

// ── cosmetics are visible but inert ────────────────────────────────────────
host.send('cmd', { t: 'SET_APPEARANCE', appearance: { uniform: 'desert', flag: 'tricolor' } });
await waitFor(() => hostView()?.appearance.uniform === 'desert', 5000, 'appearance to replicate');
pass('cosmetic change replicated to the other player');

// ── alliances need both sides ──────────────────────────────────────────────
host.send('cmd', { t: 'PROPOSE_ALLY', targetPlayerId: guest.sessionId });
await waitFor(
  () => (guest.state.players.get(guest.sessionId)?.allianceOffers ?? '').includes(host.sessionId),
  5000, 'alliance offer to arrive',
);
pass('alliance offer reached the other player');

if (!(guest.state.players.get(guest.sessionId)?.allies ?? '').includes(host.sessionId)) {
  pass('an unanswered proposal does not create an alliance');
} else {
  fail('alliance formed without acceptance');
}

guest.send('cmd', { t: 'ACCEPT_ALLY', targetPlayerId: host.sessionId });
await waitFor(
  () => (host.state.players.get(host.sessionId)?.allies ?? '').includes(guest.sessionId),
  5000, 'alliance to form',
);
pass('alliance formed after acceptance, visible on both sides');

// ── trade: escrow, then swap ───────────────────────────────────────────────
const hostMoneyBefore = host.state.players.get(host.sessionId).resources.money;
host.send('cmd', {
  t: 'TRADE_OFFER', targetPlayerId: guest.sessionId,
  give: { money: 300 }, want: { materials: 100 },
});
await waitFor(() => guest.state.tradeOffers.length === 1, 5000, 'trade offer to replicate');
pass('trade offer replicated to the recipient');

if (host.state.players.get(host.sessionId).resources.money < hostMoneyBefore) {
  pass('offered resources were escrowed immediately');
} else {
  fail('offer was not escrowed');
}

const offerId = guest.state.tradeOffers[0].id;
const guestMaterialsBefore = guest.state.players.get(guest.sessionId).resources.materials;
guest.send('cmd', { t: 'TRADE_ACCEPT', offerId });
await waitFor(() => guest.state.tradeOffers.length === 0, 5000, 'trade to settle');

const guestMoney = guest.state.players.get(guest.sessionId).resources.money;
const guestMaterials = guest.state.players.get(guest.sessionId).resources.materials;
if (guestMoney > 0 && guestMaterials < guestMaterialsBefore) {
  pass('both halves of the trade moved on acceptance');
} else {
  fail(`trade did not settle correctly (money ${guestMoney}, materials ${guestMaterials})`);
}

// ── a third party cannot accept somebody else's offer ──────────────────────
host.send('cmd', {
  t: 'TRADE_OFFER', targetPlayerId: guest.sessionId, give: { oil: 50 }, want: { food: 10 },
});
await waitFor(() => host.state.tradeOffers.length === 1, 5000, 'second offer');
rejected = null;
host.send('cmd', { t: 'TRADE_ACCEPT', offerId: host.state.tradeOffers[0].id });
await wait(700);
if (rejected?.reason === 'not_recipient') pass('a player cannot accept their own offer');
else fail(`expected not_recipient, got ${JSON.stringify(rejected)}`);

// ── map pings ──────────────────────────────────────────────────────────────
const territoryId = [...host.state.territories.keys()][0];
host.send('cmd', { t: 'PING_MAP', territoryId, kind: 'attack' });
await waitFor(() => guest.state.pings.length >= 1, 5000, 'ping to replicate');
pass('map ping replicated to allies');

// ── chat ───────────────────────────────────────────────────────────────────
let chatSeen = false;
guest.onMessage('events', (events) => {
  if (events.some((e) => e.type === 'chat' && e.text.includes('regroup'))) chatSeen = true;
});
host.send('cmd', { t: 'CHAT', channel: 'all', text: 'regroup on the coast' });
await waitFor(() => chatSeen, 5000, 'chat message');
pass('chat delivered to the other player');

// ── domain movement is enforced server-side ────────────────────────────────
rejected = null;
const hostArmy = [...host.state.armies.values()].find((a) => a.ownerId === host.sessionId);
const landlocked = [...host.state.territories.keys()].find((id) => id === 'central_asia');
host.send('cmd', { t: 'MOVE_ARMY', armyId: hostArmy.id, toTerritoryId: landlocked });
await wait(700);
if (rejected?.reason === 'not_adjacent') pass('illegal long-range move rejected by the server');
else fail(`expected not_adjacent, got ${JSON.stringify(rejected)}`);

await host.leave();
await guest.leave();
await wait(500);

// ── persistence: leader progress survives into a NEW match ─────────────────
const second = await startMatch(deviceA, deviceB);
const carried = second.host.state.players.get(second.host.sessionId);
if (carried?.appearance.uniform === 'desert') {
  pass('leader cosmetics persisted into a brand new match');
} else {
  fail(`appearance did not persist (got "${carried?.appearance.uniform}")`);
}
await second.host.leave();
await second.guest.leave();

console.log(process.exitCode ? '\n  PHASE 2 INTEGRATION FAILED\n' : '\n  All phase 2 integration checks passed.\n');
process.exit(process.exitCode ?? 0);
