import type {
  Army, GameEvent, GameEventType, Leader, MatchConfig, MatchState,
  Player, ResourceDelta, Resources, Territory, TerritoryDef, UnitCounts,
} from '../types.js';
import { RESOURCE_KEYS } from '../types.js';
import {
  DEFAULT_MATCH_CONFIG, MAX_EVENTS, PLAYER_COLOURS, STARTING_RESOURCES,
} from '../config/constants.js';
import { createDefaultLeader } from '../config/leaders.js';
import { EARTH_MODERN, TERRITORY_DEFS } from '../data/worldMap.js';
import { seedFromString } from '../util/rng.js';
import { computeModifiers } from './modifiers.js';

// ── construction ───────────────────────────────────────────────────────────

export function emptyResources(): Resources {
  return { money: 0, food: 0, oil: 0, materials: 0, research: 0 };
}

export function createMatch(id: string, code: string, config?: Partial<MatchConfig>): MatchState {
  const cfg: MatchConfig = { ...DEFAULT_MATCH_CONFIG, ...config };
  const state: MatchState = {
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

export function addPlayer(
  state: MatchState,
  id: string,
  name: string,
  opts: { team?: number; leader?: Leader } = {},
): Player {
  const slot = state.playerOrder.length;
  const leader = opts.leader ?? createDefaultLeader(name);
  const player: Player = {
    id,
    name,
    team: opts.team ?? slot + 1,
    colour: PLAYER_COLOURS[slot % PLAYER_COLOURS.length]!,
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

export function removePlayer(state: MatchState, id: string): void {
  delete state.players[id];
  state.playerOrder = state.playerOrder.filter((p) => p !== id);
  for (const t of Object.values(state.territories)) {
    if (t.ownerId === id) t.ownerId = null;
  }
  for (const [armyId, army] of Object.entries(state.armies)) {
    if (army.ownerId === id) delete state.armies[armyId];
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
 * `playing`. Starts are taken from the map's pre-spread list so a 2-player match
 * begins on opposite sides of the globe.
 */
export function startMatch(state: MatchState): void {
  if (state.phase !== 'lobby') return;

  const startList = EARTH_MODERN.starts;
  state.playerOrder.forEach((playerId, i) => {
    const territoryId = startList[i % startList.length]!;
    const territory = state.territories[territoryId];
    if (!territory) return;
    territory.ownerId = playerId;
    territory.unrest = 0;

    // A garrison to defend with and a builder economy to start from.
    createArmy(state, playerId, territoryId, { rifle: 6 });
  });

  state.phase = 'playing';
  addEvent(state, 'match_started', null, `The war begins. ${state.playerOrder.length} nations mobilise.`);
}

// ── entities ───────────────────────────────────────────────────────────────

export function nextId(state: MatchState, prefix: string): string {
  return `${prefix}${state.nextEntityId++}`;
}

export function createArmy(
  state: MatchState,
  ownerId: string,
  at: string,
  units: UnitCounts,
): Army {
  const army: Army = {
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
export function garrisonOf(state: MatchState, ownerId: string, territoryId: string): Army | undefined {
  return Object.values(state.armies).find(
    (a) => a.ownerId === ownerId && a.at === territoryId && a.movingTo === null,
  );
}

/** Every army physically standing in a territory (excludes armies in transit). */
export function armiesAt(state: MatchState, territoryId: string): Army[] {
  return Object.values(state.armies).filter((a) => a.at === territoryId && a.movingTo === null);
}

export function armyUnitCount(army: Army): number {
  let total = 0;
  for (const n of Object.values(army.units)) total += n ?? 0;
  return total;
}

export function mergeArmies(target: Army, source: Army): void {
  for (const [unit, n] of Object.entries(source.units)) {
    const key = unit as keyof UnitCounts;
    target.units[key] = (target.units[key] ?? 0) + (n ?? 0);
  }
}

// ── lookups ────────────────────────────────────────────────────────────────

export function territoryDef(id: string): TerritoryDef {
  const def = TERRITORY_DEFS[id];
  if (!def) throw new Error(`Unknown territory: ${id}`);
  return def;
}

export function playerTerritories(state: MatchState, playerId: string): Territory[] {
  return Object.values(state.territories).filter((t) => t.ownerId === playerId);
}

export function ownedTerritoryCount(state: MatchState, playerId: string): number {
  let n = 0;
  for (const t of Object.values(state.territories)) if (t.ownerId === playerId) n++;
  return n;
}

/** Allies share vision and never fight each other. Same team is implicitly allied. */
export function areFriendly(state: MatchState, a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = state.players[a];
  const pb = state.players[b];
  if (!pa || !pb) return false;
  if (pa.team === pb.team) return true;
  return pa.allies.includes(b) && pb.allies.includes(a);
}

// ── resources ──────────────────────────────────────────────────────────────

export function canAfford(resources: Resources, cost: ResourceDelta): boolean {
  for (const key of RESOURCE_KEYS) {
    const need = cost[key];
    if (need !== undefined && resources[key] < need) return false;
  }
  return true;
}

export function spend(resources: Resources, cost: ResourceDelta): void {
  for (const key of RESOURCE_KEYS) {
    const need = cost[key];
    if (need !== undefined) resources[key] -= need;
  }
}

export function refund(resources: Resources, cost: ResourceDelta): void {
  for (const key of RESOURCE_KEYS) {
    const value = cost[key];
    if (value !== undefined) resources[key] += value;
  }
}

/** Which resources are missing, for a UI message like "Need 120 materials". */
export function missingResources(resources: Resources, cost: ResourceDelta): ResourceDelta {
  const out: ResourceDelta = {};
  for (const key of RESOURCE_KEYS) {
    const need = cost[key];
    if (need !== undefined && resources[key] < need) out[key] = Math.ceil(need - resources[key]);
  }
  return out;
}

// ── events ─────────────────────────────────────────────────────────────────

export function addEvent(
  state: MatchState,
  type: GameEventType,
  playerId: string | null,
  text: string,
  extra: Partial<GameEvent> = {},
): void {
  state.events.push({ tick: state.tick, type, playerId, text, ...extra });
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}

// ── serialization ──────────────────────────────────────────────────────────

/** Match state is plain JSON by construction, so save/resume is this one line. */
export function serializeMatch(state: MatchState): string {
  return JSON.stringify(state);
}

export function deserializeMatch(json: string): MatchState {
  return JSON.parse(json) as MatchState;
}
