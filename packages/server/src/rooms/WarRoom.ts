// Colyseus 0.15 ships CommonJS only, so under Node ESM its named exports are not
// statically detectable. Importing the default (= module.exports) is the supported
// interop path and keeps the rest of the codebase on plain ESM.
import colyseus from 'colyseus';
import type { Client } from 'colyseus';

const { Room } = colyseus;
import {
  RECONNECT_WINDOW_SECONDS, RateLimiter, TICK_MS,
  addPlayer, addEvent, applyCommand, createMatch, getSuggestions, removePlayer,
  refreshModifiers, serializeMatch, startMatch, tick as simTick,
} from '@warfront/shared';
import type { Command, GameEvent, GameMode, LeaderClass, MatchState } from '@warfront/shared';
import { MatchS, syncMatch } from './schema.js';
import { buildResults, getStorage } from '../storage.js';

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
export class WarRoom extends Room<MatchS> {
  override maxClients = 10;

  private sim!: MatchState;
  private ready = new Map<string, boolean>();
  private limiters = new Map<string, RateLimiter>();
  private hostId = '';
  private lastBroadcastEventTick = 0;
  private endedAnnounced = false;
  /** sessionId → deviceId, so leader progress lands on the right persistent profile. */
  private deviceIds = new Map<string, string>();
  private storage = getStorage();
  /** Wall-clock is read here and only here — the simulation never touches a clock. */
  private now = () => Date.now();

