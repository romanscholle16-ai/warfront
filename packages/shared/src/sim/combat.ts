import type { Army, MatchState, UnitType } from '../types.js';
import { UNITS } from '../config/units.js';
import { CAPTURE_TICKS, CAPTURE_UNREST } from '../config/constants.js';
import { randInt } from '../util/rng.js';
import { addEvent, areFriendly, armiesAt, armyUnitCount, territoryDef } from './state.js';
import { XP_REWARDS, awardMatchXp } from './leader.js';
import { cullEmptyArmies, hasGroundForce } from './armies.js';

/**
 * Dice-roll combat system.
 *
 * Each unit type has a `troopValue`. When two sides fight in a territory,
 * each tick both sides roll rand(1, totalTroopCount) and kill that many
 * enemy troops. Casualties are spread proportionally across unit types.
 * Combat continues every tick until one side is eliminated.
 *
 * This replaces the old continuous HP-damage model with stance modifiers,
 * terrain multipliers, and counter triangles — the new system is simple,
 * transparent, and resolves quickly.
 */

interface Side {
  ownerIds: string[];
  armies: Army[];
  /** Total troop value across all units in this side. */
  totalTroops: number;
}

/**
 * Resolves one tick of every ongoing battle and advances territory capture.
 * Returns the set of territory ids that saw fighting this tick.
 */
export function resolveCombat(state: MatchState): Set<string> {
  const contested = new Set<string>();

  for (const territory of Object.values(state.territories)) {
    const present = armiesAt(state, territory.id);
    if (present.length === 0) {
      territory.captureProgress = 0;
      territory.captureBy = null;
      continue;
    }

    const sides = partitionIntoSides(state, present);

    if (sides.length >= 2) {
      contested.add(territory.id);
      fight(state, territory.id, sides);
      territory.captureProgress = 0;
      territory.captureBy = null;
      continue;
    }

    // Uncontested: the single side present may be capturing.
    const side = sides[0]!;
    const holderIsOwner = side.ownerIds.some((id) => areFriendly(state, id, territory.ownerId));
    if (holderIsOwner) {
      territory.captureProgress = 0;
      territory.captureBy = null;
      continue;
    }

    // Ground forces take ground.
    const occupier = side.armies.find((army) => army.stance !== 'hold' && hasGroundForce(army.units));
    if (!occupier) {
      territory.captureProgress = 0;
      territory.captureBy = null;
      continue;
    }

    const claimant = strongestOwner(state, side);
    if (territory.captureBy !== claimant) {
      territory.captureBy = claimant;
      territory.captureProgress = 0;
    }
    territory.captureProgress += 1;

    if (territory.captureProgress >= CAPTURE_TICKS) {
      capture(state, territory.id, claimant);
    }
  }

  closeFinishedBattles(state, contested);
  cullEmptyArmies(state);
  return contested;
}

/** Greedy partition: an army joins the first side it is friendly with, else starts one. */
function partitionIntoSides(state: MatchState, armies: Army[]): Side[] {
  const sides: Side[] = [];
  for (const army of armies) {
    let placed = false;
    for (const side of sides) {
      if (side.ownerIds.every((id) => areFriendly(state, id, army.ownerId))) {
        side.armies.push(army);
        if (!side.ownerIds.includes(army.ownerId)) side.ownerIds.push(army.ownerId);
        placed = true;
        break;
      }
    }
    if (!placed) sides.push({ ownerIds: [army.ownerId], armies: [army], totalTroops: 0 });
  }
  return sides;
}

/** Sum the troop value of every unit in the side. */
function calcTroops(side: Side): number {
  let total = 0;
  for (const army of side.armies) {
    for (const [unitId, count] of Object.entries(army.units)) {
      const def = UNITS[unitId as UnitType];
      if (def && count) total += def.troopValue * count;
    }
  }
  return total;
}

/**
 * Dice-roll combat: each side rolls rand(1, totalTroops) and kills that many
 * enemy troops. Casualties are spread proportionally across unit types.
 */
function fight(state: MatchState, territoryId: string, sides: Side[]): void {
  // Calculate troop totals for each side.
  for (const side of sides) {
    side.totalTroops = calcTroops(side);
  }

  ensureBattleRecord(state, territoryId, sides);

  // Each side rolls and kills from every other side.
  const kills: number[] = new Array(sides.length).fill(0);
  for (let i = 0; i < sides.length; i++) {
    const side = sides[i]!;
    if (side.totalTroops <= 0) continue;
    // Roll 1 to totalTroops — the number of enemy troops killed.
    kills[i] = randInt(state, 1, side.totalTroops);
  }

  // Apply kills: each side distributes its kill count across enemy sides.
  for (let i = 0; i < sides.length; i++) {
    const killCount = kills[i]!;
    if (killCount <= 0) continue;

    // Distribute kills across all enemy sides proportionally.
    const enemySides = sides.filter((_, j) => j !== i);
    const enemyTotalTroops = enemySides.reduce((sum, s) => sum + s.totalTroops, 0);
    if (enemyTotalTroops <= 0) continue;

    for (const enemy of enemySides) {
      const share = enemy.totalTroops / enemyTotalTroops;
      const killsToEnemy = Math.round(killCount * share);
      if (killsToEnemy > 0) {
        applyKills(state, territoryId, enemy, killsToEnemy);
      }
    }
  }
}

