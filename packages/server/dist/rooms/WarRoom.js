// Colyseus 0.15 ships CommonJS only, so under Node ESM its named exports are not
// statically detectable. Importing the default (= module.exports) is the supported
// interop path and keeps the rest of the codebase on plain ESM.
import colyseus from 'colyseus';
const { Room } = colyseus;
import { ADJACENCY, BUILDINGS, MAX_SKILL_POINTS_PER_BRANCH, RECONNECT_WINDOW_SECONDS, RESOURCE_KEYS, TERRITORY_DEFS, UNITS, RateLimiter, TICK_MS, addPlayer, addEvent, applyCommand, availableTechs, buildingCost, canAfford, createMatch, deserializeMatch, getSuggestions, moveBlocker, removePlayer, refreshModifiers, serializeMatch, startMatch, tick as simTick, } from '@warfront/shared';
import { MatchS, syncMatch } from './schema.js';
import { buildResults, getStorage } from '../storage.js';
/**
 * One room = one match. This class is the ONLY place a match is mutated, and it
 * mutates it exclusively through the shared simulation. Clients send commands;
 * they never send state.
 */
export class WarRoom extends Room {
    constructor() {
        super(...arguments);
        this.maxClients = 10;
        this.ready = new Map();
        this.limiters = new Map();
        this.hostId = '';
        this.lastBroadcastEventTick = 0;
        this.endedAnnounced = false;
        /** sessionId → deviceId, so leader progress lands on the right persistent profile. */
        this.deviceIds = new Map();
        /** sessionId → chosen starting territory. */
        this.pendingStarts = new Map();
        /** Commands queued during the current turn-based planning phase. */
        this.queuedCommands = [];
        this.storage = getStorage();
        /** Wall-clock is read here and only here — the simulation never touches a clock. */
        this.now = () => Date.now();
    }
    onCreate(options) {
        const code = (options.code ?? this.roomId).toUpperCase().slice(0, 6);
        const mode = options.mode ?? 'casual';
        this.sim = createMatch(this.roomId, code, {
            mode,
            speed: clamp(options.speed ?? 1, 0.5, 4),
            aiDifficulty: options.aiDifficulty,
            maxPlayers: modeMaxPlayers(mode),
        });
        // Enforce player cap at room level.
        if (modeMaxPlayers(mode) > 0)
            this.maxClients = modeMaxPlayers(mode);
        this.setState(new MatchS());
        this.setMetadata({ code, mode: this.sim.config.mode, phase: 'lobby', players: 0 });
        this.onMessage('cmd', (client, payload) => this.handleCommand(client, payload));
        this.onMessage('ready', (client, value) => {
            this.ready.set(client.sessionId, Boolean(value));
        });
        this.onMessage('start', (client) => this.handleStart(client));
        this.onMessage('end_turn', (client) => this.handleEndTurn(client));
        this.onMessage('pause', (client) => this.handlePause(client, true));
        this.onMessage('resume', (client) => this.handlePause(client, false));
        this.onMessage('leader', (client, payload) => {
            this.handleLeaderUpdate(client, payload);
        });
        this.onMessage('advice', (client) => {
            client.send('advice', getSuggestions(this.sim, client.sessionId, 3));
        });
        this.onMessage('start_territory', (client, payload) => {
            if (typeof payload?.territoryId === 'string') {
                this.pendingStarts.set(client.sessionId, payload.territoryId);
            }
        });
        this.onMessage('save_game', (client) => this.handleSaveGame(client));
        this.onMessage('load_game', (client, payload) => this.handleLoadGame(client, payload));
        this.onMessage('list_saves', (client) => this.handleListSaves(client));
        this.setSimulationInterval(() => this.step(), TICK_MS);
        syncMatch(this.sim, this.state, this.ready, this.hostId);
    }
    onJoin(client, options = {}) {
        const name = sanitizeName(options.name) || `Commander ${this.clients.length}`;
        const deviceId = sanitizeDeviceId(options.deviceId) || `anon-${client.sessionId}`;
        this.deviceIds.set(client.sessionId, deviceId);
        const player = addPlayer(this.sim, client.sessionId, name);
        // Bring the player's persistent leader into the match: level, XP, spent skill
        // points and cosmetics all carry over from previous games.
        const profile = this.storage.loadProfile(deviceId, name);
        player.leader = { ...profile.leader, name, class: options.leaderClass ?? profile.leader.class };
        refreshModifiers(player); // class + skills change the cached modifier block
        if (!this.hostId)
            this.hostId = client.sessionId;
        this.ready.set(client.sessionId, false);
        this.limiters.set(client.sessionId, new RateLimiter());
        this.setMetadata({ players: this.clients.length, phase: this.sim.phase });
        addEvent(this.sim, 'player_reconnected', client.sessionId, `${name} joined the lobby.`);
        syncMatch(this.sim, this.state, this.ready, this.hostId);
    }
    async onLeave(client, consented) {
        const player = this.sim.players[client.sessionId];
        if (!player)
            return;
        // In the lobby a leaver is simply gone. Mid-match the seat is held.
        if (this.sim.phase === 'lobby' || consented) {
            removePlayer(this.sim, client.sessionId);
            this.ready.delete(client.sessionId);
            this.limiters.delete(client.sessionId);
            if (this.hostId === client.sessionId)
                this.hostId = this.clients[0]?.sessionId ?? '';
            syncMatch(this.sim, this.state, this.ready, this.hostId);
            return;
        }
        player.connected = false;
        // A caretaker holds the line: it defends and spends nothing, so a disconnect is
        // never an advantage and never an instant loss.
        player.ai = true;
        addEvent(this.sim, 'player_disconnected', client.sessionId, `${player.name} has lost contact. Their forces hold position.`);
        try {
            await this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
            player.connected = true;
            player.ai = false;
            addEvent(this.sim, 'player_reconnected', client.sessionId, `${player.name} is back in command.`);
        }
        catch {
            // Window expired — the nation stays under AI control for the rest of the match.
            addEvent(this.sim, 'player_disconnected', client.sessionId, `${player.name} has abandoned the war. Their nation is now AI-controlled.`);
        }
    }
    onDispose() {
        // Hook for Phase 3 persistence: a paused or persistent match is written here.
        if (this.sim.phase === 'playing' || this.sim.phase === 'paused') {
            const blob = serializeMatch(this.sim);
            console.log(`[room ${this.roomId}] disposing mid-match, snapshot ${blob.length} bytes`);
        }
    }
    // ── loop ─────────────────────────────────────────────────────────────────
    step() {
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
            this.clock.setTimeout(() => this.disconnect(), 20000);
        }
    }
    // ── turn-based loop ───────────────────────────────────────────────────────
    stepTurnBased() {
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
    advanceTurn() {
        const active = this.sim.turnOrder.filter((id) => {
            const p = this.sim.players[id];
            return p && p.eliminatedAtTick === null;
        });
        if (active.length === 0)
            return;
        // Pick next player (cyclically).
        const currentIdx = active.indexOf(this.sim.turnPlayer ?? '');
        const nextIdx = (currentIdx + 1) % active.length;
        const nextId = active[nextIdx];
        this.sim.turnNumber++;
        this.sim.turnPlayer = nextId;
        this.sim.turnSecondsRemaining = this.sim.config.turnDurationSeconds;
        this.sim.turnPhase = 'planning';
        this.queuedCommands = [];
        const player = this.sim.players[nextId];
        addEvent(this.sim, 'chat', nextId, `Turn ${this.sim.turnNumber}: ${player?.name ?? 'Someone'}'s planning phase.`);
    }
    resolveTurn() {
        this.sim.turnPhase = 'resolving';
        // Execute all queued commands for the current player in one batch.
        for (const cmd of this.queuedCommands) {
            applyCommand(this.sim, this.sim.turnPlayer, cmd);
        }
        this.queuedCommands = [];
        // Run a burst of simulation ticks equal to the turn duration so armies travel,
        // buildings complete, etc. in a single resolution step.
        const burstTicks = Math.round(this.sim.config.turnDurationSeconds * 5); // 5 ticks/sec
        for (let i = 0; i < burstTicks; i++) {
            this.sim.tick++;
            simTick(this.sim);
        }
        // Advance to the next player.
        this.advanceTurn();
    }
    handleEndTurn(client) {
        if (this.sim.turnOrder.length === 0)
            return;
        if (client.sessionId !== this.sim.turnPlayer)
            return;
        if (this.sim.turnPhase !== 'planning')
            return;
        this.resolveTurn();
    }
    /**
     * Writes leader progress and the match record. XP was already committed into each
     * leader by the simulation when the match ended, so this only persists the result.
     */
    persistResults() {
        try {
            for (const player of Object.values(this.sim.players)) {
                const deviceId = this.deviceIds.get(player.id);
                if (deviceId)
                    this.storage.saveLeader(deviceId, player.leader);
            }
            this.storage.recordMatch(this.sim.id, this.sim.code, this.sim.config.mode, buildResults(this.sim, this.deviceIds));
        }
        catch (error) {
            // Never let a storage failure take down a finished match.
            console.warn(`[room ${this.roomId}] could not persist results:`, error.message);
        }
    }
    /**
     * Rule-based AI opponent.
     *
     * Every 5 seconds the AI evaluates its situation and issues commands directly
     * against the simulation — no advisor dependency. Each difficulty tier follows
     * stricter strategic rules.
     */
    runCaretakers() {
        if (this.sim.tick % 25 !== 0)
            return;
        const difficulty = this.sim.config.aiDifficulty ?? 'medium';
        for (const player of Object.values(this.sim.players)) {
            if (!player.ai || player.eliminatedAtTick !== null)
                continue;
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
    aiDefendAndTrain(player) {
        // Train infantry in every owned territory that has a barracks.
        for (const territory of Object.values(this.sim.territories)) {
            if (territory.ownerId !== player.id)
                continue;
            const hasBarracks = territory.buildings.some((b) => b.type === 'barracks' && b.level > 0);
            if (!hasBarracks)
                continue;
            // Only train if we can afford it and have population.
            if (player.resources.money >= 100 && player.resources.food >= 50 && territory.pop >= 3) {
                applyCommand(this.sim, player.id, {
                    t: 'TRAIN', territoryId: territory.id, unit: 'rifle', count: 3,
                });
            }
        }
    }
    /** Full AI for solo mode — fast, aggressive, covers the entire game lifecycle. */
    aiAct(player, difficulty) {
        const rules = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES.medium;
        const before = { money: player.resources.money, food: player.resources.food, territoryCount: 0 };
        for (const t of Object.values(this.sim.territories)) {
            if (t.ownerId === player.id)
                before.territoryCount++;
        }
        this.aiAttack(player, rules);
        this.aiTrain(player, rules);
        this.aiBuild(player, rules);
        this.aiResearch(player, rules);
        this.aiSpendSkill(player);
        this.aiStances(player);
        console.log(`[AI ${difficulty}] ${player.name} | territories=${before.territoryCount} | money=${before.money.toFixed(0)} | tick=${this.sim.tick}`);
    }
    // ── attack: send ALL eligible armies, split large stacks, random targets ─
    aiAttack(player, rules) {
        const attackEnemies = Math.random() < rules.aggression;
        // Track targets that already have armies en route.
        const targeted = new Set();
        for (const army of Object.values(this.sim.armies)) {
            if (army.ownerId === player.id && army.movingTo)
                targeted.add(army.movingTo);
        }
        for (const army of Object.values(this.sim.armies)) {
            if (army.ownerId !== player.id || army.movingTo)
                continue;
            const territory = this.sim.territories[army.at];
            if (territory && territory.captureProgress > 0 && territory.captureBy === player.id)
                continue;
            let total = 0;
            for (const n of Object.values(army.units))
                total += n ?? 0;
            if (total < rules.minAttackForce)
                continue;
            // Split large armies: detach half to attack a second target.
            if (total >= rules.minAttackForce * 2 && rules.splitArmies) {
                const splitUnits = {};
                for (const [unitId, count] of Object.entries(army.units)) {
                    const half = Math.floor((count ?? 0) / 2);
                    if (half > 0)
                        splitUnits[unitId] = half;
                }
                applyCommand(this.sim, player.id, {
                    t: 'SPLIT_ARMY', armyId: army.id, units: splitUnits,
                });
            }
            const neighbours = (ADJACENCY[army.at] ?? []).map((l) => l.to);
            shuffle(neighbours);
            for (const n of neighbours) {
                // Skip if we already have an army heading there.
                if (targeted.has(n))
                    continue;
                // Skip if the army can't traverse this link (sea link with no marines).
                if (moveBlocker(this.sim, army, n))
                    continue;
                const t = this.sim.territories[n];
                if (!t)
                    continue;
                // Neutral = always fair game; enemy = only if aggression passes.
                if (t.ownerId && t.ownerId === player.id)
                    continue; // own territory
                if (t.ownerId && !attackEnemies)
                    continue; // enemy but aggression check failed
                applyCommand(this.sim, player.id, {
                    t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: n,
                });
                console.log(`[AI] ${player.name} attacking ${n} with ${total} units from ${army.at}`);
                targeted.add(n);
                break; // one target per army, try next army
            }
        }
    }
    // ── stances: aggressive for attackers, hold for border garrisons ───────
    aiStances(player) {
        for (const army of Object.values(this.sim.armies)) {
            if (army.ownerId !== player.id || army.movingTo)
                continue;
            // Aggressive stance for armies about to attack.
            if (army.stance !== 'aggressive') {
                applyCommand(this.sim, player.id, {
                    t: 'SET_STANCE', armyId: army.id, stance: 'aggressive',
                });
            }
        }
    }
    // ── research: class-biased, not random ─────────────────────────────────
    aiResearch(player, rules) {
        if (player.research)
            return;
        const available = availableTechs(player.tech);
        if (available.length === 0)
            return;
        const affordable = available.filter((t) => player.resources.research >= t.costResearch);
        if (affordable.length === 0)
            return;
        if (player.resources.money < rules.researchReserve)
            return;
        // Prioritise tech trees that match the leader class.
        const classPref = {
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
        const topScore = scored[0].score;
        const topTier = scored.filter((s) => s.score === topScore);
        const pick = topTier[Math.floor(Math.random() * topTier.length)];
        applyCommand(this.sim, player.id, { t: 'START_RESEARCH', techId: pick.tech.id });
    }
    // ── skills: spend all points, class-biased ─────────────────────────────
    aiSpendSkill(player) {
        while (player.leader.skillPoints > 0) {
            const classOrder = {
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
            if (!spent)
                break;
        }
    }
    // ── train: all unit types, all territories, multiple batches ───────────
    aiTrain(player, rules) {
        if (player.resources.money < rules.trainReserve)
            return;
        // Collect every territory with ANY military building.
        const factories = [];
        for (const territory of Object.values(this.sim.territories)) {
            if (territory.ownerId !== player.id || territory.pop < 2)
                continue;
            const units = [];
            if (territory.buildings.some((b) => b.type === 'barracks' && b.level > 0)) {
                units.push('rifle');
                if (territory.buildings.some((b) => b.type === 'barracks' && b.level >= 3))
                    units.push('marine');
            }
            if (territory.buildings.some((b) => b.type === 'academy' && b.level > 0))
                units.push('special_forces');
            if (territory.buildings.some((b) => b.type === 'vehicle_plant' && b.level > 0)) {
                units.push('apc');
                if (territory.buildings.some((b) => b.type === 'vehicle_plant' && b.level >= 3))
                    units.push('tank');
            }
            if (territory.buildings.some((b) => b.type === 'airbase' && b.level > 0)) {
                units.push('helicopter');
                if (territory.buildings.some((b) => b.type === 'airbase' && b.level >= 3))
                    units.push('fighter');
                if (territory.buildings.some((b) => b.type === 'airbase' && b.level >= 5))
                    units.push('bomber');
            }
            if (territory.buildings.some((b) => b.type === 'naval_base' && b.level > 0)) {
                units.push('destroyer');
                if (territory.buildings.some((b) => b.type === 'naval_base' && b.level >= 4))
                    units.push('submarine');
                if (territory.buildings.some((b) => b.type === 'naval_base' && b.level >= 7))
                    units.push('carrier');
            }
            if (units.length > 0)
                factories.push({ tid: territory.id, units });
        }
        shuffle(factories);
        let trained = 0;
        for (const { tid, units } of factories) {
            if (trained >= rules.trainBatches)
                break;
            const territory = this.sim.territories[tid];
            shuffle(units);
            for (const unit of units) {
                const def = UNITS[unit];
                const maxPop = Math.floor(territory.pop / (def.manpower || 1));
                const batch = Math.min(rules.trainBatch, maxPop);
                if (batch < 1)
                    continue;
                const cost = { ...def.cost };
                for (const key of RESOURCE_KEYS) {
                    const v = cost[key];
                    if (v !== undefined)
                        cost[key] = v * batch;
                }
                if (!canAfford(player.resources, cost))
                    continue;
                if (player.resources.money - (cost.money ?? 0) < rules.trainReserve)
                    continue;
                if ((player.resources.food - (cost.food ?? 0)) < 20)
                    continue;
                applyCommand(this.sim, player.id, { t: 'TRAIN', territoryId: tid, unit, count: batch });
                trained++;
                break; // one unit type per territory per cycle
            }
        }
    }
    // ── build: barracks first, then military, then economy, multiple per cycle ─
    aiBuild(player, rules) {
        if (player.resources.money < rules.buildReserve)
            return;
        const ownedTids = [];
        for (const territory of Object.values(this.sim.territories)) {
            if (territory.ownerId === player.id)
                ownedTids.push(territory.id);
        }
        shuffle(ownedTids);
        let built = 0;
        for (const tid of ownedTids) {
            if (built >= rules.buildBatches)
                break;
            const territory = this.sim.territories[tid];
            const slots = TERRITORY_DEFS[tid]?.slots ?? 3;
            const hasFreeSlot = territory.buildings.length < slots;
            const tdef = TERRITORY_DEFS[tid];
            const coastal = tdef?.coastal ?? false;
            // Priority order: barracks → other military → economy → tech.
            const priority = [
                'barracks',
                'vehicle_plant', 'airbase', 'naval_base', 'academy',
                'farm', 'commercial', 'factory', 'mine', 'power_plant',
                'research_center', 'university', 'advanced_lab',
            ];
            for (const type of priority) {
                const bdef = BUILDINGS[type];
                // Terrain/coastal gates.
                if (bdef.requiresCoastal && !coastal)
                    continue;
                if (bdef.requiresTerrain && tdef && !bdef.requiresTerrain.includes(tdef.terrain))
                    continue;
                const existing = territory.buildings.find((b) => b.type === type);
                if (!existing && !hasFreeSlot)
                    continue;
                if (existing && existing.completesAtTick > 0)
                    continue;
                const nextLevel = (existing?.level ?? 0) + 1;
                if (nextLevel > rules.maxBuildingLevel)
                    continue;
                const cost = buildingCost(type, nextLevel);
                if (!canAfford(player.resources, cost))
                    continue;
                if (player.resources.money - (cost.money ?? 0) < rules.buildReserve)
                    continue;
                applyCommand(this.sim, player.id, { t: 'BUILD', territoryId: tid, building: type });
                built++;
                break;
            }
        }
    }
    flushEvents() {
        const fresh = this.sim.events.filter((e) => e.tick > this.lastBroadcastEventTick);
        if (fresh.length === 0)
            return;
        this.lastBroadcastEventTick = this.sim.tick;
        // Player-scoped events go only to that player; the rest are global.
        const global = [];
        for (const event of fresh) {
            if (event.playerId) {
                const client = this.clients.find((c) => c.sessionId === event.playerId);
                if (client)
                    client.send('event', event);
                else
                    global.push(event);
            }
            else {
                global.push(event);
            }
        }
        if (global.length)
            this.broadcast('events', global);
    }
    // ── message handlers ─────────────────────────────────────────────────────
    handleCommand(client, cmd) {
        const limiter = this.limiters.get(client.sessionId);
        if (limiter && !limiter.allow(this.now())) {
            client.send('reject', { reason: 'rate_limited' });
            return;
        }
        if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') {
            client.send('reject', { reason: 'malformed' });
            return;
        }
        // Turn-based mode: queue commands during planning, validate at resolution.
        if (this.sim.turnOrder.length > 0) {
            if (client.sessionId !== this.sim.turnPlayer) {
                client.send('reject', { reason: 'not_your_turn' });
                return;
            }
            if (this.sim.turnPhase !== 'planning') {
                client.send('reject', { reason: 'turn_phase', message: 'Turn is resolving — wait.' });
                return;
            }
            // Pre-validate: if the command is outright malformed, reject early so the
            // player gets immediate feedback rather than discovering it at turn end.
            const result = applyCommand(this.sim, client.sessionId, cmd);
            if (!result.ok) {
                client.send('reject', { reason: result.reason, message: result.message, command: cmd.t });
                return;
            }
            // QUEUE the command for resolution at turn end.
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
    handleStart(client) {
        if (client.sessionId !== this.hostId) {
            client.send('reject', { reason: 'not_host' });
            return;
        }
        if (this.sim.phase !== 'lobby')
            return;
        if (this.sim.playerOrder.length < 1)
            return;
        const mode = this.sim.config.mode;
        // AI opponent for solo_ai mode.
        if (mode === 'solo_ai') {
            const aiId = `ai-${this.sim.nextEntityId}`;
            const difficulty = this.sim.config.aiDifficulty ?? 'medium';
            const aiNames = {
                easy: 'General Green',
                medium: 'Marshal Steel',
                hard: 'Supreme Commander Onyx',
            };
            addPlayer(this.sim, aiId, aiNames[difficulty] ?? 'AI Opponent', { team: 2 });
            const aiPlayer = this.sim.players[aiId];
            if (aiPlayer) {
                aiPlayer.ai = true;
                aiPlayer.connected = false;
                const diffMul = { easy: 0.7, medium: 1.0, hard: 1.4 };
                const mul = diffMul[difficulty] ?? 1;
                for (const key of RESOURCE_KEYS)
                    aiPlayer.resources[key] *= mul;
            }
        }
        startMatch(this.sim, this.pendingStarts);
        // Speed tuning per mode.
        if (mode === 'solo_ai') {
            this.sim.config.speed = 10;
        }
        else if (mode === 'quick_2p') {
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
    handleSaveGame(client) {
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
            this.storage.saveGame(this.sim.id, this.sim.code, deviceId, serializeMatch(this.sim));
            client.send('event', { type: 'save_completed', text: 'Game saved.' });
        }
        catch (error) {
            client.send('reject', { reason: 'save_failed', message: 'Could not save the game.' });
            console.warn(`[room ${this.roomId}] save failed:`, error.message);
        }
    }
    handleLoadGame(client, payload) {
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
        }
        catch (error) {
            client.send('reject', { reason: 'save_corrupt', message: 'Save file could not be read.' });
            console.warn(`[room ${this.roomId}] load failed:`, error.message);
        }
    }
    handleListSaves(client) {
        if (client.sessionId !== this.hostId) {
            client.send('reject', { reason: 'not_host' });
            return;
        }
        const deviceId = this.deviceIds.get(this.hostId) ?? 'unknown';
        try {
            const saves = this.storage.listSavedGames(deviceId);
            client.send('saves_list', saves);
        }
        catch (error) {
            client.send('saves_list', []);
            console.warn(`[room ${this.roomId}] list saves failed:`, error.message);
        }
    }
    handlePause(client, paused) {
        if (!this.sim.config.allowPause)
            return;
        if (client.sessionId !== this.hostId) {
            client.send('reject', { reason: 'not_host' });
            return;
        }
        if (paused && this.sim.phase === 'playing')
            this.sim.phase = 'paused';
        else if (!paused && this.sim.phase === 'paused')
            this.sim.phase = 'playing';
    }
    handleLeaderUpdate(client, payload) {
        if (this.sim.phase !== 'lobby')
            return;
        const player = this.sim.players[client.sessionId];
        if (!player)
            return;
        const name = sanitizeName(payload.name);
        if (name) {
            player.name = name;
            player.leader.name = name;
        }
        if (payload.leaderClass)
            player.leader.class = payload.leaderClass;
        refreshModifiers(player);
        this.persistLeader(client.sessionId);
        syncMatch(this.sim, this.state, this.ready, this.hostId);
    }
    persistLeader(sessionId) {
        const player = this.sim.players[sessionId];
        const deviceId = this.deviceIds.get(sessionId);
        if (!player || !deviceId)
            return;
        try {
            this.storage.saveLeader(deviceId, player.leader);
        }
        catch (error) {
            // Progress is important but a locked/corrupt database must never drop a player.
            console.warn(`[room ${this.roomId}] could not save leader:`, error.message);
        }
    }
}
function modeMaxPlayers(mode) {
    switch (mode) {
        case 'solo_ai': return 1;
        case 'quick_2p': return 2;
        case 'turns_4_6': return 6;
        default: return 0; // 0 = no cap
    }
}
function sanitizeName(name) {
    if (typeof name !== 'string')
        return '';
    return name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20);
}
/** Device ids are used as database keys, so they are strictly constrained. */
function sanitizeDeviceId(deviceId) {
    if (typeof deviceId !== 'string')
        return '';
    return deviceId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/** Fisher-Yates shuffle in place so the AI picks random targets each cycle. */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
const DIFFICULTY_RULES = {
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
        aggression: 0.5,
        maxBuildingLevel: 5,
        trainBatch: 6,
        trainBatches: 1,
        buildBatches: 1,
        splitArmies: false,
        minAttackForce: 8,
        buildReserve: 300,
        trainReserve: 200,
        researchReserve: 250,
    },
    hard: {
        aggression: 0.85,
        maxBuildingLevel: 8,
        trainBatch: 9,
        trainBatches: 2,
        buildBatches: 1,
        splitArmies: true,
        minAttackForce: 6,
        buildReserve: 300,
        trainReserve: 200,
        researchReserve: 150,
    },
};
//# sourceMappingURL=WarRoom.js.map