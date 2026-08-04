import type {
  BuildingType, LeaderAppearance, MatchState, PingKind, ResourceDelta, SkillBranch,
  Stance, UnitCounts, UnitType,
} from '../types.js';
import { RESOURCE_KEYS } from '../types.js';
import { BUILDINGS, buildingCost } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { TECH_BY_ID, techPrerequisite } from '../config/tech.js';
import { COMMAND_RATE_LIMIT_PER_SECOND } from '../config/constants.js';
import {
  addEvent, canAfford, garrisonOf, missingResources, nextId, refund, spend, territoryDef,
} from './state.js';
import {
  beginBuilding, beginTraining, buildingBlocker, nextBuildingLevel, unitBlocker,
} from './construction.js';
import { moveBlocker, orderMove, routeForArmy, splitArmy } from './armies.js';
import { refreshModifiers } from './modifiers.js';
import { skillBlocker, spendSkillPoint } from './leader.js';
import {
  acceptAlliance, acceptTradeOffer, addPing, allyBlocker, breakAlliance, cancelTradeOffer,
  createTradeOffer, declineAlliance, proposeAlliance, sanitizeDelta, tradeBlocker,
} from './diplomacy.js';

/**
 * The complete client → server vocabulary. A client can send nothing else, and the
 * server never trusts anything but these. Adding a feature means adding a case here,
 * which is the property that keeps the game cheat-resistant as it grows.
 */
export type Command =
  | { t: 'BUILD'; territoryId: string; building: BuildingType }
  | { t: 'CANCEL_BUILD'; territoryId: string; building: BuildingType }
  | { t: 'TRAIN'; territoryId: string; unit: UnitType; count: number }
  | { t: 'MOVE_ARMY'; armyId: string; toTerritoryId: string }
  | { t: 'SPLIT_ARMY'; armyId: string; units: UnitCounts; toTerritoryId?: string }
  | { t: 'SET_STANCE'; armyId: string; stance: Stance }
  | { t: 'START_RESEARCH'; techId: string }
  | { t: 'SPEND_SKILL'; branch: SkillBranch }
  | { t: 'SET_APPEARANCE'; appearance: Partial<LeaderAppearance> }
  | { t: 'PROPOSE_ALLY'; targetPlayerId: string }
  | { t: 'ACCEPT_ALLY'; targetPlayerId: string }
  | { t: 'DECLINE_ALLY'; targetPlayerId: string }
  | { t: 'BREAK_ALLY'; targetPlayerId: string }
  | { t: 'TRADE_OFFER'; targetPlayerId: string; give: ResourceDelta; want: ResourceDelta }
  | { t: 'TRADE_ACCEPT'; offerId: string }
  | { t: 'TRADE_DECLINE'; offerId: string }
  | { t: 'PING_MAP'; territoryId: string; kind: PingKind }
  | { t: 'CHAT'; channel: 'all' | 'team'; text: string };

export type CommandType = Command['t'];

export interface CommandResult {
  ok: boolean;
  /** Machine-readable reason, safe to map to a localized string in the UI. */
  reason?: string;
  /** Human-readable fallback, useful during development. */
  message?: string;
}

const OK: CommandResult = { ok: true };
const fail = (reason: string, message?: string): CommandResult => ({ ok: false, reason, message });

/** Cost of a command, before it is charged. Also used by the UI to grey out buttons. */
export function commandCost(state: MatchState, cmd: Command): ResourceDelta {
  switch (cmd.t) {
    case 'BUILD': {
      const territory = state.territories[cmd.territoryId];
      if (!territory) return {};
      return buildingCost(cmd.building, nextBuildingLevel(territory, cmd.building));
    }
    case 'TRAIN': {
      const def = UNITS[cmd.unit];
      if (!def) return {};
      const out: ResourceDelta = {};
      for (const key of RESOURCE_KEYS) {
        const v = def.cost[key];
        if (v !== undefined) out[key] = v * cmd.count;
      }
      return out;
    }
    case 'START_RESEARCH': {
      const tech = TECH_BY_ID[cmd.techId];
      return tech ? { research: tech.costResearch } : {};
    }
    // TRADE_OFFER is intentionally absent: the offered goods are escrowed by
    // createTradeOffer, and charging here too would take them twice.
    default:
      return {};
  }
}

