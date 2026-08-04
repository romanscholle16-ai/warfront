import { ArraySchema, MapSchema, Schema, defineTypes } from '@colyseus/schema';
import { xpForNextLevel } from '@warfront/shared';
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
export class ResourcesS extends Schema {
    constructor() {
        super(...arguments);
        this.money = 0;
        this.food = 0;
        this.oil = 0;
        this.materials = 0;
        this.research = 0;
    }
}
defineTypes(ResourcesS, {
    money: 'float32', food: 'float32', oil: 'float32',
    materials: 'float32', research: 'float32',
});
/** Cosmetic only — mirrored so other players can see your leader, never read by the sim. */
export class AppearanceS extends Schema {
    constructor() {
        super(...arguments);
        this.body = 0;
        this.face = 0;
        this.hair = 0;
        this.uniform = '';
        this.accessory = '';
        this.flag = '';
        this.colour = '';
    }
}
defineTypes(AppearanceS, {
    body: 'uint8', face: 'uint8', hair: 'uint8',
    uniform: 'string', accessory: 'string', flag: 'string', colour: 'string',
});
export class TradeOfferS extends Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.fromId = '';
        this.toId = '';
        /** "money:200,oil:50" — same compact encoding as army composition. */
        this.give = '';
        this.want = '';
        this.expiresAtTick = 0;
    }
}
defineTypes(TradeOfferS, {
    id: 'string', fromId: 'string', toId: 'string',
    give: 'string', want: 'string', expiresAtTick: 'uint32',
});
export class PingS extends Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.playerId = '';
        this.territoryId = '';
        this.kind = '';
        this.expiresAtTick = 0;
    }
}
defineTypes(PingS, {
    id: 'string', playerId: 'string', territoryId: 'string',
    kind: 'string', expiresAtTick: 'uint32',
});
export class PlayerS extends Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.name = '';
        this.team = 0;
        this.colour = '';
        this.leaderName = '';
        this.leaderClass = '';
        this.leaderLevel = 1;
        this.leaderXp = 0;
        this.leaderXpNeeded = 0;
        this.skillPoints = 0;
        this.skillWarfare = 0;
        this.skillEconomy = 0;
        this.skillIntelligence = 0;
        this.betrayals = 0;
        this.matchXp = 0;
        /** Comma-separated ids of players who have offered this player an alliance. */
        this.allianceOffers = '';
        this.appearance = new AppearanceS();
        this.ready = false;
        this.connected = true;
        this.ai = false;
        this.eliminated = false;
        this.techCount = 0;
        /** Comma-separated completed tech ids. Changes only when research completes. */
        this.tech = '';
        this.researchTechId = '';
        this.researchEndTick = 0;
        /** Comma-separated player ids. Cheaper on the wire than an ArraySchema. */
        this.allies = '';
        this.resources = new ResourcesS();
        this.income = new ResourcesS();
    }
}
defineTypes(PlayerS, {
    id: 'string', name: 'string', team: 'uint8', colour: 'string',
    leaderName: 'string', leaderClass: 'string',
    leaderLevel: 'uint16', leaderXp: 'uint32', leaderXpNeeded: 'uint32',
    skillPoints: 'uint8', skillWarfare: 'uint8', skillEconomy: 'uint8',
    skillIntelligence: 'uint8', betrayals: 'uint8', matchXp: 'uint32',
    allianceOffers: 'string', appearance: AppearanceS,
    ready: 'boolean', connected: 'boolean', ai: 'boolean', eliminated: 'boolean',
    techCount: 'uint16', tech: 'string', researchTechId: 'string', researchEndTick: 'uint32',
    allies: 'string', resources: ResourcesS, income: ResourcesS,
});
export class BuildingS extends Schema {
    constructor() {
        super(...arguments);
        this.type = '';
        this.level = 0;
        this.targetLevel = 0;
        this.completesAtTick = 0;
    }
}
defineTypes(BuildingS, {
    type: 'string', level: 'uint8', targetLevel: 'uint8', completesAtTick: 'uint32',
});
export class TerritoryS extends Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.ownerId = '';
        this.pop = 0;
        this.unrest = 0;
        this.captureProgress = 0;
        this.captureBy = '';
        this.buildings = new ArraySchema();
    }
}
defineTypes(TerritoryS, {
    id: 'string', ownerId: 'string', pop: 'float32', unrest: 'float32',
    captureProgress: 'uint16', captureBy: 'string', buildings: [BuildingS],
});
export class ArmyS extends Schema {
    constructor() {
        super(...arguments);
        this.id = '';
        this.ownerId = '';
        this.at = '';
        this.movingTo = '';
        this.progress = 0;
        this.stance = '';
        /** "rifle:12.5,tank:3" — compact, and only changes when a count meaningfully changes. */
        this.units = '';
        this.total = 0;
    }
}
defineTypes(ArmyS, {
    id: 'string', ownerId: 'string', at: 'string', movingTo: 'string',
    progress: 'float32', stance: 'string', units: 'string', total: 'float32',
});
export class BattleS extends Schema {
    constructor() {
        super(...arguments);
        this.territoryId = '';
        this.startedAtTick = 0;
    }
}
defineTypes(BattleS, { territoryId: 'string', startedAtTick: 'uint32' });
export class MatchS extends Schema {
    constructor() {
        super(...arguments);
        this.code = '';
        this.phase = 'lobby';
        this.tick = 0;
        this.mode = 'casual';
        this.mapId = 'earth_modern';
        this.speed = 1;
        this.hostId = '';
        this.winnerTeam = -1;
        /** Turn-based: current player's id, else empty. */
        this.turnPlayer = '';
        this.turnNumber = 0;
        this.turnSecondsRemaining = 0;
        this.turnPhase = '';
        /** Comma-separated turn order. */
        this.turnOrder = '';
        this.players = new MapSchema();
        this.territories = new MapSchema();
        this.armies = new MapSchema();
        this.battles = new ArraySchema();
        this.tradeOffers = new ArraySchema();
        this.pings = new ArraySchema();
    }
}
defineTypes(MatchS, {
    code: 'string', phase: 'string', tick: 'uint32', mode: 'string', mapId: 'string',
    speed: 'float32', hostId: 'string', winnerTeam: 'int8',
    turnPlayer: 'string', turnNumber: 'uint16', turnSecondsRemaining: 'float32',
    turnPhase: 'string', turnOrder: 'string',
    players: { map: PlayerS }, territories: { map: TerritoryS },
    armies: { map: ArmyS }, battles: [BattleS],
    tradeOffers: [TradeOfferS], pings: [PingS],
});
// ── mirroring ──────────────────────────────────────────────────────────────
/** Rounded so tiny float drift doesn't generate a delta every single tick. */
function round(value, dp = 2) {
    const f = Math.pow(10, dp);
    return Math.round(value * f) / f;
}
function encodeUnits(units) {
    const parts = [];
    for (const [unit, count] of Object.entries(units)) {
        if (!count || count < 0.01)
            continue;
        parts.push(`${unit}:${round(count, 1)}`);
    }
    return parts.join(',');
}
export function decodeUnits(encoded) {
    const out = {};
    if (!encoded)
        return out;
    for (const part of encoded.split(',')) {
        const [unit, count] = part.split(':');
        if (unit && count)
            out[unit] = Number(count);
    }
    return out;
}
function setIfChanged(target, key, value) {
    if (target[key] !== value)
        target[key] = value;
}
function syncResources(target, source) {
    setIfChanged(target, 'money', round(source.money ?? 0, 1));
    setIfChanged(target, 'food', round(source.food ?? 0, 1));
    setIfChanged(target, 'oil', round(source.oil ?? 0, 1));
    setIfChanged(target, 'materials', round(source.materials ?? 0, 1));
    setIfChanged(target, 'research', round(source.research ?? 0, 1));
}
/** Copies the whole simulation into the schema. Called once per tick. */
export function syncMatch(sim, out, ready, hostId) {
    setIfChanged(out, 'code', sim.code);
    setIfChanged(out, 'phase', sim.phase);
    setIfChanged(out, 'tick', sim.tick);
    setIfChanged(out, 'mode', sim.config.mode);
    setIfChanged(out, 'mapId', sim.config.mapId);
    setIfChanged(out, 'speed', sim.config.speed);
    setIfChanged(out, 'hostId', hostId);
    setIfChanged(out, 'winnerTeam', sim.winnerTeam ?? -1);
    setIfChanged(out, 'turnPlayer', sim.turnPlayer ?? '');
    setIfChanged(out, 'turnNumber', sim.turnNumber);
    setIfChanged(out, 'turnSecondsRemaining', round(sim.turnSecondsRemaining, 1));
    setIfChanged(out, 'turnPhase', sim.turnPhase ?? '');
    setIfChanged(out, 'turnOrder', sim.turnOrder.join(','));
    // players
    for (const id of sim.playerOrder) {
        const player = sim.players[id];
        if (!player)
            continue;
        let target = out.players.get(id);
        if (!target) {
            target = new PlayerS();
            out.players.set(id, target);
        }
        setIfChanged(target, 'id', player.id);
        setIfChanged(target, 'name', player.name);
        setIfChanged(target, 'team', player.team);
        setIfChanged(target, 'colour', player.colour);
        setIfChanged(target, 'leaderName', player.leader.name);
        setIfChanged(target, 'leaderClass', player.leader.class);
        setIfChanged(target, 'leaderLevel', player.leader.level);
        setIfChanged(target, 'leaderXp', Math.round(player.leader.xp));
        setIfChanged(target, 'leaderXpNeeded', xpForNextLevel(player.leader.level));
        setIfChanged(target, 'skillPoints', player.leader.skillPoints);
        setIfChanged(target, 'skillWarfare', player.leader.skills.warfare);
        setIfChanged(target, 'skillEconomy', player.leader.skills.economy);
        setIfChanged(target, 'skillIntelligence', player.leader.skills.intelligence);
        setIfChanged(target, 'betrayals', Math.min(255, player.betrayals));
        setIfChanged(target, 'matchXp', Math.round(player.matchXp));
        setIfChanged(target, 'allianceOffers', player.allianceOffers.join(','));
        const look = player.leader.appearance;
        setIfChanged(target.appearance, 'body', look.body);
        setIfChanged(target.appearance, 'face', look.face);
        setIfChanged(target.appearance, 'hair', look.hair);
        setIfChanged(target.appearance, 'uniform', look.uniform);
        setIfChanged(target.appearance, 'accessory', look.accessory);
        setIfChanged(target.appearance, 'flag', look.flag);
        setIfChanged(target.appearance, 'colour', look.colour);
        setIfChanged(target, 'ready', ready.get(id) ?? false);
        setIfChanged(target, 'connected', player.connected);
        setIfChanged(target, 'ai', player.ai);
        setIfChanged(target, 'eliminated', player.eliminatedAtTick !== null);
        setIfChanged(target, 'techCount', player.tech.length);
        setIfChanged(target, 'tech', player.tech.join(','));
        setIfChanged(target, 'researchTechId', player.research?.techId ?? '');
        setIfChanged(target, 'researchEndTick', player.research?.completesAtTick ?? 0);
        setIfChanged(target, 'allies', player.allies.join(','));
        syncResources(target.resources, player.resources);
        syncResources(target.income, player.income);
    }
    for (const id of [...out.players.keys()]) {
        if (!sim.players[id])
            out.players.delete(id);
    }
    // territories
    for (const [id, territory] of Object.entries(sim.territories)) {
        let target = out.territories.get(id);
        if (!target) {
            target = new TerritoryS();
            target.id = id;
            out.territories.set(id, target);
        }
        setIfChanged(target, 'ownerId', territory.ownerId ?? '');
        setIfChanged(target, 'pop', round(territory.pop, 0));
        setIfChanged(target, 'unrest', round(territory.unrest, 2));
        setIfChanged(target, 'captureProgress', territory.captureProgress);
        setIfChanged(target, 'captureBy', territory.captureBy ?? '');
        if (target.buildings.length !== territory.buildings.length) {
            target.buildings.clear();
            for (const _ of territory.buildings)
                target.buildings.push(new BuildingS());
        }
        territory.buildings.forEach((b, i) => {
            const slot = target.buildings[i];
            setIfChanged(slot, 'type', b.type);
            setIfChanged(slot, 'level', b.level);
            setIfChanged(slot, 'targetLevel', b.targetLevel);
            setIfChanged(slot, 'completesAtTick', b.completesAtTick);
        });
    }
    // armies
    for (const [id, army] of Object.entries(sim.armies)) {
        let target = out.armies.get(id);
        if (!target) {
            target = new ArmyS();
            target.id = id;
            out.armies.set(id, target);
        }
        let total = 0;
        for (const n of Object.values(army.units))
            total += n ?? 0;
        setIfChanged(target, 'ownerId', army.ownerId);
        setIfChanged(target, 'at', army.at);
        setIfChanged(target, 'movingTo', army.movingTo ?? '');
        setIfChanged(target, 'progress', round(army.progress, 3));
        setIfChanged(target, 'stance', army.stance);
        setIfChanged(target, 'units', encodeUnits(army.units));
        setIfChanged(target, 'total', round(total, 1));
    }
    for (const id of [...out.armies.keys()]) {
        if (!sim.armies[id])
            out.armies.delete(id);
    }
    // battles
    if (out.battles.length !== sim.battles.length) {
        out.battles.clear();
        for (const battle of sim.battles) {
            const b = new BattleS();
            b.territoryId = battle.territoryId;
            b.startedAtTick = battle.startedAtTick;
            out.battles.push(b);
        }
    }
    // trade offers — short-lived and few, so a rebuild on change is cheaper than diffing
    if (offersChanged(out.tradeOffers, sim.tradeOffers)) {
        out.tradeOffers.clear();
        for (const offer of sim.tradeOffers) {
            const row = new TradeOfferS();
            row.id = offer.id;
            row.fromId = offer.fromId;
            row.toId = offer.toId;
            row.give = encodeDelta(offer.give);
            row.want = encodeDelta(offer.want);
            row.expiresAtTick = offer.expiresAtTick;
            out.tradeOffers.push(row);
        }
    }
    // pings
    if (pingsChanged(out.pings, sim.pings)) {
        out.pings.clear();
        for (const ping of sim.pings) {
            const row = new PingS();
            row.id = ping.id;
            row.playerId = ping.playerId;
            row.territoryId = ping.territoryId;
            row.kind = ping.kind;
            row.expiresAtTick = ping.expiresAtTick;
            out.pings.push(row);
        }
    }
}
function offersChanged(current, next) {
    if (current.length !== next.length)
        return true;
    for (let i = 0; i < next.length; i++) {
        if (current[i]?.id !== next[i]?.id)
            return true;
    }
    return false;
}
function pingsChanged(current, next) {
    if (current.length !== next.length)
        return true;
    for (let i = 0; i < next.length; i++) {
        if (current[i]?.id !== next[i]?.id)
            return true;
    }
    return false;
}
export function encodeDelta(delta) {
    const parts = [];
    for (const [key, value] of Object.entries(delta)) {
        if (!value)
            continue;
        parts.push(`${key}:${Math.round(value)}`);
    }
    return parts.join(',');
}
export function decodeDelta(encoded) {
    const out = {};
    if (!encoded)
        return out;
    for (const part of encoded.split(',')) {
        const [key, value] = part.split(':');
        if (key && value)
            out[key] = Number(value);
    }
    return out;
}
//# sourceMappingURL=schema.js.map