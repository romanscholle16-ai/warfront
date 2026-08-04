import type { Leader, MatchState } from '@warfront/shared';
/**
 * Persistence (M9/M12 groundwork).
 *
 * Uses Node's built-in `node:sqlite` — no native compilation, no dependency, no setup.
 * That matters: the point of the LAN-first design is that a friend can clone this and
 * run it, and a node-gyp build failure is exactly the kind of friction that stops that.
 *
 * Everything here is behind the `Storage` interface, so swapping SQLite for the
 * Supabase Postgres described in docs/04-database-design.md is one new class.
 */
export interface PlayerProfile {
    id: string;
    displayName: string;
    leader: Leader;
    matchesPlayed: number;
    matchesWon: number;
}
export interface MatchResultRow {
    playerId: string;
    placement: number;
    territories: number;
    xpEarned: number;
    won: boolean;
}
export interface Storage {
    loadProfile(deviceId: string, fallbackName: string): PlayerProfile;
    saveLeader(deviceId: string, leader: Leader): void;
    recordMatch(matchId: string, code: string, mode: string, results: MatchResultRow[]): void;
    close(): void;
}
export declare class SqliteStorage implements Storage {
    private readonly db;
    constructor(file: string);
    loadProfile(deviceId: string, fallbackName: string): PlayerProfile;
    saveLeader(deviceId: string, leader: Leader): void;
    private writeLeader;
    recordMatch(matchId: string, code: string, mode: string, results: MatchResultRow[]): void;
    close(): void;
}
/** Used when persistence is disabled — every method is a no-op, nothing else changes. */
export declare class MemoryStorage implements Storage {
    private profiles;
    loadProfile(deviceId: string, fallbackName: string): PlayerProfile;
    saveLeader(deviceId: string, leader: Leader): void;
    recordMatch(): void;
    close(): void;
}
/** Ranks players by territories held, so the match record has a real placement. */
export declare function buildResults(state: MatchState, deviceIds: Map<string, string>): MatchResultRow[];
export declare function getStorage(): Storage;
//# sourceMappingURL=storage.d.ts.map