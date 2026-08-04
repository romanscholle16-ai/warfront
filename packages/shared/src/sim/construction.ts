import type { BuildingDef, BuildingType, MatchState, Territory, UnitDef, UnitType } from '../types.js';
import { BUILDINGS, BUILDING_LIST, buildingCost, buildingTicks, tierName } from '../config/buildings.js';
import { UNITS, UNIT_LIST } from '../config/units.js';
import { TECH_BY_ID } from '../config/tech.js';
import { MAX_BUILDING_LEVEL } from '../config/constants.js';
import { addEvent, createArmy, garrisonOf, nextId, territoryDef } from './state.js';
import { refreshModifiers } from './modifiers.js';
import { XP_REWARDS, awardMatchXp } from './leader.js';

// ── eligibility ────────────────────────────────────────────────────────────

export type Ineligible =
  | 'not_owner' | 'no_free_slot' | 'already_building' | 'max_level'
  | 'wrong_terrain' | 'not_coastal' | 'missing_building' | 'no_manpower'
  | 'unknown_building' | 'unknown_unit' | 'not_unlocked';

/** Why a building can't be placed here — null means it can. */
export function buildingBlocker(
  state: MatchState,
  playerId: string,
  territoryId: string,
  type: BuildingType,
): Ineligible | null {
  const territory = state.territories[territoryId];
  const def = BUILDINGS[type];
  if (!territory) return 'not_owner';
  if (!def) return 'unknown_building';
  if (territory.ownerId !== playerId) return 'not_owner';

  const tdef = territoryDef(territoryId);
  if (def.requiresCoastal && !tdef.coastal) return 'not_coastal';
  if (def.requiresTerrain && !def.requiresTerrain.includes(tdef.terrain)) return 'wrong_terrain';

  const existing = territory.buildings.find((b) => b.type === type);
  if (existing) {
    if (existing.completesAtTick > 0) return 'already_building';
    if (existing.level >= MAX_BUILDING_LEVEL) return 'max_level';
    return null; // upgrade path
  }
  if (territory.buildings.length >= tdef.slots) return 'no_free_slot';
  return null;
}

/** Level that a BUILD/UPGRADE command would move this building to. */
export function nextBuildingLevel(territory: Territory, type: BuildingType): number {
  const existing = territory.buildings.find((b) => b.type === type);
  return (existing?.level ?? 0) + 1;
}

export function unitBlocker(
  state: MatchState,
  playerId: string,
  territoryId: string,
  unit: UnitType,
  count: number,
): Ineligible | null {
  const territory = state.territories[territoryId];
  const def = UNITS[unit];
  if (!def) return 'unknown_unit';
  if (!territory || territory.ownerId !== playerId) return 'not_owner';

  const source = territory.buildings.find((b) => b.type === def.requires.building);
  if (!source || source.level < def.requires.level) return 'missing_building';
  if (territory.pop < def.manpower * count) return 'no_manpower';
  return null;
}

/**
 * Every building that could ever be placed in this territory, given its terrain and
 * coastline (M10). The UI uses this to show the full catalogue with honest reasons
 * instead of silently hiding options — a player should be able to see that a Naval
 * Base exists and understand why they cannot build one inland.
 */
export function buildingsForTerritory(territoryId: string): BuildingDef[] {
  const def = territoryDef(territoryId);
  return BUILDING_LIST.filter((building) => {
    if (building.requiresCoastal && !def.coastal) return false;
    if (building.requiresTerrain && !building.requiresTerrain.includes(def.terrain)) return false;
    return true;
  });
}

/** Units this territory can train right now, based on the buildings standing in it. */
export function unlockedUnits(state: MatchState, territoryId: string): UnitDef[] {
  const territory = state.territories[territoryId];
  if (!territory) return [];
  return UNIT_LIST.filter((unit) => {
    const source = territory.buildings.find((b) => b.type === unit.requires.building);
    return !!source && source.level >= unit.requires.level;
  });
}

/** The strongest unit a player can currently train anywhere — drives advisor advice. */
export function bestAvailableUnit(state: MatchState, playerId: string): { unit: UnitDef; territoryId: string } | null {
  let best: { unit: UnitDef; territoryId: string } | null = null;
  for (const territory of Object.values(state.territories)) {
    if (territory.ownerId !== playerId) continue;
    for (const unit of unlockedUnits(state, territory.id)) {
      if (unit.domain !== 'land') continue; // advisor recommends what can take ground
      if (!best || unit.attack + unit.defence > best.unit.attack + best.unit.defence) {
        best = { unit, territoryId: territory.id };
      }
    }
  }
  return best;
}