  override onCreate(options: JoinOptions): void {
    const code = (options.code ?? this.roomId).toUpperCase().slice(0, 6);

    this.sim = createMatch(this.roomId, code, {
      mode: options.mode ?? 'casual',
      speed: clamp(options.speed ?? 1, 0.5, 4),
    });

    this.setState(new MatchS());
    this.setMetadata({ code, mode: this.sim.config.mode, phase: 'lobby', players: 0 });

    this.onMessage('cmd', (client, payload: Command) => this.handleCommand(client, payload));
    this.onMessage('ready', (client, value: boolean) => {
      this.ready.set(client.sessionId, Boolean(value));
    });
    this.onMessage('start', (client) => this.handleStart(client));
    this.onMessage('pause', (client) => this.handlePause(client, true));
    this.onMessage('resume', (client) => this.handlePause(client, false));
    this.onMessage('leader', (client, payload: { name?: string; leaderClass?: LeaderClass }) => {
      this.handleLeaderUpdate(client, payload);
    });
    this.onMessage('advice', (client) => {
      // Suggestions are computed on demand, per requester — they are per-player and
      // would be wasteful to put in the shared state.
      client.send('advice', getSuggestions(this.sim, client.sessionId, 3));
    });

    this.setSimulationInterval(() => this.step(), TICK_MS);
    syncMatch(this.sim, this.state, this.ready, this.hostId);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const name = sanitizeName(options.name) || `Commander ${this.clients.length}`;
    const deviceId = sanitizeDeviceId(options.deviceId) || `anon-${client.sessionId}`;
    this.deviceIds.set(client.sessionId, deviceId);

    const player = addPlayer(this.sim, client.sessionId, name);

    // Bring the player's persistent leader into the match: level, XP, spent skill
    // points and cosmetics all carry over from previous games.
    const profile = this.storage.loadProfile(deviceId, name);
    player.leader = { ...profile.leader, name, class: options.leaderClass ?? profile.leader.class };
    refreshModifiers(player); // class + skills change the cached modifier block

    if (!this.hostId) this.hostId = client.sessionId;
    this.ready.set(client.sessionId, false);
    this.limiters.set(client.sessionId, new RateLimiter());

    this.setMetadata({ players: this.clients.length, phase: this.sim.phase });
    addEvent(this.sim, 'player_reconnected', client.sessionId, `${name} joined the lobby.`);
    syncMatch(this.sim, this.state, this.ready, this.hostId);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.sim.players[client.sessionId];
    if (!player) return;

    // In the lobby a leaver is simply gone. Mid-match the seat is held.
    if (this.sim.phase === 'lobby' || consented) {
      removePlayer(this.sim, client.sessionId);
      this.ready.delete(client.sessionId);
      this.limiters.delete(client.sessionId);
      if (this.hostId === client.sessionId) this.hostId = this.clients[0]?.sessionId ?? '';
      syncMatch(this.sim, this.state, this.ready, this.hostId);
      return;
    }

    player.connected = false;
    // A caretaker holds the line: it defends and spends nothing, so a disconnect is
    // never an advantage and never an instant loss.
    player.ai = true;
    addEvent(this.sim, 'player_disconnected', client.sessionId,
      `${player.name} has lost contact. Their forces hold position.`);

    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
      player.connected = true;
      player.ai = false;
      addEvent(this.sim, 'player_reconnected', client.sessionId, `${player.name} is back in command.`);
    } catch {
      // Window expired — the nation stays under AI control for the rest of the match.
      addEvent(this.sim, 'player_disconnected', client.sessionId,
        `${player.name} has abandoned the war. Their nation is now AI-controlled.`);
    }
  }

  override onDispose(): void {
    // Hook for Phase 3 persistence: a paused or persistent match is written here.
    if (this.sim.phase === 'playing' || this.sim.phase === 'paused') {
      const blob = serializeMatch(this.sim);
      console.log(`[room ${this.roomId}] disposing mid-match, snapshot ${blob.length} bytes`);
    }
  }

  // ── loop ─────────────────────────────────────────────────────────────────

  private step(): void {
    if (this.sim.phase === 'playing') {
      simTick(this.sim);
      this.runCaretakers();
    }
    syncMatch(this.sim, this.state, this.ready, this.hostId);
    this.flushEvents();

    if (this.sim.phase === 'ended' && !this.endedAnnounced) {
      this.endedAnnounced = true;
      this.persistResults();
      this.broadcast('match_over', {
        winnerTeam: this.sim.winnerTeam,
        results: Object.values(this.sim.players).map((p) => ({
          id: p.id,
          name: p.name,
          team: p.team,
          xp: Math.round(p.matchXp),
          level: p.leader.level,
          skillPoints: p.leader.skillPoints,
        })),
      });
      this.setMetadata({ phase: 'ended' });
      // Give clients time to render the result screen before tearing the room down.
      this.clock.setTimeout(() => this.disconnect(), 20000);
    }
  }

  /**
   * Writes leader progress and the match record. XP was already committed into each
   * leader by the simulation when the match ended, so this only persists the result.
   */
  private persistResults(): void {
    try {
      for (const player of Object.values(this.sim.players)) {
        const deviceId = this.deviceIds.get(player.id);
        if (deviceId) this.storage.saveLeader(deviceId, player.leader);
      }
      this.storage.recordMatch(
        this.sim.id,
        this.sim.code,
        this.sim.config.mode,
        buildResults(this.sim, this.deviceIds),
      );
    } catch (error) {
      // Never let a storage failure take down a finished match.
      console.warn(`[room ${this.roomId}] could not persist results:`, (error as Error).message);
    }
  }

  /**
   * Disconnected players are held by a deliberately passive AI: it never attacks and
   * never spends, so being disconnected is a disadvantage but not a free win for
   * anyone else. A real opponent AI (Phase 2) will use the same advisor commands.
   */
  private runCaretakers(): void {
    if (this.sim.tick % 25 !== 0) return; // every 5 seconds is plenty
    for (const player of Object.values(this.sim.players)) {
      if (!player.ai || player.eliminatedAtTick !== null) continue;
      for (const suggestion of getSuggestions(this.sim, player.id, 3)) {
        if (suggestion.kind !== 'defend' && suggestion.kind !== 'train') continue;
        if (suggestion.command) applyCommand(this.sim, player.id, suggestion.command);
      }
    }
  }

  private flushEvents(): void {
    const fresh: GameEvent[] = this.sim.events.filter((e) => e.tick > this.lastBroadcastEventTick);
    if (fresh.length === 0) return;
    this.lastBroadcastEventTick = this.sim.tick;

    // Player-scoped events go only to that player; the rest are global.
    const global: GameEvent[] = [];
    for (const event of fresh) {
      if (event.playerId) {
        const client = this.clients.find((c) => c.sessionId === event.playerId);
        if (client) client.send('event', event);
        else global.push(event);
      } else {
        global.push(event);
      }
    }
    if (global.length) this.broadcast('events', global);
  }

  // ── message handlers ─────────────────────────────────────────────────────

  private handleCommand(client: Client, cmd: Command): void {
    const limiter = this.limiters.get(client.sessionId);
    if (limiter && !limiter.allow(this.now())) {
      client.send('reject', { reason: 'rate_limited' });
      return;
    }
    if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') {
      client.send('reject', { reason: 'malformed' });
      return;
    }

    const result = applyCommand(this.sim, client.sessionId, cmd);
    if (!result.ok) {
      client.send('reject', { reason: result.reason, message: result.message, command: cmd.t });
      return;
    }

    // Leader identity belongs to the profile rather than the match. Save changes as
    // soon as they are accepted so cosmetics and earned skills survive a voluntary
    // leave or a server restart before the match reaches its victory screen.
    if (cmd.t === 'SET_APPEARANCE' || cmd.t === 'SPEND_SKILL') {
      this.persistLeader(client.sessionId);
    }
  }

  private handleStart(client: Client): void {
    if (client.sessionId !== this.hostId) {
      client.send('reject', { reason: 'not_host' });
      return;
    }
    if (this.sim.phase !== 'lobby') return;
    if (this.sim.playerOrder.length < 1) return;

    startMatch(this.sim);
    this.setMetadata({ phase: 'playing' });
    // Lock the room so a late joiner can't appear inside a running match.
    this.lock();
    syncMatch(this.sim, this.state, this.ready, this.hostId);
  }

  private handlePause(client: Client, paused: boolean): void {
    if (!this.sim.config.allowPause) return;
    if (client.sessionId !== this.hostId) {
      client.send('reject', { reason: 'not_host' });
      return;
    }
    if (paused && this.sim.phase === 'playing') this.sim.phase = 'paused';
    else if (!paused && this.sim.phase === 'paused') this.sim.phase = 'playing';
  }

  private handleLeaderUpdate(client: Client, payload: { name?: string; leaderClass?: LeaderClass }): void {
    if (this.sim.phase !== 'lobby') return;
    const player = this.sim.players[client.sessionId];
    if (!player) return;
    const name = sanitizeName(payload.name);
    if (name) {
      player.name = name;
      player.leader.name = name;
    }
    if (payload.leaderClass) player.leader.class = payload.leaderClass;
    refreshModifiers(player);
    this.persistLeader(client.sessionId);
    syncMatch(this.sim, this.state, this.ready, this.hostId);
  }

  private persistLeader(sessionId: string): void {
    const player = this.sim.players[sessionId];
    const deviceId = this.deviceIds.get(sessionId);
    if (!player || !deviceId) return;
    try {
      this.storage.saveLeader(deviceId, player.leader);
    } catch (error) {
      // Progress is important but a locked/corrupt database must never drop a player.
      console.warn(`[room ${this.roomId}] could not save leader:`, (error as Error).message);
    }
  }
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20);
}

/** Device ids are used as database keys, so they are strictly constrained. */
function sanitizeDeviceId(deviceId: unknown): string {
  if (typeof deviceId !== 'string') return '';
  return deviceId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
