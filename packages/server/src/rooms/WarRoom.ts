// Colyseus 0.15 ships CommonJS only, so under Node ESM its named exports are not
// statically detectable. Importing the default (= module.exports) is the supported
// interop path and keeps the rest of the codebase on plain ESM.
import colyseus from 'colyseus';
import type { Client } from 'colyseus';

const { Room } = colyseus;
import {
  ADJACENCY, BUILDINGS, MAX_SKILL_POINTS_PER_BRANCH, RECONNECT_WINDOW_SECONDS,
  RESOURCE_KEYS, TERRITORY_DEFS, UNITS, RateLimiter, TICK_MS,
  addPlayer, addEvent, applyCommand, availableTechs, buildingCost, canAfford,
  createMatch, deserializeMatch, getSuggestions, moveBlocker, removePlayer,
  refreshModifiers, serializeMatch, startMatch, validateCommand, tick as simTick,
} from '@warfront/shared';
import type {
  Army, BuildingType, Command, GameEvent, GameMode, LeaderClass, MatchState,
  Player, ResourceDelta, SkillBranch, UnitCounts, UnitType,
} from '@warfront/shared';
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
  /** sessionId → chosen starting territory. */
  private pendingStarts = new Map<string, string>();
  /** Commands queued during the current turn-based planning phase. */
  private queuedCommands: Command[] = [];
  private storage = getStorage();
  /** Wall-clock is read here and only here — the simulation never touches a clock. */
  private now = () => Date.now();

  override onCreate(options: JoinOptions): void {
    const code = (options.code ?? this.roomId).toUpperCase().slice(0, 6);
    const mode = options.mode ?? 'casual';

    this.sim = createMatch(this.roomId, code, {
      mode,
      speed: clamp(options.speed ?? 1, 0.5, 4),
      aiDifficulty: options.aiDifficulty,
      maxPlayers: modeMaxPlayers(mode),
    });
    // Enforce player cap at room level.
    if (modeMaxPlayers(mode) > 0) this.maxClients = modeMaxPlayers(mode);

    this.setState(new MatchS());
    this.setMetadata({ code, mode: this.sim.config.mode, phase: 'lobby', players: 0 });

    this.onMessage('cmd', (client, payload: Command) => this.handleCommand(client, payload));
    this.onMessage('ready', (client, value: boolean) => {
      this.ready.set(client.sessionId, Boolean(value));
    });
    this.onMessage('start', (client) => this.handleStart(client));
    this.onMessage('end_turn', (client) => this.handleEndTurn(client));
    this.onMessage('flush_queue', (client) => this.handleFlushQueue(client));
    this.onMessage('pause', (client) => this.handlePause(client, true));
    this.onMessage('resume', (client) => this.handlePause(client, false));
    this.onMessage('leader', (client, payload: { name?: string; leaderClass?: LeaderClass }) => {
      this.handleLeaderUpdate(client, payload);
    });
    this.onMessage('advice', (client) => {
      client.send('advice', getSuggestions(this.sim, client.sessionId, 3));
    });
    this.onMessage('start_territory', (client, payload: { territoryId: string }) => {
      if (typeof payload?.territoryId === 'string') {
        this.pendingStarts.set(client.sessionId, payload.territoryId);
      }
    });
    this.onMessage('save_game', (client) => this.handleSaveGame(client));
    this.onMessage('load_game', (client, payload: { saveId: string }) => this.handleLoadGame(client, payload));
    this.onMessage('list_saves', (client) => this.handleListSaves(client));

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
    if (this.sim.phase !== 'playing') {
      syncMatch(this.sim, this.state, this.ready, this.hostId);
      return;
    }

    // Turn-based: advance timer, check turn end.
    if (this.sim.turnOrder.length > 0) {
      this.stepTurnBased();
      syncMatch(this.sim, this.state, this.ready, this.hostId);
      this.flushEvents();
      return;
    }

    // Real-time: normal simulation tick.
    simTick(this.sim);
    this.runCaretakers();
    syncMatch(this.sim, this.state, this.ready, this.hostId);
    this.flushEvents();

    if ((this.sim.phase as string) === 'ended' && !this.endedAnnounced) {
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
      this.clock.setTimeout(() => this.disconnect(), 20000);
    }
  }

  // ── turn-based loop ───────────────────────────────────────────────────────

  private stepTurnBased(): void {
    if (!this.sim.turnPlayer) {
      // First turn: initialise.
      this.advanceTurn();
      return;
    }

    // Count down the timer.
    this.sim.turnSecondsRemaining = Math.max(0, this.sim.turnSecondsRemaining - TICK_MS / 1000);

    // Check for turn end (timer expired or player eliminated).
    const player = this.sim.players[this.sim.turnPlayer];
    if (this.sim.turnSecondsRemaining <= 0 || !player || player.eliminatedAtTick !== null) {
      this.resolveTurn();
    }
  }

  private advanceTurn(): void {
    const active = this.sim.turnOrder.filter((id) => {
      const p = this.sim.players[id];
      return p && p.eliminatedAtTick === null;
    });
    if (active.length === 0) return;

    // Pick next player (cyclically).
    const currentIdx = active.indexOf(this.sim.turnPlayer ?? '');
    const nextIdx = (currentIdx + 1) % active.length;
    const nextId = active[nextIdx]!;

    this.sim.turnNumber++;
    this.sim.turnPlayer = nextId;
    this.sim.turnSecondsRemaining = this.sim.config.turnDurationSeconds;
    this.sim.turnPhase = 'planning';
    this.queuedCommands = [];

    const player = this.sim.players[nextId];
    addEvent(this.sim, 'chat', nextId,
      `Turn ${this.sim.turnNumber}: ${player?.name ?? 'Someone'}'s planning phase.`);
  }

  private resolveTurn(): void {
    this.sim.turnPhase = 'resolving';

    // Apply any remaining queued commands.
    for (const cmd of this.queuedCommands) {
      applyCommand(this.sim, this.sim.turnPlayer!, cmd);
    }
    this.queuedCommands = [];

    // Run simulation for the remainder of the turn (travel, building, economy).
    // Use fewer ticks if the player already flushed mid-turn.
    const remainingTicks = Math.round(this.sim.turnSecondsRemaining * 5);
    const burstTicks = Math.max(10, remainingTicks);
    for (let i = 0; i < burstTicks; i++) {
      this.sim.tick++;
      simTick(this.sim);
    }

    this.advanceTurn();
  }

  /**
   * Flush queued commands and run simulation ticks to resolve battles.
   * Called when the player clicks "Attack" during their turn.
   * After flushing, the player enters post_attack phase where they can
   * move troops and attack again, or end their turn.
   */
  private handleFlushQueue(client: Client): void {
    if (this.sim.turnOrder.length === 0) return;
    if (client.sessionId !== this.sim.turnPlayer) return;
    if (this.sim.turnPhase !== 'planning' && this.sim.turnPhase !== 'post_attack') return;

    // Apply all queued commands.
    for (const cmd of this.queuedCommands) {
      applyCommand(this.sim, this.sim.turnPlayer!, cmd);
    }
    this.queuedCommands = [];

    // Run simulation ticks to resolve battles. Run enough ticks for armies
    // to travel adjacent territories and battles to conclude.
    // 50 ticks = 10 seconds of combat at 5Hz, enough for most fights.
    const flushTicks = 50;
    for (let i = 0; i < flushTicks; i++) {
      this.sim.tick++;
      simTick(this.sim);
    }

    // Player can now move troops or attack again.
    this.sim.turnPhase = 'post_attack';
    addEvent(this.sim, 'chat', this.sim.turnPlayer,
      'Battles resolved. You may move troops and attack again, or end your turn.');
  }

  private handleEndTurn(client: Client): void {
    if (this.sim.turnOrder.length === 0) return;
    if (client.sessionId !== this.sim.turnPlayer) return;
    if (this.sim.turnPhase !== 'planning' && this.sim.turnPhase !== 'post_attack') return;
    this.resolveTurn();
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
   * Rule-based AI opponent.
   *
   * Every 5 seconds the AI evaluates its situation and issues commands directly
   * against the simulation — no advisor dependency. Each difficulty tier follows
   * stricter strategic rules.
   */
  private runCaretakers(): void {
    if (this.sim.tick % 25 !== 0) return;
    const difficulty = this.sim.config.aiDifficulty ?? 'medium';

    for (const player of Object.values(this.sim.players)) {
      if (!player.ai || player.eliminatedAtTick !== null) continue;

      // Disconnected players: passive defender — only train and defend.
      if (this.sim.config.mode !== 'solo_ai') {
        this.aiDefendAndTrain(player);
        continue;
      }

      // Solo AI opponent with difficulty rules.
      this.aiAct(player, difficulty);
    }
  }

  /** Passive AI for disconnected players: train when possible, defend borders. */
  private aiDefendAndTrain(player: Player): void {
    // Train infantry in every owned territory that has a barracks.
    for (const territory of Object.values(this.sim.territories)) {
      if (territory.ownerId !== player.id) continue;
      const hasBarracks = territory.buildings.some((b) => b.type === 'barracks' && b.level > 0);
      if (!hasBarracks) continue;
      // Only train if we can afford it and have population.
      if (player.resources.money >= 100 && player.resources.food >= 50 && territory.pop >= 3) {
        applyCommand(this.sim, player.id, {
          t: 'TRAIN', territoryId: territory.id, unit: 'rifle', count: 3,
        });
      }
    }
  }

  /** Full AI for solo mode — fast, aggressive, covers the entire game lifecycle. */
  private aiAct(player: Player, difficulty: string): void {
    const rules: AIDifficultyRules = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES.medium!;

    const before = { money: player.resources.money, food: player.resources.food, territoryCount: 0 };
    for (const t of Object.values(this.sim.territories)) { if (t.ownerId === player.id) before.territoryCount++; }

    this.aiAttack(player, rules);
    this.aiTrain(player, rules);
    this.aiBuild(player, rules);
    this.aiResearch(player, rules);
    this.aiSpendSkill(player);
    this.aiStances(player);

    console.log(`[AI ${difficulty}] ${player.name} | territories=${before.territoryCount} | money=${before.money.toFixed(0)} | tick=${this.sim.tick}`);
  }

  // ── attack: always press enemies, route through own territory, split stacks ─

  private aiAttack(player: Player, rules: AIDifficultyRules): void {
    const alwaysAttack = rules.aggression >= 1.0;
    const attackEnemies = alwaysAttack || Math.random() < rules.aggression;

    // Build a set of territories this player owns for fast lookups.
    const owned = new Set<string>();
    for (const t of Object.values(this.sim.territories)) {
      if (t.ownerId === player.id) owned.add(t.id);
    }

    // Track targets that already have armies en route.
    const targeted = new Set<string>();
    for (const army of Object.values(this.sim.armies)) {
      if (army.ownerId === player.id && army.movingTo) targeted.add(army.movingTo);
    }

    for (const army of Object.values(this.sim.armies)) {
      if (army.ownerId !== player.id || army.movingTo) continue;
      const territory = this.sim.territories[army.at];
      if (territory && territory.captureProgress > 0 && territory.captureBy === player.id) continue;

      let total = 0;
      for (const n of Object.values(army.units)) total += n ?? 0;
      if (total < rules.minAttackForce) continue;

      // Split large armies: detach half to attack a second target.
      if (total >= rules.minAttackForce * 2 && rules.splitArmies) {
        const splitUnits: UnitCounts = {};
        for (const [unitId, count] of Object.entries(army.units)) {
          const half = Math.floor((count ?? 0) / 2);
          if (half > 0) splitUnits[unitId as UnitType] = half;
        }
        applyCommand(this.sim, player.id, {
          t: 'SPLIT_ARMY', armyId: army.id, units: splitUnits,
        });
      }

      // When the army is mixed land+sea and blocked from land neighbours,
      // detach the sea-capable units so they can cross on their own.
      if (moveBlocker(this.sim, army, (ADJACENCY[army.at] ?? [])[0]?.to ?? '')) {
        const seaUnits: UnitCounts = {};
        let hasSea = false;
        for (const [unitId, count] of Object.entries(army.units)) {
          if (!count) continue;
          const unit = UNITS[unitId as UnitType];
          if (unit && (unit.domain === 'sea' || unitId === 'marine')) {
            seaUnits[unitId as UnitType] = count;
            hasSea = true;
          }
        }
        if (hasSea && Object.keys(seaUnits).length > 0) {
          applyCommand(this.sim, player.id, {
            t: 'SPLIT_ARMY', armyId: army.id, units: seaUnits,
          });
          console.log(`[AI] ${player.name} detached naval force from ${army.at}`);
        }
      }

      const neighbours = (ADJACENCY[army.at] ?? []).map((l) => l.to);
      shuffle(neighbours);

      // Find the best target: enemy > neutral. Try direct neighbours first.
      let bestTarget: string | null = null;
      for (const n of neighbours) {
        if (targeted.has(n)) continue;
        if (moveBlocker(this.sim, army, n)) continue;
        const t = this.sim.territories[n];
        if (!t) continue;
        if (t.ownerId === player.id) continue;
        // Enemy territory — highest priority if aggression allows.
        if (t.ownerId && attackEnemies) { bestTarget = n; break; }
        // Neutral territory — fallback.
        if (!t.ownerId && !bestTarget) bestTarget = n;
      }

      // If no direct reachable target, try routing through own territory.
      // Walk the ownership graph to find a path to an enemy border.
      if (!bestTarget && attackEnemies) {
        bestTarget = this.findReachableEnemy(player.id, army, owned, targeted);
      }

      if (bestTarget) {
        applyCommand(this.sim, player.id, {
          t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: bestTarget,
        });
        console.log(`[AI] ${player.name} attacking ${bestTarget} with ${total} units from ${army.at}`);
        targeted.add(bestTarget);
      }
    }
  }

  /**
   * BFS through the player's own territory to find an enemy/neutral border
   * that this army can reach. This is how the AI breaks out of a sea-locked
   * region: march the army through owned land to a coastal territory with
   * marines or ships, then cross.
   */
  private findReachableEnemy(
    playerId: string,
    army: Army,
    owned: Set<string>,
    targeted: Set<string>,
  ): string | null {
    // BFS queue: [territoryId]
    const visited = new Set<string>([army.at]);
    const queue = [army.at];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const links = ADJACENCY[current] ?? [];
      shuffle(links.map((l) => l.to));

      for (const link of links) {
        const next = link.to;
        if (visited.has(next)) continue;
        visited.add(next);

        const t = this.sim.territories[next];
        if (!t) continue;

        // Enemy or neutral territory — this is where we want to go.
        if (t.ownerId !== playerId && !targeted.has(next)) {
          // But we can only attack if there's a legal path from the army to this tile.
          // The first hop from army.at must be passable — subsequent hops through
          // owned land are always legal.
          if (current === army.at) {
            // Direct neighbour — already checked in the main loop.
            return next;
          }
          // This is a border tile reachable via owned territory.
          // The army first moves to the adjacent owned tile, then the server's
          // waypoint system will route it the rest of the way.
          return this.firstHopToward(army, next);
        }

        // Own territory — continue the search.
        if (t.ownerId === playerId) {
          queue.push(next);
        }
      }
    }

    return null;
  }

  /**
   * Find the first legal hop from the army toward the target.
   * Only returns a hop the army can actually traverse (respects moveBlocker).
   */
  private firstHopToward(army: Army, targetId: string): string | null {
    // Try each passable neighbour — BFS from there through owned territory.
    for (const link of ADJACENCY[army.at] ?? []) {
      const firstHop = link.to;
      if (moveBlocker(this.sim, army, firstHop)) continue;

      // BFS from firstHop to targetId, walking through any territory.
      const visited = new Set<string>([army.at, firstHop]);
      const queue = [firstHop];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === targetId) return firstHop;
        for (const nextLink of ADJACENCY[current] ?? []) {
          const next = nextLink.to;
          if (visited.has(next)) continue;
          visited.add(next);
          if (this.sim.territories[next]) queue.push(next);
        }
      }
    }
    return null;
  }

  // ── stances: aggressive for attackers, hold for border garrisons ───────

  private aiStances(player: Player): void {
    for (const army of Object.values(this.sim.armies)) {
      if (army.ownerId !== player.id || army.movingTo) continue;
      // Aggressive stance for armies about to attack.
      if (army.stance !== 'aggressive') {
        applyCommand(this.sim, player.id, {
          t: 'SET_STANCE', armyId: army.id, stance: 'aggressive',
        });
      }
    }
  }

  // ── research: class-biased, not random ─────────────────────────────────

  private aiResearch(player: Player, rules: AIDifficultyRules): void {
    if (player.research) return;
    const available = availableTechs(player.tech);
    if (available.length === 0) return;

    const affordable = available.filter((t) => player.resources.research >= t.costResearch);
    if (affordable.length === 0) return;
    if (player.resources.money < rules.researchReserve) return;

    // Prioritise tech trees that match the leader class.
    const classPref: Record<string, string[]> = {
      military: ['military', 'technology'],
      economic: ['economy', 'infrastructure'],
      scientific: ['technology', 'infrastructure'],
      diplomatic: ['economy', 'infrastructure'],
    };
    const prefs = classPref[player.leader.class] ?? ['military', 'economy'];

    // Score techs: preferred tree = 2, others = 1, then pick highest.
    const scored = affordable.map((t) => ({
      tech: t,
      score: prefs.includes(t.tree) ? 2 : 1,
    }));
    scored.sort((a, b) => b.score - a.score);
    const topScore = scored[0]!.score;
    const topTier = scored.filter((s) => s.score === topScore);
    const pick = topTier[Math.floor(Math.random() * topTier.length)]!;

    applyCommand(this.sim, player.id, { t: 'START_RESEARCH', techId: pick.tech.id });
  }

  // ── skills: spend all points, class-biased ─────────────────────────────

  private aiSpendSkill(player: Player): void {
    while (player.leader.skillPoints > 0) {
      const classOrder: Record<string, SkillBranch[]> = {
        military: ['warfare', 'economy', 'intelligence'],
        economic: ['economy', 'intelligence', 'warfare'],
        scientific: ['intelligence', 'economy', 'warfare'],
        diplomatic: ['economy', 'intelligence', 'warfare'],
      };
      const order = classOrder[player.leader.class] ?? ['warfare', 'economy', 'intelligence'];

      let spent = false;
      for (const branch of order) {
        if (player.leader.skills[branch] < MAX_SKILL_POINTS_PER_BRANCH) {
          applyCommand(this.sim, player.id, { t: 'SPEND_SKILL', branch });
          spent = true;
          break;
        }
      }
      if (!spent) break;
    }
  }

  // ── train: prioritise sea-crossing units when locked in, heavy on vehicles ─

  private aiTrain(player: Player, rules: AIDifficultyRules): void {
    if (player.resources.money < rules.trainReserve) return;
    const seaLocked = this.isSeaLocked(player.id);

    const factories: Array<{ tid: string; units: UnitType[] }> = [];
    for (const territory of Object.values(this.sim.territories)) {
      if (territory.ownerId !== player.id || territory.pop < 2) continue;
      const units: UnitType[] = [];
      if (territory.buildings.some((b) => b.type === 'barracks' && b.level > 0)) {
        units.push('rifle');
        if (territory.buildings.some((b) => b.type === 'barracks' && b.level >= 3)) units.push('marine');
      }
      if (territory.buildings.some((b) => b.type === 'academy' && b.level > 0)) units.push('special_forces');
      if (territory.buildings.some((b) => b.type === 'vehicle_plant' && b.level > 0)) {
        units.push('apc');
        if (territory.buildings.some((b) => b.type === 'vehicle_plant' && b.level >= 3)) units.push('tank');
      }
      if (territory.buildings.some((b) => b.type === 'airbase' && b.level > 0)) {
        units.push('helicopter');
        if (territory.buildings.some((b) => b.type === 'airbase' && b.level >= 3)) units.push('fighter');
        if (territory.buildings.some((b) => b.type === 'airbase' && b.level >= 5)) units.push('bomber');
      }
      if (territory.buildings.some((b) => b.type === 'naval_base' && b.level > 0)) {
        units.push('destroyer');
        if (territory.buildings.some((b) => b.type === 'naval_base' && b.level >= 4)) units.push('submarine');
        if (territory.buildings.some((b) => b.type === 'naval_base' && b.level >= 7)) units.push('carrier');
      }
      if (units.length > 0) factories.push({ tid: territory.id, units });
    }
    shuffle(factories);

    let trained = 0;
    for (const { tid, units } of factories) {
      if (trained >= rules.trainBatches) break;
      const territory = this.sim.territories[tid]!;

      // When sea-locked, prioritise marine and naval units. Don't shuffle
      // after sorting — that would undo the priority.
      const seaUnits = units.filter((u) => u === 'marine' || UNITS[u]?.domain === 'sea');
      const otherUnits = units.filter((u) => u !== 'marine' && UNITS[u]?.domain !== 'sea');
      if (seaLocked) {
        // Sea units first, shuffle within each group for variety.
        shuffle(seaUnits);
        shuffle(otherUnits);
        units.length = 0;
        units.push(...seaUnits, ...otherUnits);
      } else {
        shuffle(units);
      }
      for (const unit of units) {
        const def = UNITS[unit];
        const maxPop = Math.floor(territory.pop / (def.manpower || 1));
        const batch = Math.min(rules.trainBatch, maxPop);
        if (batch < 1) continue;

        const cost = { ...def.cost } as ResourceDelta;
        for (const key of RESOURCE_KEYS) {
          const v = cost[key];
          if (v !== undefined) cost[key] = v * batch;
        }
        if (!canAfford(player.resources, cost)) continue;
        if (player.resources.money - (cost.money ?? 0) < rules.trainReserve) continue;
        if ((player.resources.food - (cost.food ?? 0)) < 20) continue;

        applyCommand(this.sim, player.id, { t: 'TRAIN', territoryId: tid, unit, count: batch });
        trained++;
        break;
      }
    }
  }

  // ── build: strategic — naval/barracks when sea-locked, economy to fund war ─

  private aiBuild(player: Player, rules: AIDifficultyRules): void {
    if (player.resources.money < rules.buildReserve) return;

    // Detect if this player is sea-locked: no armies can reach enemy territory
    // because all border links are sea links and they lack marines/navy.
    const seaLocked = this.isSeaLocked(player.id);

    const ownedTids: string[] = [];
    for (const territory of Object.values(this.sim.territories)) {
      if (territory.ownerId === player.id) ownedTids.push(territory.id);
    }
    // Sort coastal territories first when sea-locked.
    if (seaLocked) {
      ownedTids.sort((a, b) => {
        const aCoastal = TERRITORY_DEFS[a]?.coastal ?? false;
        const bCoastal = TERRITORY_DEFS[b]?.coastal ?? false;
        return (bCoastal ? 1 : 0) - (aCoastal ? 1 : 0);
      });
    } else {
      shuffle(ownedTids);
    }

    let built = 0;
    for (const tid of ownedTids) {
      if (built >= rules.buildBatches) break;
      const territory = this.sim.territories[tid]!;
      const slots = TERRITORY_DEFS[tid]?.slots ?? 3;
      const hasFreeSlot = territory.buildings.length < slots;
      const tdef = TERRITORY_DEFS[tid];
      const coastal = tdef?.coastal ?? false;

      // When sea-locked, prioritise naval and barracks upgrades (for marines).
      const priority: BuildingType[] = seaLocked && coastal
        ? ['naval_base', 'barracks', 'airbase', 'vehicle_plant', 'academy',
           'farm', 'commercial', 'factory', 'mine', 'power_plant',
           'research_center', 'university', 'advanced_lab']
        : ['barracks', 'vehicle_plant', 'airbase', 'naval_base', 'academy',
           'farm', 'commercial', 'factory', 'mine', 'power_plant',
           'research_center', 'university', 'advanced_lab'];

      for (const type of priority) {
        const bdef = BUILDINGS[type];
        if (bdef.requiresCoastal && !coastal) continue;
        if (bdef.requiresTerrain && tdef && !bdef.requiresTerrain.includes(tdef.terrain)) continue;

        const existing = territory.buildings.find((b) => b.type === type);
        if (!existing && !hasFreeSlot) continue;
        if (existing && existing.completesAtTick > 0) continue;
        const nextLevel = (existing?.level ?? 0) + 1;
        if (nextLevel > rules.maxBuildingLevel) continue;

        const cost = buildingCost(type, nextLevel);
        if (!canAfford(player.resources, cost)) continue;
        if (player.resources.money - (cost.money ?? 0) < rules.buildReserve) continue;

        applyCommand(this.sim, player.id, { t: 'BUILD', territoryId: tid, building: type });
        built++;
        break;
      }
    }
  }

  /** Returns true if no army of this player can reach an enemy/neutral territory directly. */
  private isSeaLocked(playerId: string): boolean {
    for (const army of Object.values(this.sim.armies)) {
      if (army.ownerId !== playerId || army.movingTo) continue;
      for (const link of ADJACENCY[army.at] ?? []) {
        const t = this.sim.territories[link.to];
        if (!t || t.ownerId === playerId) continue;
        // Check if ANY unit type in this army can traverse this link.
        for (const unitId of Object.keys(army.units) as UnitType[]) {
          if (!army.units[unitId] || army.units[unitId]! <= 0) continue;
          const probe = { ...army, units: { [unitId]: 1 } as UnitCounts };
          if (!moveBlocker(this.sim, probe, link.to)) return false;
        }
      }
    }
    return true;
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

    // Turn-based mode: queue commands during planning/post_attack, validate only.
    if (this.sim.turnOrder.length > 0) {
      if (client.sessionId !== this.sim.turnPlayer) {
        client.send('reject', { reason: 'not_your_turn' });
        return;
      }
      if (this.sim.turnPhase !== 'planning' && this.sim.turnPhase !== 'post_attack') {
        client.send('reject', { reason: 'turn_phase', message: 'Wait for your planning phase.' });
        return;
      }
      // Validate only — don't apply. Commands are applied when the queue is flushed.
      // This prevents the double-spend bug where applyCommand was called both here
      // AND during resolveTurn().
      const result = validateCommand(this.sim, client.sessionId, cmd);
      if (!result.ok) {
        client.send('reject', { reason: result.reason, message: result.message, command: cmd.t });
        return;
      }
      this.queuedCommands.push(cmd);
      return;
    }

    // Real-time mode: apply immediately.
    const result = applyCommand(this.sim, client.sessionId, cmd);
    if (!result.ok) {
      client.send('reject', { reason: result.reason, message: result.message, command: cmd.t });
      return;
    }

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

    const mode = this.sim.config.mode;

    // AI opponent for solo_ai mode.
    if (mode === 'solo_ai') {
      const aiId = `ai-${this.sim.nextEntityId}`;
      const difficulty = this.sim.config.aiDifficulty ?? 'medium';
      const aiNames: Record<string, string> = {
        easy: 'General Green',
        medium: 'Marshal Steel',
        hard: 'Supreme Commander Onyx',
      };
      addPlayer(this.sim, aiId, aiNames[difficulty] ?? 'AI Opponent', { team: 2 });
      const aiPlayer = this.sim.players[aiId];
      if (aiPlayer) {
        aiPlayer.ai = true;
        aiPlayer.connected = false;
        const diffMul: Record<string, number> = { easy: 0.7, medium: 1.0, hard: 1.4 };
        const mul = diffMul[difficulty] ?? 1;
        for (const key of RESOURCE_KEYS) aiPlayer.resources[key] *= mul;
      }
    }

    startMatch(this.sim, this.pendingStarts);

    // Speed tuning per mode.
    if (mode === 'solo_ai') {
      this.sim.config.speed = 10;
    } else if (mode === 'quick_2p') {
      this.sim.config.speed = 2; // faster travel/build for quick matches
    }

    // Turn-based setup: build a shuffled turn order, set first player.
    if (mode === 'turns_4_6') {
      this.sim.turnOrder = [...this.sim.playerOrder];
      shuffle(this.sim.turnOrder);
      this.sim.turnNumber = 0;
      this.sim.turnPlayer = null;
      this.sim.turnSecondsRemaining = 0;
      this.sim.turnPhase = null;
      this.queuedCommands = [];
      this.sim.config.victoryByConquest = true; // turn-based always total conquest
    }

    this.setMetadata({ phase: 'playing' });
    this.lock();
    syncMatch(this.sim, this.state, this.ready, this.hostId);
  }

  private handleSaveGame(client: Client): void {
    if (client.sessionId !== this.hostId) {
      client.send('reject', { reason: 'not_host' });
      return;
    }
    if (this.sim.phase === 'ended') {
      client.send('reject', { reason: 'match_ended' });
      return;
    }
    const deviceId = this.deviceIds.get(this.hostId) ?? 'unknown';
    try {
      this.storage.saveGame(
        this.sim.id,
        this.sim.code,
        deviceId,
        serializeMatch(this.sim),
      );
      client.send('event', { type: 'save_completed', text: 'Game saved.' });
    } catch (error) {
      client.send('reject', { reason: 'save_failed', message: 'Could not save the game.' });
      console.warn(`[room ${this.roomId}] save failed:`, (error as Error).message);
    }
  }

  private handleLoadGame(client: Client, payload: { saveId: string }): void {
    if (client.sessionId !== this.hostId) {
      client.send('reject', { reason: 'not_host' });
      return;
    }
    if (this.sim.phase !== 'lobby') {
      client.send('reject', { reason: 'already_started' });
      return;
    }
    const saveId = payload?.saveId;
    if (typeof saveId !== 'string' || !saveId) {
      client.send('reject', { reason: 'missing_save_id' });
      return;
    }
    const saved = this.storage.loadGame(saveId);
    if (!saved) {
      client.send('reject', { reason: 'save_not_found' });
      return;
    }
    try {
      this.sim = deserializeMatch(saved.stateJson);
      this.sim.phase = 'playing';
      this.setState(new MatchS());
      syncMatch(this.sim, this.state, this.ready, this.hostId);
      this.lock();
      this.setMetadata({ phase: 'playing' });
      addEvent(this.sim, 'match_started', null, 'Game resumed from save.');
    } catch (error) {
      client.send('reject', { reason: 'save_corrupt', message: 'Save file could not be read.' });
      console.warn(`[room ${this.roomId}] load failed:`, (error as Error).message);
    }
  }

  private handleListSaves(client: Client): void {
    if (client.sessionId !== this.hostId) {
      client.send('reject', { reason: 'not_host' });
      return;
    }
    const deviceId = this.deviceIds.get(this.hostId) ?? 'unknown';
    try {
      const saves = this.storage.listSavedGames(deviceId);
      client.send('saves_list', saves);
    } catch (error) {
      client.send('saves_list', []);
      console.warn(`[room ${this.roomId}] list saves failed:`, (error as Error).message);
    }
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

function modeMaxPlayers(mode: GameMode): number {
  switch (mode) {
    case 'solo_ai': return 1;
    case 'quick_2p': return 2;
    case 'turns_4_6': return 6;
    default: return 0; // 0 = no cap
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

/** Fisher-Yates shuffle in place so the AI picks random targets each cycle. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

// ── AI difficulty tuning ───────────────────────────────────────────────────

interface AIDifficultyRules {
  aggression: number;
  maxBuildingLevel: number;
  trainBatch: number;
  /** Max training batches per cycle. */
  trainBatches: number;
  /** Max build orders per cycle. */
  buildBatches: number;
  /** Whether to split large armies. */
  splitArmies: boolean;
  minAttackForce: number;
  /** Money buffer before building. */
  buildReserve: number;
  /** Money buffer before training. */
  trainReserve: number;
  /** Money buffer before starting research. */
  researchReserve: number;
}

const DIFFICULTY_RULES: Record<string, AIDifficultyRules> = {
  easy: {
    aggression: 0.15,
    maxBuildingLevel: 3,
    trainBatch: 3,
    trainBatches: 1,
    buildBatches: 1,
    splitArmies: false,
    minAttackForce: 12,
    buildReserve: 350,
    trainReserve: 250,
    researchReserve: 500,
  },
  medium: {
    aggression: 0.8,
    maxBuildingLevel: 5,
    trainBatch: 6,
    trainBatches: 2,
    buildBatches: 2,
    splitArmies: true,
    minAttackForce: 6,
    buildReserve: 200,
    trainReserve: 150,
    researchReserve: 250,
  },
  hard: {
    aggression: 1.0,
    maxBuildingLevel: 8,
    trainBatch: 12,
    trainBatches: 3,
    buildBatches: 2,
    splitArmies: true,
    minAttackForce: 4,
    buildReserve: 150,
    trainReserve: 100,
    researchReserve: 100,
  },
};
