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
    /** Host's chosen starting territory id. */
    startTerritory?: string;
    /** AI difficulty when mode is 'solo_ai'. */
    aiDifficulty?: 'easy' | 'medium' | 'hard';
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
    /** sessionId → chosen starting territory. */
    private pendingStarts;
    /** Commands queued during the current turn-based planning phase. */
    private queuedCommands;
    private storage;
    /** Wall-clock is read here and only here — the simulation never touches a clock. */
    private now;
    onCreate(options: JoinOptions): void;
    onJoin(client: Client, options?: JoinOptions): void;
    onLeave(client: Client, consented: boolean): Promise<void>;
    onDispose(): void;
    private step;
    private stepTurnBased;
    private advanceTurn;
    private resolveTurn;
    private handleEndTurn;
    /**
     * Writes leader progress and the match record. XP was already committed into each
     * leader by the simulation when the match ended, so this only persists the result.
     */
    private persistResults;
    /**
     * Rule-based AI opponent.
     *
     * Every 5 seconds the AI evaluates its situation and issues commands directly
     * against the simulation — no advisor dependency. Each difficulty tier follows
     * stricter strategic rules.
     */
    private runCaretakers;
    /** Passive AI for disconnected players: train when possible, defend borders. */
    private aiDefendAndTrain;
    /** Full AI for solo mode — fast, aggressive, covers the entire game lifecycle. */
    private aiAct;
    private aiAttack;
    private aiStances;
    private aiResearch;
    private aiSpendSkill;
    private aiTrain;
    private aiBuild;
    private flushEvents;
    private handleCommand;
    private handleStart;
    private handleSaveGame;
    private handleLoadGame;
    private handleListSaves;
    private handlePause;
    private handleLeaderUpdate;
    private persistLeader;
}
export {};
//# sourceMappingURL=WarRoom.d.ts.map