/**
 * Global tuning constants. Everything that a designer would want to tweak lives in
 * src/config — never inline in the sim. One file to rebalance the whole game.
 */
import type { MatchConfig, Resources } from '../types.js';
/** Simulation tick length. 5 Hz: smooth enough for RTS, cheap enough for a free-tier CPU. */
export declare const TICK_MS = 200;
export declare const TICKS_PER_SECOND: number;
export declare const TICKS_PER_MINUTE: number;
/** Rates in the config files are written per minute; the sim needs per tick. */
export declare function perTick(perMinute: number): number;
export declare const STARTING_RESOURCES: Resources;
/** Base per-minute yield of a territory of average (1.0) economy, before buildings. */
export declare const TERRITORY_BASE_YIELD: {
    money: number;
    food: number;
    oil: number;
    materials: number;
    research: number;
};
/** Cities earn more, mountains earn less, etc. Multiplies TERRITORY_BASE_YIELD. */
export declare const TERRAIN_YIELD_MUL: Record<string, Partial<Resources>>;
/** Defensive multiplier applied to units defending on this terrain. */
export declare const TERRAIN_DEFENCE_MUL: Record<string, number>;
/** Population contributes to income and provides manpower. */
/** Money per minute contributed by each 1 000 people (pop is stored in thousands). */
export declare const POP_INCOME_PER_1K_PER_MINUTE = 0.02;
export declare const POP_BASE_GROWTH_PER_MINUTE = 0.004;
export declare const POP_FOOD_UPKEEP_PER_1K_PER_MINUTE = 0.01;
/** Population shrinks at this fraction per minute while the nation has no food. */
export declare const POP_STARVATION_RATE = 0.01;
/** Population ceiling per building slot, in thousands. */
export declare const POP_MAX_PER_SLOT = 500;
export declare const COST_GROWTH = 1.55;
export declare const BUILD_TIME_GROWTH = 1.35;
export declare const MAX_BUILDING_LEVEL = 10;
export declare const MAX_TECH_LEVEL = 10;
/**
 * Damage coefficient per tick. Tuned so an evenly matched engagement resolves in
 * roughly 40-60 seconds — long enough to react and reinforce, short enough to feel
 * like a real-time battle rather than a spreadsheet.
 */
export declare const COMBAT_DAMAGE_RATE = 0.2;
/** Random jitter applied to each side's power roll (±). */
export declare const COMBAT_JITTER = 0.12;
/** Ticks of uncontested occupation needed to flip a territory. */
export declare const CAPTURE_TICKS = 25;
/** Unrest applied to a freshly captured territory (decays over time). */
export declare const CAPTURE_UNREST = 0.8;
export declare const UNREST_DECAY_PER_MINUTE = 0.12;
/** War damage: fraction of population lost per minute of active battle. */
export declare const BATTLE_POP_DAMAGE_PER_MINUTE = 0.02;
export declare const DEFAULT_MATCH_CONFIG: MatchConfig;
/** Player colours, assigned by slot. Chosen to stay distinguishable on small screens. */
export declare const PLAYER_COLOURS: string[];
export declare const NEUTRAL_COLOUR = "#4a5158";
/** Maximum commands a client may send per second before the server drops them. */
export declare const COMMAND_RATE_LIMIT_PER_SECOND = 20;
/** How long a disconnected player's seat is held. */
export declare const RECONNECT_WINDOW_SECONDS = 120;
/** Ring buffer size for the in-match event feed. */
export declare const MAX_EVENTS = 200;
//# sourceMappingURL=constants.d.ts.map