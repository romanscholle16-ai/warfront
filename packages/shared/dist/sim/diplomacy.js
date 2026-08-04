import { RESOURCE_KEYS } from '../types.js';
import { TICKS_PER_MINUTE } from '../config/constants.js';
import { addEvent, canAfford, nextId, spend, refund } from './state.js';
/**
 * Diplomacy (M11).
 *
 * Alliances are explicit and two-sided: proposing does nothing on its own, which
 * means an alliance can never be faked and `areFriendly` has exactly one meaning.
 * Breaking one is public and permanent on your record — betrayal should cost
 * something, otherwise there is no tension in agreeing to anything.
 */
export const TRADE_OFFER_LIFETIME_TICKS = Math.round(TICKS_PER_MINUTE * 3);
export const PING_LIFETIME_TICKS = 40; // 8 seconds
/** Unrest inflicted on the betrayer's own territories — the political cost of treachery. */
export const BETRAYAL_UNREST = 0.25;
export function allyBlocker(state, fromId, toId) {
    if (fromId === toId)
        return 'self';
    const from = state.players[fromId];
    const to = state.players[toId];
    if (!from || !to)
        return 'unknown_player';
    if (from.allies.includes(toId))
        return 'already_allied';
    if (to.allianceOffers.includes(fromId))
        return 'already_offered';
    return null;
}
/**
 * Offering to someone who has already offered you accepts instead — so two players
 * who both tap "Ally" at the same time end up allied rather than deadlocked.
 */
export function proposeAlliance(state, fromId, toId) {
    const from = state.players[fromId];
    const to = state.players[toId];
    if (from.allianceOffers.includes(toId)) {
        acceptAlliance(state, fromId, toId);
        return 'formed';
    }
    if (!to.allianceOffers.includes(fromId))
        to.allianceOffers.push(fromId);
    addEvent(state, 'alliance_offered', toId, `${from.name} proposes an alliance.`, { data: { from: fromId } });
    return 'offered';
}
/** `accepterId` accepts the offer standing from `proposerId`. */
export function acceptAlliance(state, accepterId, proposerId) {
    const accepter = state.players[accepterId];
    const proposer = state.players[proposerId];
    if (!accepter || !proposer)
        return false;
    if (!accepter.allianceOffers.includes(proposerId))
        return false;
    accepter.allianceOffers = accepter.allianceOffers.filter((id) => id !== proposerId);
    proposer.allianceOffers = proposer.allianceOffers.filter((id) => id !== accepterId);
    if (!accepter.allies.includes(proposerId))
        accepter.allies.push(proposerId);
    if (!proposer.allies.includes(accepterId))
        proposer.allies.push(accepterId);
    addEvent(state, 'alliance_formed', null, `${proposer.name} and ${accepter.name} have formed an alliance.`, { data: { a: proposerId, b: accepterId } });
    return true;
}
export function declineAlliance(state, declinerId, proposerId) {
    const decliner = state.players[declinerId];
    if (!decliner)
        return;
    decliner.allianceOffers = decliner.allianceOffers.filter((id) => id !== proposerId);
}
/**
 * Breaking an alliance is immediate — there is no "declare war next turn" grace, this
 * is a real-time game — but it scars the betrayer's own nation with unrest, and the
 * betrayal count is public.
 */
export function breakAlliance(state, breakerId, targetId) {
    const breaker = state.players[breakerId];
    const target = state.players[targetId];
    if (!breaker || !target)
        return false;
    if (!breaker.allies.includes(targetId))
        return false;
    breaker.allies = breaker.allies.filter((id) => id !== targetId);
    target.allies = target.allies.filter((id) => id !== breakerId);
    breaker.betrayals += 1;
    for (const territory of Object.values(state.territories)) {
        if (territory.ownerId === breakerId) {
            territory.unrest = Math.min(1, territory.unrest + BETRAYAL_UNREST);
        }
    }
    addEvent(state, 'betrayal', null, `${breaker.name} has betrayed ${target.name}. Their people are uneasy.`, { data: { breaker: breakerId, target: targetId } });
    return true;
}
export const MAX_OPEN_OFFERS_PER_PLAYER = 5;
export function tradeBlocker(state, fromId, toId, give, want) {
    if (fromId === toId)
        return 'self';
    const from = state.players[fromId];
    if (!from || !state.players[toId])
        return 'unknown_player';
    const giveTotal = sumDelta(give);
    const wantTotal = sumDelta(want);
    if (giveTotal <= 0 && wantTotal <= 0)
        return 'empty_offer';
    if (!canAfford(from.resources, give))
        return 'insufficient_resources';
    const open = state.tradeOffers.filter((offer) => offer.fromId === fromId).length;
    if (open >= MAX_OPEN_OFFERS_PER_PLAYER)
        return 'too_many_offers';
    return null;
}
/**
 * The offered goods are escrowed immediately. Without escrow a player could offer the
 * same 1 000 oil to five people and honour none of it.
 */
