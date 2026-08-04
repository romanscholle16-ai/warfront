import type { MatchState, PingKind, ResourceDelta, TradeOffer } from '../types.js';
/**
 * Diplomacy (M11).
 *
 * Alliances are explicit and two-sided: proposing does nothing on its own, which
 * means an alliance can never be faked and `areFriendly` has exactly one meaning.
 * Breaking one is public and permanent on your record — betrayal should cost
 * something, otherwise there is no tension in agreeing to anything.
 */
export declare const TRADE_OFFER_LIFETIME_TICKS: number;
export declare const PING_LIFETIME_TICKS = 40;
/** Unrest inflicted on the betrayer's own territories — the political cost of treachery. */
export declare const BETRAYAL_UNREST = 0.25;
export type AllyBlocker = 'unknown_player' | 'already_allied' | 'already_offered' | 'self';
export declare function allyBlocker(state: MatchState, fromId: string, toId: string): AllyBlocker | null;
/**
 * Offering to someone who has already offered you accepts instead — so two players
 * who both tap "Ally" at the same time end up allied rather than deadlocked.
 */
export declare function proposeAlliance(state: MatchState, fromId: string, toId: string): 'formed' | 'offered';
/** `accepterId` accepts the offer standing from `proposerId`. */
export declare function acceptAlliance(state: MatchState, accepterId: string, proposerId: string): boolean;
export declare function declineAlliance(state: MatchState, declinerId: string, proposerId: string): void;
/**
 * Breaking an alliance is immediate — there is no "declare war next turn" grace, this
 * is a real-time game — but it scars the betrayer's own nation with unrest, and the
 * betrayal count is public.
 */
export declare function breakAlliance(state: MatchState, breakerId: string, targetId: string): boolean;
export type TradeBlocker = 'unknown_player' | 'self' | 'empty_offer' | 'too_many_offers' | 'insufficient_resources';
export declare const MAX_OPEN_OFFERS_PER_PLAYER = 5;
export declare function tradeBlocker(state: MatchState, fromId: string, toId: string, give: ResourceDelta, want: ResourceDelta): TradeBlocker | null;
/**
 * The offered goods are escrowed immediately. Without escrow a player could offer the
 * same 1 000 oil to five people and honour none of it.
 */
export declare function createTradeOffer(state: MatchState, fromId: string, toId: string, give: ResourceDelta, want: ResourceDelta): TradeOffer;
export type AcceptTradeResult = 'accepted' | 'not_found' | 'not_recipient' | 'cannot_afford';
export declare function acceptTradeOffer(state: MatchState, accepterId: string, offerId: string): AcceptTradeResult;
/** Declining or expiring both return the escrowed goods. */
export declare function cancelTradeOffer(state: MatchState, offerId: string, reason: 'declined' | 'expired'): void;
export declare function expireTradeOffers(state: MatchState): void;
/** Rejects negative or absurd values before they ever reach the economy. */
export declare function sanitizeDelta(delta: ResourceDelta): ResourceDelta;
export declare function addPing(state: MatchState, playerId: string, territoryId: string, kind: PingKind): void;
export declare function expirePings(state: MatchState): void;
//# sourceMappingURL=diplomacy.d.ts.map