/**
 * Pure validation — never mutates. The server calls this before applying, and the
 * client calls the same function to disable impossible actions in the UI.
 */
export function validateCommand(state: MatchState, playerId: string, cmd: Command): CommandResult {
  // Cosmetic identity may be set while still in the lobby (character customisation on
  // the ready-up screen); every other command needs a running match.
  if (state.phase !== 'playing' && cmd.t !== 'SET_APPEARANCE') return fail('match_not_running');
  const player = state.players[playerId];
  if (!player) return fail('unknown_player');
  if (player.eliminatedAtTick !== null) return fail('eliminated');

  const cost = commandCost(state, cmd);
  if (!canAfford(player.resources, cost)) {
    const missing = missingResources(player.resources, cost);
    return fail('insufficient_resources', describeMissing(missing));
  }

  switch (cmd.t) {
    case 'BUILD': {
      const def = BUILDINGS[cmd.building];
      if (!def) return fail('unknown_building');
      const blocker = buildingBlocker(state, playerId, cmd.territoryId, cmd.building);
      return blocker ? fail(blocker) : OK;
    }

    case 'CANCEL_BUILD': {
      const territory = state.territories[cmd.territoryId];
      if (!territory || territory.ownerId !== playerId) return fail('not_owner');
      const b = territory.buildings.find((x) => x.type === cmd.building);
      if (!b || b.completesAtTick === 0) return fail('nothing_in_progress');
      return OK;
    }

    case 'TRAIN': {
      if (!Number.isInteger(cmd.count) || cmd.count < 1 || cmd.count > 50) return fail('bad_count');
      const blocker = unitBlocker(state, playerId, cmd.territoryId, cmd.unit, cmd.count);
      return blocker ? fail(blocker) : OK;
    }

    case 'MOVE_ARMY': {
      const army = state.armies[cmd.armyId];
      if (!army) return fail('unknown_army');
      if (army.ownerId !== playerId) return fail('not_owner');
      const blocker = moveBlocker(state, army, cmd.toTerritoryId);
      if (!blocker) return OK;
      // A non-adjacent click is valid only when the authoritative server can find a
      // legal route across the player's own conquered territory.
      return routeForArmy(state, army, cmd.toTerritoryId) ? OK : fail(blocker);
    }

    case 'SPLIT_ARMY': {
      const army = state.armies[cmd.armyId];
      if (!army) return fail('unknown_army');
      if (army.ownerId !== playerId) return fail('not_owner');
      if (army.movingTo !== null) return fail('already_moving');
      let requested = 0;
      for (const [unitId, n] of Object.entries(cmd.units)) {
        const have = army.units[unitId as UnitType] ?? 0;
        if ((n ?? 0) > have) return fail('not_enough_units');
        requested += n ?? 0;
      }
      if (requested <= 0) return fail('empty_split');
      if (cmd.toTerritoryId) {
        const probe = { ...army, units: cmd.units, id: 'probe' };
        const blocker = moveBlocker(state, probe, cmd.toTerritoryId);
        if (blocker) return fail(blocker);
      }
      return OK;
    }

    case 'SET_STANCE': {
      const army = state.armies[cmd.armyId];
      if (!army) return fail('unknown_army');
      if (army.ownerId !== playerId) return fail('not_owner');
      return OK;
    }

    case 'START_RESEARCH': {
      const tech = TECH_BY_ID[cmd.techId];
      if (!tech) return fail('unknown_tech');
      if (player.research) return fail('already_researching');
      if (player.tech.includes(cmd.techId)) return fail('already_known');
      const prereq = techPrerequisite(cmd.techId);
      if (prereq && !player.tech.includes(prereq)) return fail('missing_prerequisite');
      return OK;
    }

    case 'SPEND_SKILL': {
      const blocker = skillBlocker(player.leader, cmd.branch);
      return blocker ? fail(blocker) : OK;
    }

    case 'SET_APPEARANCE': {
      // Purely cosmetic, so the only rule is that it must be well-formed.
      if (!cmd.appearance || typeof cmd.appearance !== 'object') return fail('malformed');
      return OK;
    }

    case 'PROPOSE_ALLY': {
      const blocker = allyBlocker(state, playerId, cmd.targetPlayerId);
      return blocker ? fail(blocker) : OK;
    }

    case 'ACCEPT_ALLY':
    case 'DECLINE_ALLY': {
      if (!player.allianceOffers.includes(cmd.targetPlayerId)) return fail('no_such_offer');
      return OK;
    }

    case 'BREAK_ALLY': {
      const target = state.players[cmd.targetPlayerId];
      if (!target || target.id === playerId) return fail('unknown_player');
      if (!player.allies.includes(cmd.targetPlayerId)) return fail('not_allied');
      return OK;
    }

    case 'TRADE_OFFER': {
      const give = sanitizeDelta(cmd.give);
      const want = sanitizeDelta(cmd.want);
      const blocker = tradeBlocker(state, playerId, cmd.targetPlayerId, give, want);
      return blocker ? fail(blocker) : OK;
    }

    case 'TRADE_ACCEPT': {
      const offer = state.tradeOffers.find((o) => o.id === cmd.offerId);
      if (!offer) return fail('no_such_offer');
      if (offer.toId !== playerId) return fail('not_recipient');
      if (!canAfford(player.resources, offer.want)) return fail('insufficient_resources');
      return OK;
    }

    case 'TRADE_DECLINE': {
      const offer = state.tradeOffers.find((o) => o.id === cmd.offerId);
      if (!offer) return fail('no_such_offer');
      if (offer.toId !== playerId && offer.fromId !== playerId) return fail('not_recipient');
      return OK;
    }

    case 'PING_MAP': {
      if (!state.territories[cmd.territoryId]) return fail('unknown_territory');
      if (!['attack', 'defend', 'help'].includes(cmd.kind)) return fail('malformed');
      return OK;
    }

    case 'CHAT': {
      if (!cmd.text.trim()) return fail('empty_message');
      if (cmd.text.length > 200) return fail('message_too_long');
      return OK;
    }

    default:
      return fail('unknown_command');
  }
}

