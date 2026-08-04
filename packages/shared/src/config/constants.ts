/**
 * Global tuning constants. Everything that a designer would want to tweak lives in
 * src/config — never inline in the sim. One file to rebalance the whole game.
 */

import type { MatchConfig, Resources } from '../types.js';

/** Simulation tick length. 5 Hz: smooth enough for RTS, cheap enough for a free-tier CPU. */
export const TICK_MS = 200;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60; // 300

/** Rates in the config files are written per minute; the sim needs per tick. */
export function perTick(perMinute: number): number {
  return perMinute / TICKS_PER_MINUTE;
}

// ── economy ───────────────────────────────────────────────────────────────

export const STARTING_RESOURCES: Resources = {
  money: 2000,
  food: 1000,
  oil: 500,
  materials: 1500,
  research: 0,
};

/** Base per-minute yield of a territory of average (1.0) economy, before buildings. */
export const TERRITORY_BASE_YIELD = {
  money: 30,
  food: 12,
  oil: 3,
  materials: 8,
  research: 1.5,
};

/** Cities earn more, mountains earn less, etc. Multiplies TERRITORY_BASE_YIELD. */
export const TERRAIN_YIELD_MUL: Record<string, Partial<Resources>> = {
  city: { money: 2.0, food: 0.6, materials: 0.8, research: 1.8 },
  plains: { money: 0.9, food: 1.8, materials: 0.9 },
  mountain: { money: 0.7, food: 0.4, materials: 1.6, oil: 0.8 },
  coast: { money: 1.3, food: 1.2, oil: 1.1 },
  desert: { money: 0.6, food: 0.2, oil: 2.5 },
  forest: { money: 0.8, food: 1.0, materials: 1.8 },
  tundra: { money: 0.5, food: 0.3, oil: 1.4, materials: 0.9 },
};

/** Defensive multiplier applied to units defending on this terrain. */
export const TERRAIN_DEFENCE_MUL: Record<string, number> = {
  city: 1.35,
  plains: 1.0,
  mountain: 1.75,
  coast: 1.1,
  desert: 0.9,
  forest: 1.25,
  tundra: 1.05,
};

/** Population contributes to income and provides manpower. */
/** Money per minute contributed by each 1 000 people (pop is stored in thousands). */
export const POP_INCOME_PER_1K_PER_MINUTE = 0.02;
export const POP_BASE_GROWTH_PER_MINUTE = 0.004; // 0.4 % per minute at full food
export const POP_FOOD_UPKEEP_PER_1K_PER_MINUTE = 0.01;
/** Population shrinks at this fraction per minute while the nation has no food. */
export const POP_STARVATION_RATE = 0.01;
/** Population ceiling per building slot, in thousands. */
export const POP_MAX_PER_SLOT = 500;

// ── construction / training ───────────────────────────────────────────────

export const COST_GROWTH = 1.55;        // cost multiplier per building level
export const BUILD_TIME_GROWTH = 1.35;  // build time multiplier per level
export const MAX_BUILDING_LEVEL = 10;
export const MAX_TECH_LEVEL = 10;

// ── combat ────────────────────────────────────────────────────────────────

/**
 * Damage coefficient per tick. Tuned so an evenly matched engagement resolves in
 * roughly 40-60 seconds — long enough to react and reinforce, short enough to feel
 * like a real-time battle rather than a spreadsheet.
 */
export const COMBAT_DAMAGE_RATE = 0.2;
/** Random jitter applied to each side's power roll (±). */
export const COMBAT_JITTER = 0.12;
/** Ticks of uncontested occupation needed to flip a territory. */
export const CAPTURE_TICKS = 25; // 5 seconds
/** Unrest applied to a freshly captured territory (decays over time). */
export const CAPTURE_UNREST = 0.8;
export const UNREST_DECAY_PER_MINUTE = 0.12;
/** War damage: fraction of population lost per minute of active battle. */
export const BATTLE_POP_DAMAGE_PER_MINUTE = 0.02;

// ── defaults ──────────────────────────────────────────────────────────────

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mode: 'casual',
  mapId: 'earth_modern',
  speed: 1,
  victoryTerritoryShare: 0.6,
  victoryByConquest: true,
  maxTicks: 0,
  allowPause: true,
  turnDurationSeconds: 90,
  maxPlayers: 10,
};

/** Player colours, assigned by slot. Chosen to stay distinguishable on small screens. */
export const PLAYER_COLOURS = [
  '#e8493f', '#3f7fe8', '#3fbf6a', '#e8c53f', '#8e5ce8',
  '#e87f3f', '#3fd0d0', '#d03f9c', '#7f8fa6', '#b5e83f',
];

export const NEUTRAL_COLOUR = '#4a5158';

/** Maximum commands a client may send per second before the server drops them. */
export const COMMAND_RATE_LIMIT_PER_SECOND = 20;
/** How long a disconnected player's seat is held. */
export const RECONNECT_WINDOW_SECONDS = 120;
/** Ring buffer size for the in-match event feed. */
export const MAX_EVENTS = 200;
