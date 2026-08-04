import { ArraySchema, MapSchema, Schema } from '@colyseus/schema';
import type { MatchState, ResourceDelta, UnitCounts } from '@warfront/shared';
/**
 * The WIRE model.
 *
 * The simulation state (packages/shared) is plain JSON and knows nothing about the
 * network. This file mirrors it into Colyseus Schema objects once per tick, and
 * Colyseus transmits only the fields that actually changed.
 *
 * Why mirror instead of simulating directly on Schema objects:
 *  - the sim stays pure and testable with no framework dependency
 *  - the wire format can be optimised (rounding, packing) without touching game rules
 *  - a future transport swap rewrites only this file
 *
 * Mirroring 48 territories + 10 players costs well under 0.2 ms.
 */
export declare class ResourcesS extends Schema {
    money: number;
    food: number;
    oil: number;
    materials: number;
    research: number;
}
/** Cosmetic only — mirrored so other players can see your leader, never read by the sim. */
export declare class AppearanceS extends Schema {
    body: number;
    face: number;
    hair: number;
    uniform: string;
    accessory: string;
    flag: string;
    colour: string;
}
export declare class TradeOfferS extends Schema {
    id: string;
    fromId: string;
    toId: string;
    /** "money:200,oil:50" — same compact encoding as army composition. */
    give: string;
    want: string;
    expiresAtTick: number;
}
export declare class PingS extends Schema {
    id: string;
    playerId: string;
    territoryId: string;
    kind: string;
    expiresAtTick: number;
}
export declare class PlayerS extends Schema {
    id: string;
    name: string;
    team: number;
    colour: string;
    leaderName: string;
    leaderClass: string;
    leaderLevel: number;
    leaderXp: number;
    leaderXpNeeded: number;
    skillPoints: number;
    skillWarfare: number;
    skillEconomy: number;
    skillIntelligence: number;
    betrayals: number;
    matchXp: number;
    /** Comma-separated ids of players who have offered this player an alliance. */
    allianceOffers: string;
    appearance: AppearanceS;
    ready: boolean;
    connected: boolean;
    ai: boolean;
    eliminated: boolean;
    techCount: number;
    /** Comma-separated completed tech ids. Changes only when research completes. */
    tech: string;
    researchTechId: string;
    researchEndTick: number;
    /** Comma-separated player ids. Cheaper on the wire than an ArraySchema. */
    allies: string;
    resources: ResourcesS;
    income: ResourcesS;
}
export declare class BuildingS extends Schema {
    type: string;
    level: number;
    targetLevel: number;
    completesAtTick: number;
}
export declare class TerritoryS extends Schema {
    id: string;
    ownerId: string;
    pop: number;
    unrest: number;
    captureProgress: number;
    captureBy: string;
    buildings: ArraySchema<BuildingS>;
}
export declare class ArmyS extends Schema {
    id: string;
    ownerId: string;
    at: string;
    movingTo: string;
    progress: number;
    stance: string;
    /** "rifle:12.5,tank:3" — compact, and only changes when a count meaningfully changes. */
    units: string;
    total: number;
}
export declare class BattleS extends Schema {
    territoryId: string;
    startedAtTick: number;
}
export declare class MatchS extends Schema {
    code: string;
    phase: string;
    tick: number;
    mode: string;
    mapId: string;
    speed: number;
    hostId: string;
    winnerTeam: number;
    players: MapSchema<PlayerS, string>;
    territories: MapSchema<TerritoryS, string>;
    armies: MapSchema<ArmyS, string>;
    battles: ArraySchema<BattleS>;
    tradeOffers: ArraySchema<TradeOfferS>;
    pings: ArraySchema<PingS>;
}
export declare function decodeUnits(encoded: string): UnitCounts;
/** Copies the whole simulation into the schema. Called once per tick. */
export declare function syncMatch(sim: MatchState, out: MatchS, ready: Map<string, boolean>, hostId: string): void;
export declare function encodeDelta(delta: ResourceDelta): string;
export declare function decodeDelta(encoded: string): ResourceDelta;
//# sourceMappingURL=schema.d.ts.map