import type { Army, GameEvent, GameEventType, Leader, MatchConfig, MatchState, Player, ResourceDelta, Resources, Territory, TerritoryDef, UnitCounts } from '../types.js';
export declare function emptyResources(): Resources;
export declare function createMatch(id: string, code: string, config?: Partial<MatchConfig>): MatchState;
export declare function addPlayer(state: MatchState, id: string, name: string, opts?: {
    team?: number;
    leader?: Leader;
}): Player;
export declare function removePlayer(state: MatchState, id: string): void;
/**
 * Assigns starting territories and a small starting force, then flips the match to
 * `playing`. Starts are taken from the map's pre-spread list so a 2-player match
 * begins on opposite sides of the globe.
 */
export declare function startMatch(state: MatchState): void;
export declare function nextId(state: MatchState, prefix: string): string;
export declare function createArmy(state: MatchState, ownerId: string, at: string, units: UnitCounts): Army;
/** The stationary army a player has in a territory, if any — where new units land. */
export declare function garrisonOf(state: MatchState, ownerId: string, territoryId: string): Army | undefined;
/** Every army physically standing in a territory (excludes armies in transit). */
export declare function armiesAt(state: MatchState, territoryId: string): Army[];
export declare function armyUnitCount(army: Army): number;
export declare function mergeArmies(target: Army, source: Army): void;
export declare function territoryDef(id: string): TerritoryDef;
export declare function playerTerritories(state: MatchState, playerId: string): Territory[];
export declare function ownedTerritoryCount(state: MatchState, playerId: string): number;
/** Allies share vision and never fight each other. Same team is implicitly allied. */
export declare function areFriendly(state: MatchState, a: string | null, b: string | null): boolean;
export declare function canAfford(resources: Resources, cost: ResourceDelta): boolean;
export declare function spend(resources: Resources, cost: ResourceDelta): void;
export declare function refund(resources: Resources, cost: ResourceDelta): void;
/** Which resources are missing, for a UI message like "Need 120 materials". */
export declare function missingResources(resources: Resources, cost: ResourceDelta): ResourceDelta;
export declare function addEvent(state: MatchState, type: GameEventType, playerId: string | null, text: string, extra?: Partial<GameEvent>): void;
/** Match state is plain JSON by construction, so save/resume is this one line. */
export declare function serializeMatch(state: MatchState): string;
export declare function deserializeMatch(json: string): MatchState;
//# sourceMappingURL=state.d.ts.map