import type { Army, LinkKind, MatchState, UnitCounts } from '../types.js';
/**
 * Where each domain may go (M7). No transport-loading mechanic — geography does the
 * work instead, which is far easier to understand on a phone:
 *
 *   land   land links only; marines are amphibious and may also cross open water
 *   sea    sea links only, and only between coastal territories
 *   air    anywhere, which is what the range and cost are paying for
 *
 * A mixed army moves at the speed of its slowest unit and is restricted by its most
 * restricted unit — so a fleet with a tank aboard simply cannot sail.
 */
export declare function canCrossLink(units: UnitCounts, kind: LinkKind): boolean;
export type TraverseBlocker = 'cannot_cross_sea' | 'ships_need_coast' | 'ships_need_water';
export declare function traverseBlocker(units: UnitCounts, kind: LinkKind, destinationCoastal: boolean): TraverseBlocker | null;
/** True if the army contains anything that can hold ground — ships and planes cannot. */
export declare function hasGroundForce(units: UnitCounts): boolean;
/** An army moves at the speed of its slowest unit. */
export declare function armySpeed(state: MatchState, army: Army): number;
/** Ticks for `army` to travel from its current territory to `to`. */
export declare function travelTicks(state: MatchState, army: Army, to: string): number;
export type MoveBlocker = 'not_adjacent' | 'empty_army' | 'already_moving' | TraverseBlocker;
export declare function moveBlocker(state: MatchState, army: Army, to: string): MoveBlocker | null;
/** Every territory this army could legally move to right now — drives map highlighting. */
export declare function legalDestinations(state: MatchState, army: Army): string[];
/**
 * Finds a safe multi-territory route. Intermediate stops must already belong to the
 * moving player; the final territory may be unclaimed or hostile so an army can still
 * launch an invasion. This prevents a player from using another nation as a free road.
 */
export declare function routeForArmy(state: MatchState, army: Army, destination: string): string[] | null;
export declare function orderMove(state: MatchState, army: Army, to: string): void;
/**
 * Advances every moving army. On arrival, an army merges into any stationary army
 * its owner already has there, so a player never accumulates dozens of stacks.
 */
export declare function tickArmies(state: MatchState): void;
export declare function cullEmptyArmies(state: MatchState): void;
/** Splits `units` out of `army` into a new army standing in the same territory. */
export declare function splitArmy(state: MatchState, army: Army, units: UnitCounts, newId: string): Army | null;
//# sourceMappingURL=armies.d.ts.map