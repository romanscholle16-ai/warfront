import { TICKS_PER_MINUTE, perTick } from '../config/constants.js';
import { addEvent, ownedTerritoryCount } from './state.js';
import { expirePings, expireTradeOffers } from './diplomacy.js';
import { XP_REWARDS, awardMatchXp, finaliseMatchXp } from './leader.js';
import { applyEconomyTick, applyPopulationTick } from './economy.js';
import { tickConstruction, tickResearch, tickTraining } from './construction.js';
import { cullEmptyArmies, tickArmies } from './armies.js';
import { resolveCombat } from './combat.js';
/**
 * One simulation step. This is the *entire* game loop — the server calls it every
 * 200 ms and nothing else mutates the match.
 *
 * Order matters and is fixed:
 *   economy → construction → training → research → movement → combat → population
 *   → attrition → elimination → victory
 *
 * Combat runs after movement so an army that arrives this tick fights this tick,
 * and population damage runs after combat so it sees the real contested set.
 */
export function tick(state) {
    if (state.phase !== 'playing')
        return;
    state.tick += 1;
    const bankrupt = applyEconomyTick(state);
    tickConstruction(state);
    tickTraining(state);
    tickResearch(state);
    tickArmies(state);
    const contested = resolveCombat(state);
    applyPopulationTick(state, contested);
    applyAttrition(state, bankrupt);
    expireTradeOffers(state);
    expirePings(state);
    accrueXp(state);
    checkElimination(state);
    checkVictory(state);
}
/** A slow XP drip for holding ground, evaluated once a minute rather than every tick. */
function accrueXp(state) {
    if (state.tick % TICKS_PER_MINUTE !== 0)
        return;
    for (const player of Object.values(state.players)) {
        if (player.eliminatedAtTick !== null)
            continue;
        const held = ownedTerritoryCount(state, player.id);
        if (held > 0)
            awardMatchXp(state, player.id, held * XP_REWARDS.perMinutePerTerritory);
    }
}
/** Runs `n` ticks. Used by tests, the headless balance tool and fast-forward. */
export function tickMany(state, n) {
    for (let i = 0; i < n; i++)
        tick(state);
}
/**
 * Armies you cannot pay for desert. This is the pressure valve that stops players
 * from massing an army they have no economy to support.
 */
function applyAttrition(state, bankrupt) {
    if (bankrupt.size === 0)
        return;
    const lossPerMinute = 0.06;
    for (const army of Object.values(state.armies)) {
        if (!bankrupt.has(army.ownerId))
            continue;
        for (const [unitId, count] of Object.entries(army.units)) {
            if (!count)
                continue;
            const key = unitId;
            army.units[key] = Math.max(0, count * (1 - perTick(lossPerMinute) * state.config.speed));
        }
    }
    cullEmptyArmies(state);
}
function checkElimination(state) {
    for (const player of Object.values(state.players)) {
        if (player.eliminatedAtTick !== null)
            continue;
        if (ownedTerritoryCount(state, player.id) > 0)
            continue;
        const hasArmy = Object.values(state.armies).some((a) => a.ownerId === player.id);
        if (hasArmy)
            continue;
        player.eliminatedAtTick = state.tick;
        addEvent(state, 'player_eliminated', player.id, `${player.name} has been eliminated.`);
    }
}
function checkVictory(state) {
    const totalTerritories = Object.keys(state.territories).length;
    const byTeam = new Map();
    const aliveTeams = new Set();
    for (const player of Object.values(state.players)) {
        if (player.eliminatedAtTick === null)
            aliveTeams.add(player.team);
        const held = ownedTerritoryCount(state, player.id);
        byTeam.set(player.team, (byTeam.get(player.team) ?? 0) + held);
    }
    for (const [team, held] of byTeam) {
        if (held / totalTerritories >= state.config.victoryTerritoryShare) {
            return endMatch(state, team, 'domination');
        }
    }
    // Elimination victory only applies when there was somebody to eliminate. A solo
    // match (sandbox, tutorial, or friends still joining) must not end on tick 1.
    if (byTeam.size >= 2) {
        if (aliveTeams.size === 1) {
            return endMatch(state, [...aliveTeams][0], 'last_standing');
        }
        if (aliveTeams.size === 0) {
            return endMatch(state, null, 'mutual_destruction');
        }
    }
    if (state.config.maxTicks > 0 && state.tick >= state.config.maxTicks) {
        // Time limit: most territory wins.
        let bestTeam = null;
        let best = -1;
        for (const [team, held] of byTeam) {
            if (held > best) {
                best = held;
                bestTeam = team;
            }
        }
        return endMatch(state, bestTeam, 'time_limit');
    }
}
function endMatch(state, winnerTeam, reason) {
    state.phase = 'ended';
    state.winnerTeam = winnerTeam;
    // Commit match XP into the persistent leaders before anyone reads the result.
    finaliseMatchXp(state);
    const winners = Object.values(state.players)
        .filter((p) => p.team === winnerTeam)
        .map((p) => p.name);
    addEvent(state, 'match_ended', null, winnerTeam === null ? 'The world lies in ruins. No victor.' : `Victory: ${winners.join(', ')}.`, { data: { winnerTeam, reason } });
}
//# sourceMappingURL=tick.js.map