import type { BuildingDef, BuildingType, ResourceDelta } from '../types.js';
/**
 * All 13 buildings across the three categories. `mvp: true` marks the Phase 1
 * buildable set — everything else is fully specified so Phase 2 is a UI change,
 * not a design exercise.
 *
 * Levels 1-10. Tier names change at 4 and 8, which is what the player actually
 * notices ("Basic farming → Industrial farming → AI agriculture").
 */
export declare const BUILDINGS: Record<BuildingType, BuildingDef>;
export declare const BUILDING_LIST: BuildingDef[];
export declare const MVP_BUILDINGS: BuildingDef[];
/** Cost of taking a building from `level-1` to `level` (level 1 = initial construction). */
export declare function buildingCost(type: BuildingType, level: number): ResourceDelta;
/** Ticks required to reach `level`, before any build-speed modifiers. */
export declare function buildingTicks(type: BuildingType, level: number): number;
/** Per-minute yield of a building at a given level (linear in level). */
export declare function buildingYield(type: BuildingType, level: number): ResourceDelta;
/** Human-readable tier name for the level, e.g. farm level 9 → "AI Agriculture". */
export declare function tierName(type: BuildingType, level: number): string;
//# sourceMappingURL=buildings.d.ts.map