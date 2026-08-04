import colyseus from 'colyseus';
import type { Client } from 'colyseus';
declare const Room: typeof colyseus.Room;
import type { GameMode, LeaderClass } from '@warfront/shared';
import { MatchS } from './schema.js';
interface JoinOptions {
    code?: string;
    name?: string;
    leaderClass?: LeaderClass;
    mode?: GameMode;
    speed?: number;
    /** Set by the creating client; the first joiner is the host regardless. */
    host?: boolean;
    /**
     * Anonymous, client-generated identity. It is the key the persistent leader is
     * stored under — no signup, no password, no personal data. Phase 3 upgrades this
     * to a real account without changing anything else.
     */
    deviceId?: string;
}
/**
 * One room = one match. This class is the ONLY place a match is mutated, and it
 * mutates it exclusively through the shared simulation. Clients send commands;
 * they never send state.
 */
export declare class WarRoom extends Room<MatchS> {
    maxClients: number;
    private sim;
    private ready;
    private limiters;
    private hostId;
    private lastBroadcastEventTick;
    private endedAnnounced;
    /** sessionId → deviceId, so leader progress lands on the right persistent profile. */
    private deviceIds;
    private storage;
    /** Wall-clock is read here and only here — the simulation never touches a clock. */
    private now;
    onCreate(options: JoinOptions): void;
    onJoin(client: Client, options?: JoinOptions): void;
    onLeave(client: Client, consented: boolean): Promise<void>;
    onDispose(): void;
    private step;
    /**
     * Writes leader progress and the match record. XP was already committed into each
     * leader by the simulation when the match ended, so this only persists the result.
     */
    private persistResults;
    /**
     * Disconnected players are held by a deliberately passive AI: it never attacks and
     * never spends, so being disconnected is a disadvantage but not a free win for
     * anyone else. A real opponent AI (Phase 2) will use the same advisor commands.
     */
    private runCaretakers;
    private flushEvents;
    private handleCommand;
    private handleStart;
    private handlePause;
    private handleLeaderUpdate;
    private persistLeader;
}
export {};
//# sourceMappingURL=WarRoom.d.ts.map