/**
 * Removes `killCount` troops from a side, spread proportionally across
 * unit types based on their troop-value share.
 */
function applyKills(state: MatchState, territoryId: string, side: Side, killCount: number): void {
  if (side.totalTroops <= 0) return;
  const fraction = Math.min(1, killCount / side.totalTroops);
  const battle = state.battles.find((b) => b.territoryId === territoryId);

  for (const army of side.armies) {
    for (const key of Object.keys(army.units) as UnitType[]) {
      const count = army.units[key];
      if (!count || count <= 0) continue;
      const def = UNITS[key];
      if (!def) continue;
      // Troops lost = unit count × troop value share × kill fraction.
      const troopShare = (def.troopValue * count) / side.totalTroops;
      const lost = Math.min(count, Math.ceil(count * fraction * troopShare * (side.totalTroops / (def.troopValue * count))));
      // Simpler: just scale by fraction.
      const simpleLost = Math.min(count, Math.max(1, Math.round(count * fraction)));
      army.units[key] = Math.max(0, count - simpleLost);
      if (battle) battle.losses[army.ownerId] = (battle.losses[army.ownerId] ?? 0) + simpleLost;
    }
  }
}

function strongestOwner(state: MatchState, side: Side): string {
  let best = side.armies[0]!.ownerId;
  let bestCount = -1;
  for (const playerId of state.playerOrder) {
    let count = 0;
    for (const army of side.armies) if (army.ownerId === playerId) count += armyUnitCount(army);
    if (count > bestCount) {
      bestCount = count;
      best = playerId;
    }
  }
  return best;
}

function capture(state: MatchState, territoryId: string, newOwnerId: string): void {
  const territory = state.territories[territoryId]!;
  const previous = territory.ownerId;
  territory.ownerId = newOwnerId;
  territory.captureProgress = 0;
  territory.captureBy = null;
  territory.unrest = CAPTURE_UNREST;

  for (const b of territory.buildings) {
    if (b.completesAtTick > 0) {
      b.completesAtTick = 0;
      b.targetLevel = b.level;
    }
  }
  state.training = state.training.filter((o) => o.territoryId !== territoryId);

  awardMatchXp(state, newOwnerId, XP_REWARDS.territoryCaptured);
  if (previous) awardMatchXp(state, previous, XP_REWARDS.territoryLost);

  const name = territoryDef(territoryId).name;
  const takerName = state.players[newOwnerId]?.name ?? 'Someone';
  addEvent(state, 'territory_captured', newOwnerId,
    previous ? `${takerName} has taken ${name}.` : `${takerName} has occupied neutral ${name}.`,
    { territoryId, data: { from: previous } });
  if (previous) {
    addEvent(state, 'territory_captured', previous, `You have lost ${name}.`, { territoryId });
  }
}

function ensureBattleRecord(state: MatchState, territoryId: string, sides: Side[]): void {
  const existing = state.battles.find((b) => b.territoryId === territoryId);
  if (existing) return;
  const territory = state.territories[territoryId]!;
  const defenders = sides
    .filter((s) => s.ownerIds.some((id) => areFriendly(state, id, territory.ownerId)))
    .flatMap((s) => s.ownerIds);
  const attackers = sides.flatMap((s) => s.ownerIds).filter((id) => !defenders.includes(id));

  state.battles.push({
    territoryId,
    startedAtTick: state.tick,
    attackerIds: attackers,
    defenderIds: defenders,
    losses: {},
  });
  addEvent(state, 'battle_started', null, `Fighting has broken out in ${territoryDef(territoryId).name}.`,
    { territoryId });
}

function closeFinishedBattles(state: MatchState, contested: Set<string>): void {
  for (let i = state.battles.length - 1; i >= 0; i--) {
    const battle = state.battles[i]!;
    if (contested.has(battle.territoryId)) continue;
    addEvent(state, 'battle_ended', null,
      `The battle for ${territoryDef(battle.territoryId).name} is over.`,
      { territoryId: battle.territoryId, data: { losses: battle.losses } });
    state.battles.splice(i, 1);
  }
}
