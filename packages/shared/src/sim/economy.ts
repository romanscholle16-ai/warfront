import type { MatchState, Player, ResourceDelta, Resources, Territory } from '../types.js';
import { RESOURCE_KEYS } from '../types.js';
import { BUILDINGS, buildingYield } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import {
  BATTLE_POP_DAMAGE_PER_MINUTE, POP_BASE_GROWTH_PER_MINUTE, POP_FOOD_UPKEEP_PER_1K_PER_MINUTE,
  POP_INCOME_PER_1K_PER_MINUTE, POP_MAX_PER_SLOT, POP_STARVATION_RATE, TERRAIN_YIELD_MUL,
  TERRITORY_BASE_YIELD, UNREST_DECAY_PER_MINUTE, perTick,
} from '../config/constants.js';
import { emptyResources, ownedTerritoryCount, territoryDef } from './state.js';

/**
 * Gross per-minute yield of one territory: terrain × economy weight × buildings,
 * suppressed by unrest in freshly conquered land.
 */
export function territoryYield(territory: Territory): Resources {
  const def = territoryDef(territory.id);
  const out = emptyResources();
  const terrain = TERRAIN_YIELD_MUL[def.terrain] ?? {};

  for (const key of RESOURCE_KEYS) {
    const base = TERRITORY_BASE_YIELD[key as keyof typeof TERRITORY_BASE_YIELD] ?? 0;
    out[key] = base * def.baseEcon * (terrain[key] ?? 1);
  }

  // Natural richness only affects what the ground actually produces.
  out.oil *= def.resources.oil;
  out.materials *= def.resources.materials;
  out.food *= def.resources.food;

  for (const b of territory.buildings) {
    if (b.level === 0) continue;
    const y = buildingYield(b.type, b.level);
    for (const key of RESOURCE_KEYS) out[key] += y[key] ?? 0;
  }

  // People pay taxes and eat.
  out.money += territory.pop * POP_INCOME_PER_1K_PER_MINUTE;
  out.food -= territory.pop * POP_FOOD_UPKEEP_PER_1K_PER_MINUTE;

  // Occupied populations don't cooperate. Unrest only bites civilian output.
  const order = 1 - territory.unrest * 0.6;
  out.money *= order;
  out.research *= order;

  return out;
}

/** Per-minute upkeep of everything a player currently fields. */
export function playerUpkeep(state: MatchState, playerId: string): Resources {
  const out = emptyResources();
  for (const army of Object.values(state.armies)) {
    if (army.ownerId !== playerId) continue;
    for (const [unitId, count] of Object.entries(army.units)) {
      const def = UNITS[unitId as keyof typeof UNITS];
      if (!def || !count) continue;
      for (const key of RESOURCE_KEYS) {
        out[key] += (def.upkeepPerMinute[key] ?? 0) * count;
      }
    }
  }
  return out;
}

/** Net per-minute flow for a player — this is exactly what the HUD shows. */
export function computeIncome(state: MatchState, player: Player): Resources {
  const gross = emptyResources();
  for (const territory of Object.values(state.territories)) {
    if (territory.ownerId !== player.id) continue;
    const y = territoryYield(territory);
    for (const key of RESOURCE_KEYS) gross[key] += y[key];
  }

  const m = player.modifiers;
  gross.money *= m.incomeMul;
  gross.food *= m.foodMul;
  gross.oil *= m.oilMul;
  gross.materials *= m.materialsMul;
  gross.research *= m.researchMul;

  // Empire bonus: holding 10+ territories grants +5 % money.
  if (ownedTerritoryCount(state, player.id) >= 10) {
    gross.money *= 1.05;
  }

  const upkeep = playerUpkeep(state, player.id);
  for (const key of RESOURCE_KEYS) gross[key] -= upkeep[key] * m.upkeepMul;

  return gross;
}

/**
 * Applies one tick of economy to every player, and returns the set of players who
 * could not pay upkeep (their units will suffer attrition).
 */
export function applyEconomyTick(state: MatchState): Set<string> {
  const bankrupt = new Set<string>();
  const speed = state.config.speed;

  for (const player of Object.values(state.players)) {
    if (player.eliminatedAtTick !== null) continue;
    const income = computeIncome(state, player);
    player.income = income;

    for (const key of RESOURCE_KEYS) {
      const next = player.resources[key] + perTick(income[key]) * speed;
      if (next < 0) {
        player.resources[key] = 0;
        if (income[key] < 0) bankrupt.add(player.id);
      } else {
        player.resources[key] = next;
      }
    }
  }
  return bankrupt;
}

/** Population growth, starvation, unrest decay and war damage. */
export function applyPopulationTick(state: MatchState, contested: Set<string>): void {
  const speed = state.config.speed;

  for (const territory of Object.values(state.territories)) {
    const def = territoryDef(territory.id);
    const owner = territory.ownerId ? state.players[territory.ownerId] : undefined;

    if (territory.unrest > 0) {
      territory.unrest = Math.max(0, territory.unrest - perTick(UNREST_DECAY_PER_MINUTE) * speed);
    }

    if (contested.has(territory.id)) {
      territory.pop = Math.max(10, territory.pop * (1 - perTick(BATTLE_POP_DAMAGE_PER_MINUTE) * speed));
      // War breeds resentment even in your own land.
      territory.unrest = Math.min(1, territory.unrest + perTick(0.05) * speed);
      continue;
    }

    if (!owner) continue;

    const starving = owner.resources.food <= 0 && owner.income.food < 0;
    if (starving) {
      territory.pop = Math.max(10, territory.pop * (1 - perTick(POP_STARVATION_RATE) * speed));
      continue;
    }

    let growth = POP_BASE_GROWTH_PER_MINUTE * owner.modifiers.popGrowthMul;
    let flatGrowth = 0;
    for (const b of territory.buildings) {
      if (b.level === 0) continue;
      flatGrowth += (BUILDINGS[b.type].popGrowth ?? 0) * b.level;
    }
    growth *= 1 - territory.unrest * 0.5;

    const cap = def.slots * POP_MAX_PER_SLOT;
    const crowding = Math.max(0, 1 - territory.pop / cap);
    const delta = (territory.pop * growth + flatGrowth) * crowding;
    territory.pop = Math.min(cap, territory.pop + perTick(delta) * speed);
  }
}

/** Formats a per-minute delta for the HUD ("+1 240 /min"). */
export function formatRate(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${value >= 0 ? '+' : ''}${rounded}`;
}

export function addDelta(target: Resources, delta: ResourceDelta, scale = 1): void {
  for (const key of RESOURCE_KEYS) {
    const v = delta[key];
    if (v !== undefined) target[key] += v * scale;
  }
}
