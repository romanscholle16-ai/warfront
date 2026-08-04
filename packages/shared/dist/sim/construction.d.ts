import type { BuildingDef, BuildingType, MatchState, Territory, UnitDef, UnitType } from '../types.js';
export type Ineligible = 'not_owner' | 'no_free_slot' | 'already_building' | 'max_level' | 'wrong_terrain' | 'not_coastal' | 'missing_building' | 'no_manpower' | 'unknown_building' | 'unknown_unit' | 'not_unlocked';
/** Why a building can't be placed here — null means it can. */
export declare function buildingBlocker(state: MatchState, playerId: string, territoryId: string, type: BuildingType): Ineligible | null;
/** Level that a BUILD/UPGRADE command would move this building to. */
export declare function nextBuildingLevel(territory: Territory, type: BuildingType): number;
export declare function unitBlocker(state: MatchState, playerId: string, territoryId: string, unit: UnitType, count: number): Ineligible | null;
/**
 * Every building that could ever be placed in this territory, given its terrain and
 * coastline (M10). The UI uses this to show the full catalogue with honest reasons
 * instead of silently hiding options — a player should be able to see that a Naval
 * Base exists and understand why they cannot build one inland.
 */
export declare function buildingsForTerritory(territoryId: string): BuildingDef[];
/** Units this territory can train right now, based on the buildings standing in it. */
export declare function unlockedUnits(state: MatchState, territoryId: string): UnitDef[];
/** The strongest unit a player can currently train anywhere — drives advisor advice. */
export declare function bestAvailableUnit(state: MatchState, playerId: string): {
    unit: UnitDef;
    territoryId: string;
} | null;
/** Begins construction/upgrade. Caller has already validated and charged the cost. */
export declare function beginBuilding(state: MatchState, territory: Territory, type: BuildingType, buildSpeedMul: number): void;
export declare function beginTraining(state: MatchState, playerId: string, territoryId: string, unit: UnitType, count: number, trainSpeedMul: number): void;
export declare function tickConstruction(state: MatchState): void;
export declare function tickTraining(state: MatchState): void;
export declare function tickResearch(state: MatchState): void;
//# sourceMappingURL=construction.d.ts.map