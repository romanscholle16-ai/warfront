import { RESOURCE_KEYS } from '../types.js';
import { DEFAULT_MATCH_CONFIG, MAX_EVENTS, PLAYER_COLOURS, STARTING_RESOURCES, } from '../config/constants.js';
import { createDefaultLeader } from '../config/leaders.js';
import { EARTH_MODERN, TERRITORY_DEFS } from '../data/worldMap.js';
import { seedFromString } from '../util/rng.js';
import { computeModifiers } from './modifiers.js';
// ── construction ───────────────────────────────────────────────────────────
export function emptyResources() {
    return { money: 0, food: 0, oil: 0, materials: 0, research: 0 };
}
export function createMatch(id, code, config) {
    const cfg = { ...DEFAULT_MATCH_CONFIG, ...config };
    const state = {
        id,
        code,
        phase: 'lobby',
        tick: 0,
        config: cfg,
        rngState: seedFromString(`${id}:${code}`),
        players: {},
        playerOrder: [],
        territories: {},
        armies: {},
        training: [],
        battles: [],
        tradeOffers: [],
        pings: [],
        events: [],
        winnerTeam: null,
        nextEntityId: 1,
        turnPlayer: null,
        turnNumber: 0,
        turnSecondsRemaining: 0,
        turnPhase: null,
        turnOrder: [],
    };
    for (const def of EARTH_MODERN.territories) {
        state.territories[def.id] = {
            id: def.id,
            ownerId: null,
            pop: def.basePop,
            unrest: 0,
            buildings: [],
            captureProgress: 0,
            captureBy: null,
        };
    }
    return state;
}
export function addPlayer(state, id, name, opts = {}) {
    const slot = state.playerOrder.length;
    const leader = opts.leader ?? createDefaultLeader(name);
    const player = {
        id,
        name,
        team: opts.team ?? slot + 1,
        colour: PLAYER_COLOURS[slot % PLAYER_COLOURS.length],
        leader,
        resources: { ...STARTING_RESOURCES },
        income: emptyResources(),
        tech: [],
        research: null,
        modifiers: computeModifiers(leader, []),
        connected: true,
        ai: false,
        eliminatedAtTick: null,
        allies: [],
        allianceOffers: [],
        betrayals: 0,
        matchXp: 0,
    };
    state.players[id] = player;
    state.playerOrder.push(id);
    return player;
}
export function removePlayer(state, id) {
    delete state.players[id];
    state.playerOrder = state.playerOrder.filter((p) => p !== id);
    for (const t of Object.values(state.territories)) {
        if (t.ownerId === id)
            t.ownerId = null;
    }
    for (const [armyId, army] of Object.entries(state.armies)) {
        if (army.ownerId === id)
            delete state.armies[armyId];
    }
    state.training = state.training.filter((o) => o.ownerId !== id);
    // Leave no dangling references — an offer or alliance pointing at a departed player
    // would otherwise show up as a ghost in every diplomacy panel.
    state.tradeOffers = state.tradeOffers.filter((offer) => offer.fromId !== id && offer.toId !== id);
    state.pings = state.pings.filter((ping) => ping.playerId !== id);
    for (const other of Object.values(state.players)) {
        other.allies = other.allies.filter((allyId) => allyId !== id);
        other.allianceOffers = other.allianceOffers.filter((offerId) => offerId !== id);
    }
}
/**
 * Assigns starting territories and a small starting force, then flips the match to
 * `playing`. If players chose territories in the lobby those are honoured first;
 * otherwise the map's pre-spread list ensures opposite sides of the globe.
 */