/**
 * Applies a command. MUST be preceded by `validateCommand` — `applyCommand` re-validates
 * anyway, so a caller that forgets cannot corrupt the match.
 */
export function applyCommand(state: MatchState, playerId: string, cmd: Command): CommandResult {
  const check = validateCommand(state, playerId, cmd);
  if (!check.ok) return check;

  const player = state.players[playerId]!;
  spend(player.resources, commandCost(state, cmd));

  switch (cmd.t) {
    case 'BUILD': {
      const territory = state.territories[cmd.territoryId]!;
      beginBuilding(state, territory, cmd.building, player.modifiers.buildSpeedMul);
      return OK;
    }

    case 'CANCEL_BUILD': {
      const territory = state.territories[cmd.territoryId]!;
      const b = territory.buildings.find((x) => x.type === cmd.building)!;
      // Half refund, the standard RTS anti-abuse rate.
      const paid = buildingCost(cmd.building, b.targetLevel);
      for (const key of RESOURCE_KEYS) if (paid[key] !== undefined) paid[key]! *= 0.5;
      refund(player.resources, paid);
      b.completesAtTick = 0;
      b.targetLevel = b.level;
      if (b.level === 0) {
        territory.buildings = territory.buildings.filter((x) => x !== b);
      }
      return OK;
    }

    case 'TRAIN': {
      beginTraining(state, playerId, cmd.territoryId, cmd.unit, cmd.count, player.modifiers.trainSpeedMul);
      return OK;
    }

    case 'MOVE_ARMY': {
      const army = state.armies[cmd.armyId]!;
      const route = routeForArmy(state, army, cmd.toTerritoryId);
      if (route) {
        const [first, ...waypoints] = route;
        orderMove(state, army, first!);
        army.waypoints = waypoints;
      } else {
        orderMove(state, army, cmd.toTerritoryId);
      }
      return OK;
    }

    case 'SPLIT_ARMY': {
      const army = state.armies[cmd.armyId]!;
      const created = splitArmy(state, army, cmd.units, nextId(state, 'a'));
      if (!created) return fail('empty_split');
      if (cmd.toTerritoryId && moveBlocker(state, created, cmd.toTerritoryId) === null) {
        orderMove(state, created, cmd.toTerritoryId);
      }
      return OK;
    }

    case 'SET_STANCE': {
      state.armies[cmd.armyId]!.stance = cmd.stance;
      return OK;
    }

    case 'START_RESEARCH': {
      const tech = TECH_BY_ID[cmd.techId]!;
      const ticks = Math.max(1, Math.round(
        tech.researchTicks / player.modifiers.researchMul / state.config.speed,
      ));
      player.research = { techId: cmd.techId, completesAtTick: state.tick + ticks };
      return OK;
    }

    case 'SPEND_SKILL': {
      if (!spendSkillPoint(player.leader, cmd.branch)) return fail('no_points');
      refreshModifiers(player);
      return OK;
    }

    case 'SET_APPEARANCE': {
      // Cosmetics never reach the simulation — this writes to a field no sim rule reads.
      player.leader.appearance = { ...player.leader.appearance, ...cmd.appearance };
      return OK;
    }

    case 'PROPOSE_ALLY': {
      proposeAlliance(state, playerId, cmd.targetPlayerId);
      return OK;
    }

    case 'ACCEPT_ALLY': {
      acceptAlliance(state, playerId, cmd.targetPlayerId);
      return OK;
    }

    case 'DECLINE_ALLY': {
      declineAlliance(state, playerId, cmd.targetPlayerId);
      return OK;
    }

    case 'BREAK_ALLY': {
      breakAlliance(state, playerId, cmd.targetPlayerId);
      return OK;
    }

    case 'TRADE_OFFER': {
      createTradeOffer(state, playerId, cmd.targetPlayerId,
        sanitizeDelta(cmd.give), sanitizeDelta(cmd.want));
      return OK;
    }

    case 'TRADE_ACCEPT': {
      const result = acceptTradeOffer(state, playerId, cmd.offerId);
      return result === 'accepted' ? OK : fail(result);
    }

    case 'TRADE_DECLINE': {
      cancelTradeOffer(state, cmd.offerId, 'declined');
      return OK;
    }

    case 'PING_MAP': {
      addPing(state, playerId, cmd.territoryId, cmd.kind);
      return OK;
    }

    case 'CHAT': {
      addEvent(state, 'chat', cmd.channel === 'team' ? playerId : null, cmd.text.slice(0, 200),
        { data: { from: playerId, channel: cmd.channel, team: player.team } });
      return OK;
    }

    default:
      return fail('unknown_command');
  }
}

function describeMissing(missing: ResourceDelta): string {
  const parts: string[] = [];
  for (const key of RESOURCE_KEYS) {
    const v = missing[key];
    if (v) parts.push(`${v} ${key}`);
  }
  return parts.length ? `Need ${parts.join(', ')}` : 'Insufficient resources';
}

// ── rate limiting ──────────────────────────────────────────────────────────

/**
 * Token bucket, one per connection. Lives here (not in the server) so any transport —
 * WebSocket now, anything later — gets the same protection.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity = COMMAND_RATE_LIMIT_PER_SECOND,
    private readonly refillPerSecond = COMMAND_RATE_LIMIT_PER_SECOND,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = 0;
  }

  /** `nowMs` is passed in — the sim package never reads the clock itself. */
  allow(nowMs: number): boolean {
    if (this.lastRefillMs === 0) this.lastRefillMs = nowMs;
    const elapsed = (nowMs - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefillMs = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
