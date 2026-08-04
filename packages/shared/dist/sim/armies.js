import { UNITS } from '../config/units.js';
import { TICKS_PER_MINUTE } from '../config/constants.js';
import { ADJACENCY, AVERAGE_LINK_DISTANCE, TERRITORY_DEFS, linkBetween } from '../data/worldMap.js';
import { armyUnitCount, mergeArmies } from './state.js';
/**
 * Where each domain may go (M7). No transport-loading mechanic — geography does the
 * work instead, which is far easier to understand on a phone:
 *
 *   land   land links only; marines are amphibious and may also cross open water
 *   sea    sea links only, and only between coastal territories
 *   air    anywhere, which is what the range and cost are paying for
 *
 * A mixed army moves at the speed of its slowest unit and is restricted by its most
 * restricted unit — so a fleet with a tank aboard simply cannot sail.
 */
export function canCrossLink(units, kind) {
    return traverseBlocker(units, kind, true) === null;
}
export function traverseBlocker(units, kind, destinationCoastal) {
    for (const [unitId, count] of Object.entries(units)) {
        if (!count)
            continue;
        const def = UNITS[unitId];
        if (!def)
            continue;
        if (def.domain === 'air')
            continue; // aircraft ignore terrain entirely
        if (def.domain === 'sea') {
            if (kind !== 'sea')
                return 'ships_need_water';
            if (!destinationCoastal)
                return 'ships_need_coast';
            continue;
        }
        // Land units.
        if (kind === 'sea' && def.id !== 'marine')
            return 'cannot_cross_sea';
    }
    return null;
}
/** True if the army contains anything that can hold ground — ships and planes cannot. */
export function hasGroundForce(units) {
    for (const [unitId, count] of Object.entries(units)) {
        if (!count || count < 0.01)
            continue;
        if (UNITS[unitId]?.domain === 'land')
            return true;
    }
    return false;
}
/** An army moves at the speed of its slowest unit. */
export function armySpeed(state, army) {
    let slowest = Infinity;
    for (const [unitId, count] of Object.entries(army.units)) {
        if (!count)
            continue;
        const def = UNITS[unitId];
        if (def)
            slowest = Math.min(slowest, def.speed);
    }
    if (!Number.isFinite(slowest))
        return 0;
    const mul = state.players[army.ownerId]?.modifiers.unitSpeedMul ?? 1;
    return slowest * mul;
}
/** Ticks for `army` to travel from its current territory to `to`. */
export function travelTicks(state, army, to) {
    const link = linkBetween(army.at, to);
    if (!link)
        return Infinity;
    const speed = armySpeed(state, army);
    if (speed <= 0)
        return Infinity;
    const links = link.distance / AVERAGE_LINK_DISTANCE;
    return Math.max(1, Math.round((links / speed) * TICKS_PER_MINUTE / state.config.speed));
}
export function moveBlocker(state, army, to) {
    if (armyUnitCount(army) <= 0)
        return 'empty_army';
    if (army.movingTo !== null)
        return 'already_moving';
    const link = linkBetween(army.at, to);
    if (!link)
        return 'not_adjacent';
    return traverseBlocker(army.units, link.kind, TERRITORY_DEFS[to]?.coastal ?? false);
}
/** Every territory this army could legally move to right now — drives map highlighting. */
export function legalDestinations(state, army) {
    return (ADJACENCY[army.at] ?? [])
        .filter((link) => traverseBlocker(army.units, link.kind, TERRITORY_DEFS[link.to]?.coastal ?? false) === null)
        .map((link) => link.to);
}
/**
 * Finds a safe multi-territory route. Intermediate stops must already belong to the
 * moving player; the final territory may be unclaimed or hostile so an army can still
 * launch an invasion. This prevents a player from using another nation as a free road.
 */
export function routeForArmy(state, army, destination) {
    if (!state.territories[destination] || army.at === destination)
        return null;
    const queue = [army.at];
    const previous = new Map();
    const visited = new Set([army.at]);
    while (queue.length) {
        const from = queue.shift();
        for (const link of ADJACENCY[from] ?? []) {
            if (visited.has(link.to))
                continue;
            if (traverseBlocker(army.units, link.kind, TERRITORY_DEFS[link.to]?.coastal ?? false))
                continue;
            // Only the final step can pass through a country we do not control.
            if (link.to !== destination && state.territories[link.to]?.ownerId !== army.ownerId)
                continue;
            visited.add(link.to);
            previous.set(link.to, from);
            if (link.to === destination) {
                const route = [];
                let cursor = destination;
                while (cursor !== army.at) {
                    route.unshift(cursor);
                    cursor = previous.get(cursor);
                }
                return route;
            }
            queue.push(link.to);
        }
    }
    return null;
}
export function orderMove(state, army, to) {
    army.movingTo = to;
    army.progress = 0;
}
/**
 * Advances every moving army. On arrival, an army merges into any stationary army
 * its owner already has there, so a player never accumulates dozens of stacks.
 */
export function tickArmies(state) {
    const arrived = [];
    for (const army of Object.values(state.armies)) {
        if (army.movingTo === null)
            continue;
        const ticks = travelTicks(state, army, army.movingTo);
        if (!Number.isFinite(ticks)) {
            // Destination became unreachable (e.g. the army lost its amphibious units).
            army.movingTo = null;
            army.progress = 0;
            continue;
        }
        army.progress += 1 / ticks;
        if (army.progress >= 1) {
            army.at = army.movingTo;
            army.movingTo = null;
            army.progress = 0;
            arrived.push(army);
        }
    }
    for (const army of arrived) {
        // Continue a multi-hop order if the next waypoint is still reachable.
        const nextHop = army.waypoints.shift();
        if (nextHop && moveBlocker(state, army, nextHop) === null) {
            orderMove(state, army, nextHop);
            continue;
        }
        mergeIntoGarrison(state, army);
    }
    cullEmptyArmies(state);
}
function mergeIntoGarrison(state, army) {
    for (const other of Object.values(state.armies)) {
        if (other.id === army.id)
            continue;
        if (other.ownerId !== army.ownerId || other.at !== army.at || other.movingTo !== null)
            continue;
        mergeArmies(other, army);
        other.waypoints = [];
        delete state.armies[army.id];
        return;
    }
}
export function cullEmptyArmies(state) {
    for (const [id, army] of Object.entries(state.armies)) {
        for (const [unitId, count] of Object.entries(army.units)) {
            if ((count ?? 0) < 0.01)
                delete army.units[unitId];
        }
        if (armyUnitCount(army) <= 0)
            delete state.armies[id];
    }
}
/** Splits `units` out of `army` into a new army standing in the same territory. */
export function splitArmy(state, army, units, newId) {
    const taken = {};
    for (const [unitId, requested] of Object.entries(units)) {
        const key = unitId;
        const available = army.units[key] ?? 0;
        const n = Math.min(available, requested ?? 0);
        if (n > 0) {
            taken[key] = n;
            army.units[key] = available - n;
        }
    }
    let total = 0;
    for (const n of Object.values(taken))
        total += n ?? 0;
    if (total <= 0)
        return null;
    const created = {
        id: newId,
        ownerId: army.ownerId,
        units: taken,
        at: army.at,
        movingTo: null,
        progress: 0,
        stance: army.stance,
        waypoints: [],
    };
    state.armies[created.id] = created;
    cullEmptyArmies(state);
    return created;
}
//# sourceMappingURL=armies.js.map