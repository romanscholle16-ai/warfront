/**
 * 4-AI slugfest test — with multihop routing, sea-lock detection,
 * and strategic naval building. Hard AIs will actually fight.
 *
 *   npm run build:shared && node tools/ai-battle.mjs
 */
import {
  ADJACENCY, BUILDINGS, RESOURCE_KEYS, TERRITORY_DEFS, UNITS,
  addPlayer, applyCommand, availableTechs, buildingCost, canAfford,
  createMatch, moveBlocker, startMatch, tick,
  randInt,
} from '@warfront/shared';

// ── helpers ──────────────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function ownedTerritories(state, playerId) {
  const out = [];
  for (const t of Object.values(state.territories)) {
    if (t.ownerId === playerId) out.push(t.id);
  }
  return out;
}

function armyTroopTotal(army) {
  let t = 0;
  for (const [uid, n] of Object.entries(army.units)) {
    const def = UNITS[uid];
    if (def && n) t += def.troopValue * n;
  }
  return t;
}

function totalTroops(state, playerId) {
  let t = 0;
  for (const army of Object.values(state.armies)) {
    if (army.ownerId !== playerId) continue;
    t += armyTroopTotal(army);
  }
  return t;
}

function isSeaLocked(state, playerId) {
  for (const army of Object.values(state.armies)) {
    if (army.ownerId !== playerId || army.movingTo) continue;
    for (const link of ADJACENCY[army.at] ?? []) {
      const t = state.territories[link.to];
      if (!t || t.ownerId === playerId) continue;
      for (const unitId of Object.keys(army.units)) {
        if (!army.units[unitId] || army.units[unitId] <= 0) continue;
        const probe = { ...army, units: { [unitId]: 1 } };
        if (!moveBlocker(state, probe, link.to)) return false;
      }
    }
  }
  return true;
}

function firstHopToward(state, army, targetId) {
  for (const link of ADJACENCY[army.at] ?? []) {
    const firstHop = link.to;
    if (moveBlocker(state, army, firstHop)) continue;
    const visited = new Set([army.at, firstHop]);
    const queue = [firstHop];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === targetId) return firstHop;
      for (const nextLink of ADJACENCY[current] ?? []) {
        const next = nextLink.to;
        if (visited.has(next)) continue;
        visited.add(next);
        if (state.territories[next]) queue.push(next);
      }
    }
  }
  return null;
}

function findReachableEnemy(state, playerId, army, owned, targeted) {
  const visited = new Set([army.at]);
  const queue = [army.at];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const link of ADJACENCY[current] ?? []) {
      const next = link.to;
      if (visited.has(next)) continue;
      visited.add(next);
      const t = state.territories[next];
      if (!t) continue;
      if (t.ownerId !== playerId && !targeted.has(next)) {
        return firstHopToward(state, army, next);
      }
      if (t.ownerId === playerId) queue.push(next);
    }
  }
  return null;
}

// ── AI logic ─────────────────────────────────────────────────────────────

const aiNames = ['Marshal Ivanov', 'General Zhao', 'Admiral Nkrumah', 'Field Marshal Vega'];

function aiAct(state, playerId, difficulty) {
  const player = state.players[playerId];
  if (!player || player.eliminatedAtTick !== null) return;

  const rules = {
    easy:   { aggression: 0.15, minAttack: 12, trainBatch: 3, trainReserve: 250, buildReserve: 350, buildBatches: 1, trainBatches: 1, maxLevel: 3, splitArmies: false },
    medium: { aggression: 0.8,  minAttack: 6,  trainBatch: 6, trainReserve: 150, buildReserve: 200, buildBatches: 2, trainBatches: 2, maxLevel: 5, splitArmies: true },
    hard:   { aggression: 1.0,  minAttack: 4,  trainBatch: 12,trainReserve: 100, buildReserve: 150, buildBatches: 2, trainBatches: 3, maxLevel: 8, splitArmies: true },
  }[difficulty] ?? { aggression: 0.5, minAttack: 8, trainBatch: 6, trainReserve: 200, buildReserve: 300, buildBatches: 1, trainBatches: 1, maxLevel: 5, splitArmies: false };

  aiAttack(state, playerId, rules);
  aiTrain(state, playerId, rules);
  aiBuild(state, playerId, rules);
  aiResearch(state, playerId, rules);
}

