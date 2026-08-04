import type { Army, MatchState, Stance, UnitDomain, UnitType } from '../types.js';
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import {
  CAPTURE_TICKS, CAPTURE_UNREST, COMBAT_DAMAGE_RATE, COMBAT_JITTER, TERRAIN_DEFENCE_MUL,
} from '../config/constants.js';
import { randRange } from '../util/rng.js';
import { addEvent, areFriendly, armiesAt, armyUnitCount, territoryDef } from './state.js';
import { XP_REWARDS, awardMatchXp } from './leader.js';
import { cullEmptyArmies, hasGroundForce } from './armies.js';

/**
 * Stance is the one tactical lever available without micromanagement, so it has to be
 * worth using: aggressive trades survivability for damage, hold trades all offence for
 * a fortress. Beginners can ignore it entirely and default to defensive.
 */
const STANCE_MODIFIERS: Record<Stance, { attack: number; defence: number }> = {
  aggressive: { attack: 1.35, defence: 0.8 },
  defensive: { attack: 1.0, defence: 1.15 },
  // Hold keeps full firepower and gains heavy defence, but forfeits capture entirely.
  // An earlier version also cut its attack; because damage output scales with attack,
  // that made a dug-in defender mathematically unable to win an even fight, which is
  // the opposite of what a fortified position should mean.
  hold: { attack: 1.0, defence: 1.45 },
};

interface Side {
  ownerIds: string[];
  armies: Army[];
  attack: number;
  defence: number;
  hp: number;
}

/**
 * Resolves one tick of every ongoing battle and advances territory capture.
 * Returns the set of territory ids that saw fighting this tick — the population
 * model uses it to apply war damage.
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

    // Ground forces take ground. A fleet offshore or a squadron overhead can destroy
    // an army but cannot raise a flag — which is what makes infantry always relevant.
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
    if (!placed) sides.push({ ownerIds: [army.ownerId], armies: [army], attack: 0, defence: 0, hp: 0 });
  }
  return sides;
}

function dominantDomain(side: Side): UnitDomain {
  const totals: Record<UnitDomain, number> = { land: 0, air: 0, sea: 0 };
  for (const army of side.armies) {
    for (const [unitId, count] of Object.entries(army.units)) {
      const def = UNITS[unitId as UnitType];
      if (def && count) totals[def.domain] += count;
    }
  }
  if (totals.air >= totals.land && totals.air >= totals.sea) return 'air';
  if (totals.sea >= totals.land) return 'sea';
  return 'land';
}

function scoreSide(state: MatchState, side: Side, territoryId: string, enemyDomain: UnitDomain): void {
  const territory = state.territories[territoryId]!;
  const def = territoryDef(territoryId);
  side.attack = 0;
  side.defence = 0;
  side.hp = 0;

  const defendingHere = side.ownerIds.some((id) => areFriendly(state, id, territory.ownerId));
  const terrainMul = defendingHere ? (TERRAIN_DEFENCE_MUL[def.terrain] ?? 1) : 1;

  let fortification = 1;
  if (defendingHere) {
    for (const b of territory.buildings) {
      if (b.level === 0) continue;
      fortification += (BUILDINGS[b.type].defenceBonus ?? 0) * b.level;
    }
  }

  for (const army of side.armies) {
    const mods = state.players[army.ownerId]?.modifiers;
    const stance = STANCE_MODIFIERS[army.stance] ?? STANCE_MODIFIERS.defensive;
    const atkMul = (mods?.unitAttackMul ?? 1) * stance.attack;
    const defMul = (mods?.unitDefenceMul ?? 1) * stance.defence;
    for (const [unitId, count] of Object.entries(army.units)) {
      const unit = UNITS[unitId as UnitType];
      if (!unit || !count) continue;
      const counter = unit.vs?.[enemyDomain] ?? 1;
      side.attack += unit.attack * count * atkMul * counter;
      side.defence += unit.defence * count * defMul * terrainMul * fortification;
      side.hp += unit.hp * count;
    }
  }
}

function fight(state: MatchState, territoryId: string, sides: Side[]): void {
  const domains = sides.map(dominantDomain);
  sides.forEach((side, i) => {
    // Each side is scored against the domain mix of everyone else it is fighting.
    const enemyDomain = domains[(i + 1) % domains.length]!;
    scoreSide(state, side, territoryId, enemyDomain);
  });

  ensureBattleRecord(state, territoryId, sides);

  // Damage is computed from a snapshot so ordering between sides cannot matter.
  const damage = sides.map((side, i) => {
    const enemyDefence = sides.reduce((sum, s, j) => (i === j ? sum : sum + s.defence), 0);
    const ratio = side.attack / Math.max(1, side.attack + enemyDefence);
    const jitter = randRange(state, 1 - COMBAT_JITTER, 1 + COMBAT_JITTER);
    return COMBAT_DAMAGE_RATE * side.attack * ratio * jitter * state.config.speed;
  });

  sides.forEach((side, i) => {
    let incoming = 0;
    for (let j = 0; j < sides.length; j++) if (j !== i) incoming += damage[j]!;
    if (incoming > 0) applyCasualties(state, territoryId, side, incoming);
  });
}

/** Spreads `damage` (in HP) across a side's units, proportional to each type's share of HP. */
function applyCasualties(state: MatchState, territoryId: string, side: Side, damage: number): void {
  if (side.hp <= 0) return;
  const fraction = Math.min(1, damage / side.hp);
  const battle = state.battles.find((b) => b.territoryId === territoryId);

  for (const army of side.armies) {
    for (const [unitId, count] of Object.entries(army.units)) {
      const key = unitId as UnitType;
      const unit = UNITS[key];
      if (!unit || !count) continue;
      const lost = count * fraction;
      army.units[key] = Math.max(0, count - lost);
      if (battle) battle.losses[army.ownerId] = (battle.losses[army.ownerId] ?? 0) + lost;
    }
  }
}

function strongestOwner(state: MatchState, side: Side): string {
  let best = side.armies[0]!.ownerId;
  let bestCount = -1;
  // Iterate in player order so ties resolve identically on every machine.
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

  // Occupation cancels whatever the previous owner was building or training here.
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