// ── starting work ──────────────────────────────────────────────────────────

/** Begins construction/upgrade. Caller has already validated and charged the cost. */
export function beginBuilding(
  state: MatchState,
  territory: Territory,
  type: BuildingType,
  buildSpeedMul: number,
): void {
  const target = nextBuildingLevel(territory, type);
  const ticks = Math.max(1, Math.round(buildingTicks(type, target) / buildSpeedMul / state.config.speed));
  const existing = territory.buildings.find((b) => b.type === type);
  if (existing) {
    existing.targetLevel = target;
    existing.completesAtTick = state.tick + ticks;
  } else {
    territory.buildings.push({
      type,
      level: 0,
      targetLevel: 1,
      completesAtTick: state.tick + ticks,
    });
  }
}

export function beginTraining(
  state: MatchState,
  playerId: string,
  territoryId: string,
  unit: UnitType,
  count: number,
  trainSpeedMul: number,
): void {
  const ticks = trainingTicks(state, unit, trainSpeedMul);
  state.training.push({
    id: nextId(state, 'q'),
    ownerId: playerId,
    territoryId,
    unit,
    remaining: count,
    nextCompletesAtTick: state.tick + ticks,
  });
  const territory = state.territories[territoryId];
  if (territory) territory.pop -= UNITS[unit].manpower * count;
}

function trainingTicks(state: MatchState, unit: UnitType, trainSpeedMul: number): number {
  return Math.max(1, Math.round(UNITS[unit].trainTicks / trainSpeedMul / state.config.speed));
}

// ── per-tick progression ───────────────────────────────────────────────────

export function tickConstruction(state: MatchState): void {
  for (const territory of Object.values(state.territories)) {
    for (const b of territory.buildings) {
      if (b.completesAtTick === 0 || state.tick < b.completesAtTick) continue;
      b.level = b.targetLevel;
      b.completesAtTick = 0;
      if (territory.ownerId) awardMatchXp(state, territory.ownerId, XP_REWARDS.buildingCompleted);
      const def = BUILDINGS[b.type];
      addEvent(
        state,
        'building_completed',
        territory.ownerId,
        `${def.name} level ${b.level} (${tierName(b.type, b.level)}) completed in ${territoryDef(territory.id).name}.`,
        { territoryId: territory.id, data: { building: b.type, level: b.level } },
      );
    }
  }
}

export function tickTraining(state: MatchState): void {
  const finished: number[] = [];

  state.training.forEach((order, index) => {
    if (state.tick < order.nextCompletesAtTick) return;
    const player = state.players[order.ownerId];
    const territory = state.territories[order.territoryId];

    // Losing the territory cancels the queue — units have nowhere to muster.
    if (!player || !territory || territory.ownerId !== order.ownerId) {
      finished.push(index);
      return;
    }

    const garrison = garrisonOf(state, order.ownerId, order.territoryId)
      ?? createArmy(state, order.ownerId, order.territoryId, {});
    garrison.units[order.unit] = (garrison.units[order.unit] ?? 0) + 1;
    order.remaining -= 1;

    addEvent(
      state,
      'units_trained',
      order.ownerId,
      `${UNITS[order.unit].name} ready in ${territoryDef(order.territoryId).name}.`,
      { territoryId: order.territoryId, data: { unit: order.unit } },
    );

    if (order.remaining <= 0) {
      finished.push(index);
    } else {
      order.nextCompletesAtTick = state.tick + trainingTicks(state, order.unit, player.modifiers.trainSpeedMul);
    }
  });

  for (let i = finished.length - 1; i >= 0; i--) {
    state.training.splice(finished[i]!, 1);
  }
}

export function tickResearch(state: MatchState): void {
  for (const player of Object.values(state.players)) {
    const active = player.research;
    if (!active || state.tick < active.completesAtTick) continue;
    player.tech.push(active.techId);
    player.research = null;
    refreshModifiers(player);
    awardMatchXp(state, player.id, XP_REWARDS.researchCompleted);
    const def = TECH_BY_ID[active.techId];
    addEvent(
      state,
      'research_completed',
      player.id,
      `Research complete: ${def?.name ?? active.techId}.`,
      { data: { techId: active.techId } },
    );
  }
}