function aiAttack(state, playerId, rules) {
  const alwaysAttack = rules.aggression >= 1.0;
  const attackEnemies = alwaysAttack || Math.random() < rules.aggression;

  const owned = new Set(ownedTerritories(state, playerId));
  const targeted = new Set();
  for (const army of Object.values(state.armies)) {
    if (army.ownerId === playerId && army.movingTo) targeted.add(army.movingTo);
  }

  for (const army of Object.values(state.armies)) {
    if (army.ownerId !== playerId || army.movingTo) continue;
    const territory = state.territories[army.at];
    if (territory && territory.captureProgress > 0 && territory.captureBy === playerId) continue;

    const total = armyTroopTotal(army);
    if (total < rules.minAttack) continue;

    if (total >= rules.minAttack * 2 && rules.splitArmies) {
      const splitUnits = {};
      for (const [uid, count] of Object.entries(army.units)) {
        const half = Math.floor((count ?? 0) / 2);
        if (half > 0) splitUnits[uid] = half;
      }
      applyCommand(state, playerId, { t: 'SPLIT_ARMY', armyId: army.id, units: splitUnits });
    }

    // Detach sea units from mixed armies so they can cross sea links.
    const firstLink = (ADJACENCY[army.at] ?? [])[0];
    if (firstLink && moveBlocker(state, army, firstLink.to)) {
      const seaUnits = {};
      let hasSea = false;
      for (const [uid, count] of Object.entries(army.units)) {
        if (!count) continue;
        const unit = UNITS[uid];
        if (unit && (unit.domain === 'sea' || uid === 'marine')) {
          seaUnits[uid] = count;
          hasSea = true;
        }
      }
      if (hasSea && Object.keys(seaUnits).length > 0) {
        applyCommand(state, playerId, { t: 'SPLIT_ARMY', armyId: army.id, units: seaUnits });
      }
    }

    const neighbours = (ADJACENCY[army.at] ?? []).map((l) => l.to);
    shuffle(neighbours);

    let bestTarget = null;
    for (const n of neighbours) {
      if (targeted.has(n)) continue;
      if (moveBlocker(state, army, n)) continue;
      const t = state.territories[n];
      if (!t) continue;
      if (t.ownerId === playerId) continue;
      if (t.ownerId && attackEnemies) { bestTarget = n; break; }
      if (!t.ownerId && !bestTarget) bestTarget = n;
    }

    if (!bestTarget && attackEnemies) {
      bestTarget = findReachableEnemy(state, playerId, army, owned, targeted);
    }

    if (bestTarget) {
      applyCommand(state, playerId, { t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: bestTarget });
      targeted.add(bestTarget);
    }
  }
}

