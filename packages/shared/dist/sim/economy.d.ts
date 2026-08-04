import type { MatchState, Player, ResourceDelta, Resources, Territory } from '../types.js';
/**
 * Gross per-minute yield of one territory: terrain × economy weight × buildings,
 * suppressed by unrest in freshly conquered land.
 */
export declare function territoryYield(territory: Territory): Resources;
/** Per-minute upkeep of everything a player currently fields. */
export declare function playerUpkeep(state: MatchState, playerId: string): Resources;
/** Net per-minute flow for a player — this is exactly what the HUD shows. */
export declare function computeIncome(state: MatchState, player: Player): Resources;
/**
 * Applies one tick of economy to every player, and returns the set of players who
 * could not pay upkeep (their units will suffer attrition).
 */
export declare function applyEconomyTick(state: MatchState): Set<string>;
/** Population growth, starvation, unrest decay and war damage. */
export declare function applyPopulationTick(state: MatchState, contested: Set<string>): void;
/** Formats a per-minute delta for the HUD ("+1 240 /min"). */
export declare function formatRate(value: number): string;
export declare function addDelta(target: Resources, delta: ResourceDelta, scale?: number): void;
//# sourceMappingURL=economy.d.ts.map