export function startMatch(state, pendingStarts) {
    if (state.phase !== 'lobby')
        return;
    const startList = EARTH_MODERN.starts;
    const used = new Set();
    state.playerOrder.forEach((playerId, i) => {
        // Honour the player's lobby choice, falling back to the spread list.
        let territoryId = '';
        if (pendingStarts) {
            territoryId = pendingStarts.get(playerId) ?? '';
            // Reject duplicates — if two players pick the same spot only the first gets it.
            if (territoryId && used.has(territoryId))
                territoryId = '';
        }
        if (!territoryId || !state.territories[territoryId]) {
            territoryId = startList[i % startList.length];
        }
        used.add(territoryId);
        const territory = state.territories[territoryId];
        if (!territory)
            return;
        territory.ownerId = playerId;
        territory.unrest = 0;
        // A garrison to defend with and a builder economy to start from.
        createArmy(state, playerId, territoryId, { rifle: 6 });
    });
    state.phase = 'playing';
    addEvent(state, 'match_started', null, `The war begins. ${state.playerOrder.length} nations mobilise.`);
}
// ── entities ───────────────────────────────────────────────────────────────
export function nextId(state, prefix) {
    return `${prefix}${state.nextEntityId++}`;
}
export function createArmy(state, ownerId, at, units) {
    const army = {
        id: nextId(state, 'a'),
        ownerId,
        units: { ...units },
        at,
        movingTo: null,
        progress: 0,
        stance: 'defensive',
        waypoints: [],
    };
    state.armies[army.id] = army;
    return army;
}
/** The stationary army a player has in a territory, if any — where new units land. */
export function garrisonOf(state, ownerId, territoryId) {
    return Object.values(state.armies).find((a) => a.ownerId === ownerId && a.at === territoryId && a.movingTo === null);
}
/** Every army physically standing in a territory (excludes armies in transit). */
export function armiesAt(state, territoryId) {
    return Object.values(state.armies).filter((a) => a.at === territoryId && a.movingTo === null);
}
export function armyUnitCount(army) {
    let total = 0;
    for (const n of Object.values(army.units))
        total += n ?? 0;
    return total;
}
export function mergeArmies(target, source) {
    for (const [unit, n] of Object.entries(source.units)) {
        const key = unit;
        target.units[key] = (target.units[key] ?? 0) + (n ?? 0);
    }
}
// ── lookups ────────────────────────────────────────────────────────────────
export function territoryDef(id) {
    const def = TERRITORY_DEFS[id];
    if (!def)
        throw new Error(`Unknown territory: ${id}`);
    return def;
}
export function playerTerritories(state, playerId) {
    return Object.values(state.territories).filter((t) => t.ownerId === playerId);
}
export function ownedTerritoryCount(state, playerId) {
    let n = 0;
    for (const t of Object.values(state.territories))
        if (t.ownerId === playerId)
            n++;
    return n;
}
/** Allies share vision and never fight each other. Same team is implicitly allied. */
export function areFriendly(state, a, b) {
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    const pa = state.players[a];
    const pb = state.players[b];
    if (!pa || !pb)
        return false;
    if (pa.team === pb.team)
        return true;
    return pa.allies.includes(b) && pb.allies.includes(a);
}
// ── resources ──────────────────────────────────────────────────────────────
export function canAfford(resources, cost) {
    for (const key of RESOURCE_KEYS) {
        const need = cost[key];
        if (need !== undefined && resources[key] < need)
            return false;
    }
    return true;
}
export function spend(resources, cost) {
    for (const key of RESOURCE_KEYS) {
        const need = cost[key];
        if (need !== undefined)
            resources[key] -= need;
    }
}
export function refund(resources, cost) {
    for (const key of RESOURCE_KEYS) {
        const value = cost[key];
        if (value !== undefined)
            resources[key] += value;
    }
}
/** Which resources are missing, for a UI message like "Need 120 materials". */
export function missingResources(resources, cost) {
    const out = {};
    for (const key of RESOURCE_KEYS) {
        const need = cost[key];
        if (need !== undefined && resources[key] < need)
            out[key] = Math.ceil(need - resources[key]);
    }
    return out;
}
// ── events ─────────────────────────────────────────────────────────────────
export function addEvent(state, type, playerId, text, extra = {}) {
    state.events.push({ tick: state.tick, type, playerId, text, ...extra });
    if (state.events.length > MAX_EVENTS) {
        state.events.splice(0, state.events.length - MAX_EVENTS);
    }
}
// ── serialization ──────────────────────────────────────────────────────────
/** Match state is plain JSON by construction, so save/resume is this one line. */
export function serializeMatch(state) {
    return JSON.stringify(state);
}
export function deserializeMatch(json) {
    return JSON.parse(json);
}
//# sourceMappingURL=state.js.map