export function createTradeOffer(state, fromId, toId, give, want) {
    const from = state.players[fromId];
    spend(from.resources, give);
    const offer = {
        id: nextId(state, 'tr'),
        fromId,
        toId,
        give: { ...give },
        want: { ...want },
        createdAtTick: state.tick,
        expiresAtTick: state.tick + TRADE_OFFER_LIFETIME_TICKS,
    };
    state.tradeOffers.push(offer);
    addEvent(state, 'trade_offered', toId, `${from.name} offers you a trade.`, { data: { offerId: offer.id, from: fromId } });
    return offer;
}
export function acceptTradeOffer(state, accepterId, offerId) {
    const index = state.tradeOffers.findIndex((offer) => offer.id === offerId);
    if (index < 0)
        return 'not_found';
    const offer = state.tradeOffers[index];
    if (offer.toId !== accepterId)
        return 'not_recipient';
    const accepter = state.players[accepterId];
    const proposer = state.players[offer.fromId];
    if (!accepter || !proposer)
        return 'not_found';
    if (!canAfford(accepter.resources, offer.want))
        return 'cannot_afford';
    // The proposer's half is already escrowed; only the accepter's half moves now.
    spend(accepter.resources, offer.want);
    refund(proposer.resources, offer.want);
    // Diplomatic leaders get more out of every deal they are party to.
    const rate = Math.max(proposer.modifiers.tradeMul, accepter.modifiers.tradeMul);
    for (const key of RESOURCE_KEYS) {
        const value = offer.give[key];
        if (value !== undefined)
            accepter.resources[key] += value * rate;
    }
    state.tradeOffers.splice(index, 1);
    addEvent(state, 'trade_completed', null, `${proposer.name} and ${accepter.name} completed a trade.`, { data: { from: offer.fromId, to: accepterId, give: offer.give, want: offer.want } });
    return 'accepted';
}
/** Declining or expiring both return the escrowed goods. */
export function cancelTradeOffer(state, offerId, reason) {
    const index = state.tradeOffers.findIndex((offer) => offer.id === offerId);
    if (index < 0)
        return;
    const offer = state.tradeOffers[index];
    const proposer = state.players[offer.fromId];
    if (proposer)
        refund(proposer.resources, offer.give);
    state.tradeOffers.splice(index, 1);
    addEvent(state, 'trade_declined', offer.fromId, reason === 'expired' ? 'A trade offer expired.' : 'Your trade offer was declined.', { data: { offerId } });
}
export function expireTradeOffers(state) {
    for (let i = state.tradeOffers.length - 1; i >= 0; i--) {
        const offer = state.tradeOffers[i];
        if (state.tick >= offer.expiresAtTick)
            cancelTradeOffer(state, offer.id, 'expired');
    }
}
function sumDelta(delta) {
    let total = 0;
    for (const key of RESOURCE_KEYS)
        total += delta[key] ?? 0;
    return total;
}
/** Rejects negative or absurd values before they ever reach the economy. */
export function sanitizeDelta(delta) {
    const out = {};
    for (const key of RESOURCE_KEYS) {
        const value = delta[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
            continue;
        out[key] = Math.floor(Math.min(value, 1_000_000));
    }
    return out;
}
// ── map pings ──────────────────────────────────────────────────────────────
export function addPing(state, playerId, territoryId, kind) {
    // One live ping per player per territory, so spamming the button can't flood allies.
    state.pings = state.pings.filter((p) => !(p.playerId === playerId && p.territoryId === territoryId));
    state.pings.push({
        id: nextId(state, 'pg'),
        playerId,
        territoryId,
        kind,
        expiresAtTick: state.tick + PING_LIFETIME_TICKS,
    });
}
export function expirePings(state) {
    if (state.pings.length === 0)
        return;
    state.pings = state.pings.filter((ping) => state.tick < ping.expiresAtTick);
}
//# sourceMappingURL=diplomacy.js.map