function aiTrain(state, playerId, rules) {
  const player = state.players[playerId];
  if (player.resources.money < rules.trainReserve) return;
  const seaLocked = isSeaLocked(state, playerId);

  const factories = [];
  for (const territory of Object.values(state.territories)) {
    if (territory.ownerId !== playerId || territory.pop < 2) continue;
    const units = [];
    const bl = (t) => territory.buildings.some((b) => b.type === t && b.level > 0);
    const bll = (t, l) => territory.buildings.some((b) => b.type === t && b.level >= l);
    if (bl('barracks')) { units.push('rifle'); if (bll('barracks', 3)) units.push('marine'); }
    if (bl('academy')) units.push('special_forces');
    if (bl('vehicle_plant')) { units.push('apc'); if (bll('vehicle_plant', 3)) units.push('tank'); }
    if (bl('airbase')) { units.push('helicopter'); if (bll('airbase', 3)) units.push('fighter'); if (bll('airbase', 5)) units.push('bomber'); }
    if (bl('naval_base')) { units.push('destroyer'); if (bll('naval_base', 4)) units.push('submarine'); if (bll('naval_base', 7)) units.push('carrier'); }
    if (units.length) factories.push({ tid: territory.id, units });
  }
  shuffle(factories);

  let trained = 0;
  for (const { tid, units } of factories) {
    if (trained >= rules.trainBatches) break;
    const territory = state.territories[tid];
    const seaUnits = units.filter((u) => u === 'marine' || UNITS[u]?.domain === 'sea');
    const otherUnits = units.filter((u) => u !== 'marine' && UNITS[u]?.domain !== 'sea');
    if (seaLocked) {
      shuffle(seaUnits);
      shuffle(otherUnits);
      units.length = 0;
      units.push(...seaUnits, ...otherUnits);
    } else {
      shuffle(units);
    }

    for (const unit of units) {
      const def = UNITS[unit];
      const maxPop = Math.floor(territory.pop / (def.manpower || 1));
      const batch = Math.min(rules.trainBatch, maxPop);
      if (batch < 1) continue;
      const cost = {};
      for (const k of RESOURCE_KEYS) if (def.cost[k] !== undefined) cost[k] = def.cost[k] * batch;
      if (!canAfford(player.resources, cost)) continue;
      if (player.resources.money - (cost.money ?? 0) < rules.trainReserve) continue;
      applyCommand(state, playerId, { t: 'TRAIN', territoryId: tid, unit, count: batch });
      trained++;
      break;
    }
  }
}

function aiBuild(state, playerId, rules) {
  const player = state.players[playerId];
  if (player.resources.money < rules.buildReserve) return;
  const seaLocked = isSeaLocked(state, playerId);

  const owned = ownedTerritories(state, playerId);
  if (seaLocked) {
    owned.sort((a, b) => {
      const aC = TERRITORY_DEFS[a]?.coastal ?? false;
      const bC = TERRITORY_DEFS[b]?.coastal ?? false;
      return (bC ? 1 : 0) - (aC ? 1 : 0);
    });
  } else {
    shuffle(owned);
  }

  let built = 0;
  for (const tid of owned) {
    if (built >= rules.buildBatches) break;
    const territory = state.territories[tid];
    const slots = TERRITORY_DEFS[tid]?.slots ?? 3;
    const hasFree = territory.buildings.length < slots;
    const coastal = TERRITORY_DEFS[tid]?.coastal ?? false;

    const priority = seaLocked && coastal
      ? ['naval_base', 'barracks', 'airbase', 'vehicle_plant', 'academy',
         'farm', 'commercial', 'factory', 'mine', 'power_plant',
         'research_center', 'university', 'advanced_lab']
      : ['barracks', 'vehicle_plant', 'airbase', 'naval_base', 'academy',
         'farm', 'commercial', 'factory', 'mine', 'power_plant',
         'research_center', 'university', 'advanced_lab'];

    for (const type of priority) {
      const bdef = BUILDINGS[type];
      if (bdef.requiresCoastal && !coastal) continue;
      const existing = territory.buildings.find((b) => b.type === type);
      if (!existing && !hasFree) continue;
      if (existing && existing.completesAtTick > 0) continue;
      const nextLevel = (existing?.level ?? 0) + 1;
      if (nextLevel > rules.maxLevel) continue;
      const cost = buildingCost(type, nextLevel);
      if (!canAfford(player.resources, cost)) continue;
      if (player.resources.money - (cost.money ?? 0) < rules.buildReserve) continue;
      applyCommand(state, playerId, { t: 'BUILD', territoryId: tid, building: type });
      built++;
      break;
    }
  }
}

function aiResearch(state, playerId, rules) {
  const player = state.players[playerId];
  if (player.research) return;
  const available = availableTechs(player.tech);
  if (!available.length) return;
  const affordable = available.filter((t) => player.resources.research >= t.costResearch);
  if (!affordable.length) return;
  if (player.resources.money < (rules.buildReserve ?? 300)) return;
  const pick = affordable[Math.floor(Math.random() * affordable.length)];
  applyCommand(state, playerId, { t: 'START_RESEARCH', techId: pick.id });
}

