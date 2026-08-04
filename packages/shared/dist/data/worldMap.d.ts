import type { LinkKind, MapDef, TerritoryDef } from '../types.js';
export declare const EARTH_MODERN: MapDef;
export declare const TERRITORY_DEFS: Record<string, TerritoryDef>;
export interface Link {
    to: string;
    kind: LinkKind;
    /** Great-circle-ish distance in map units, used to scale travel time. */
    distance: number;
}
export declare const ADJACENCY: Record<string, Link[]>;
export declare function areAdjacent(a: string, b: string): boolean;
export declare function linkBetween(a: string, b: string): Link | undefined;
/** Median link distance — used to normalise unit speed so 1.0 speed ≈ 1 link/minute. */
export declare const AVERAGE_LINK_DISTANCE: number;
//# sourceMappingURL=worldMap.d.ts.map