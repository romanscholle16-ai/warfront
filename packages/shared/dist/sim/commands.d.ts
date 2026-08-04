import type { BuildingType, LeaderAppearance, MatchState, PingKind, ResourceDelta, SkillBranch, Stance, UnitCounts, UnitType } from '../types.js';
/**
 * The complete client → server vocabulary. A client can send nothing else, and the
 * server never trusts anything but these. Adding a feature means adding a case here,
 * which is the property that keeps the game cheat-resistant as it grows.
 */
export type Command = {
    t: 'BUILD';
    territoryId: string;
    building: BuildingType;
} | {
    t: 'CANCEL_BUILD';
    territoryId: string;
    building: BuildingType;
} | {
    t: 'TRAIN';
    territoryId: string;
    unit: UnitType;
    count: number;
} | {
    t: 'MOVE_ARMY';
    armyId: string;
    toTerritoryId: string;
} | {
    t: 'SPLIT_ARMY';
    armyId: string;
    units: UnitCounts;
    toTerritoryId?: string;
} | {
    t: 'SET_STANCE';
    armyId: string;
    stance: Stance;
} | {
    t: 'START_RESEARCH';
    techId: string;
} | {
    t: 'SPEND_SKILL';
    branch: SkillBranch;
} | {
    t: 'SET_APPEARANCE';
    appearance: Partial<LeaderAppearance>;
} | {
    t: 'PROPOSE_ALLY';
    targetPlayerId: string;
} | {
    t: 'ACCEPT_ALLY';
    targetPlayerId: string;
} | {
    t: 'DECLINE_ALLY';
    targetPlayerId: string;
} | {
    t: 'BREAK_ALLY';
    targetPlayerId: string;
} | {
    t: 'TRADE_OFFER';
    targetPlayerId: string;
    give: ResourceDelta;
    want: ResourceDelta;
} | {
    t: 'TRADE_ACCEPT';
    offerId: string;
} | {
    t: 'TRADE_DECLINE';
    offerId: string;
} | {
    t: 'PING_MAP';
    territoryId: string;
    kind: PingKind;
} | {
    t: 'CHAT';
    channel: 'all' | 'team';
    text: string;
};
export type CommandType = Command['t'];
export interface CommandResult {
    ok: boolean;
    /** Machine-readable reason, safe to map to a localized string in the UI. */
    reason?: string;
    /** Human-readable fallback, useful during development. */
    message?: string;
}
/** Cost of a command, before it is charged. Also used by the UI to grey out buttons. */
export declare function commandCost(state: MatchState, cmd: Command): ResourceDelta;
/**
 * Pure validation — never mutates. The server calls this before applying, and the
 * client calls the same function to disable impossible actions in the UI.
 */
export declare function validateCommand(state: MatchState, playerId: string, cmd: Command): CommandResult;
/**
 * Applies a command. MUST be preceded by `validateCommand` — `applyCommand` re-validates
 * anyway, so a caller that forgets cannot corrupt the match.
 */
export declare function applyCommand(state: MatchState, playerId: string, cmd: Command): CommandResult;
/**
 * Token bucket, one per connection. Lives here (not in the server) so any transport —
 * WebSocket now, anything later — gets the same protection.
 */
export declare class RateLimiter {
    private readonly capacity;
    private readonly refillPerSecond;
    private tokens;
    private lastRefillMs;
    constructor(capacity?: number, refillPerSecond?: number);
    /** `nowMs` is passed in — the sim package never reads the clock itself. */
    allow(nowMs: number): boolean;
}
//# sourceMappingURL=commands.d.ts.map