// ── main ─────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════╗');
console.log('║    WARFRONT — 4-AI SLUGFEST (v2 - SMART)     ║');
console.log('╚══════════════════════════════════════════════╝\n');

const state = createMatch('battle2', 'AIWARS', { mode: 'casual', speed: 10, maxPlayers: 4 });

const difficulties = ['easy', 'medium', 'hard', 'hard'];
for (let i = 0; i < 4; i++) {
  const id = `ai-${i}`;
  const p = addPlayer(state, id, aiNames[i], { team: i + 1 });
  p.ai = true;
  p.connected = false;
}

startMatch(state);
state.config.speed = 10;

const totalTerritories = Object.keys(state.territories).length;
console.log(`Map: ${totalTerritories} territories | Speed: ${state.config.speed}×`);
console.log(`Players: ${state.playerOrder.map((id) => {
  const p = state.players[id];
  return `${p.name} (${difficulties[parseInt(id.split('-')[1])]})`;
}).join(', ')}\n`);

const MAX_TICKS = 8000;
const SNAPSHOT_INTERVAL = 500;
let lastSnapshot = 0;

for (let t = 0; t < MAX_TICKS; t++) {
  tick(state);

  if (t % 25 === 0) {
    for (let i = 0; i < 4; i++) aiAct(state, `ai-${i}`, difficulties[i]);
  }

  if (state.tick - lastSnapshot >= SNAPSHOT_INTERVAL) {
    lastSnapshot = state.tick;
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const id = `ai-${i}`;
      const p = state.players[id];
      const owned = ownedTerritories(state, id).length;
      const troops = totalTroops(state, id);
      const battles = state.battles.filter(
        (b) => b.attackerIds.includes(id) || b.defenderIds.includes(id)
      ).length;
      const seaLock = isSeaLocked(state, id);
      const name = p.name.padEnd(22);
      lines.push(`  ${name} | T${String(owned).padStart(2)} | troops ${String(Math.round(troops)).padStart(5)} | $${String(Math.round(p.resources.money)).padStart(6)} | battles ${battles}${seaLock ? ' 🔒SEA' : ''}${p.eliminatedAtTick !== null ? ' 💀' : ''}`);
    }
    console.log(`\n── tick ${state.tick} ──${'-'.repeat(40)}`);
    console.log(lines.join('\n'));
  }

  if (state.phase === 'ended') {
    console.log(`\n🏁 MATCH ENDED at tick ${state.tick}`);
    console.log(`   Winner team: ${state.winnerTeam}`);
    for (let i = 0; i < 4; i++) {
      const id = `ai-${i}`;
      const p = state.players[id];
      console.log(`   ${p.name}: ${ownedTerritories(state, id).length} territories, eliminated=${p.eliminatedAtTick !== null}`);
    }
    break;
  }
}

if (state.phase !== 'ended') {
  console.log(`\n⏰ Test complete after ${state.tick} ticks (no winner yet)`);
  console.log('\nFinal standings:');
  const sorted = state.playerOrder
    .map((id) => ({ id, territories: ownedTerritories(state, id).length, troops: Math.round(totalTroops(state, id)), name: state.players[id].name, eliminated: state.players[id].eliminatedAtTick !== null }))
    .sort((a, b) => b.territories - a.territories);
  for (const p of sorted) {
    console.log(`  ${p.name.padEnd(22)} | ${p.territories} territories | ${p.troops} troops ${p.eliminated ? '💀' : ''}`);
  }
  console.log(`\n  Active battles: ${state.battles.length}`);
  for (const b of state.battles.slice(0, 5)) {
    const tname = TERRITORY_DEFS[b.territoryId]?.name ?? b.territoryId;
    const attackers = b.attackerIds.map((id) => state.players[id]?.name ?? id).join(', ');
    const defenders = b.defenderIds.map((id) => state.players[id]?.name ?? id).join(', ');
    console.log(`    ${tname}: ${attackers} ⚔ ${defenders}`);
  }
}

console.log('\n✅ Test complete.\n');
