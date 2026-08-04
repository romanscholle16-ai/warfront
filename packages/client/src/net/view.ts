import type { ResourceKey, Stance, UnitCounts } from '@warfront/shared';

/**
 * The client's READ-ONLY mirror of the authoritative match.
 *
 * Colyseus sends its schema definition during the handshake, so the client decodes
 * the state without needing the server's schema classes compiled in. These interfaces
 * describe what arrives; nothing here is ever written by the client.
 */

export interface ResourcesView extends Record<ResourceKey, number> {}

export interface AppearanceView {
  body: number;
  face: number;
  hair: number;
  uniform: string;
  accessory: string;
  flag: string;
  colour: string;
}

export interface TradeOfferView {
  id: string;
  fromId: string;
  toId: string;
  /** "money:200,oil:50" */
  give: string;
  want: string;
  expiresAtTick: number;
}

export interface PingView {
  id: string;
  playerId: string;
  territoryId: string;
  kind: 'attack' | 'defend' | 'help';
  expiresAtTick: number;
}

export interface PlayerView {
  id: string;
  name: string;
  team: number;
  colour: string;
  leaderName: string;
  leaderClass: string;
  leaderLevel: number;
  leaderXp: number;
  leaderXpNeeded: number;
  skillPoints: number;
  skillWarfare: number;
  skillEconomy: number;
  skillIntelligence: number;
  betrayals: number;
  matchXp: number;
  /** Comma-separated ids of players offering this player an alliance. */
  allianceOffers: string;
  appearance: AppearanceView;
  ready: boolean;
  connected: boolean;
  ai: boolean;
  eliminated: boolean;
  techCount: number;
  /** Comma-separated completed tech ids. */
  tech: string;
  researchTechId: string;
  researchEndTick: number;
  allies: string;
  resources: ResourcesView;
  income: ResourcesView;
}

export interface BuildingView {
  type: string;
  level: number;
  targetLevel: number;
  completesAtTick: number;
}

export interface TerritoryView {
  id: string;
  ownerId: string;
  pop: number;
  unrest: number;
  captureProgress: number;
  captureBy: string;
  buildings: { length: number; forEach(cb: (b: BuildingView, i: number) => void): void } & Iterable<BuildingView>;
}

export interface ArmyView {
  id: string;
  ownerId: string;
  at: string;
  movingTo: string;
  progress: number;
  stance: Stance;
  units: string;
  total: number;
}

export interface BattleView {
  territoryId: string;
  startedAtTick: number;
}

/** Colyseus MapSchema surface we actually use. */
export interface MapView<T> extends Iterable<[string, T]> {
  size: number;
  get(key: string): T | undefined;
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
  forEach(cb: (value: T, key: string) => void): void;
}

export interface MatchView {
  code: string;
  phase: 'lobby' | 'playing' | 'paused' | 'ended';
  tick: number;
  mode: string;
  mapId: string;
  speed: number;
  hostId: string;
  winnerTeam: number;
  turnPlayer: string | null;
  turnNumber: number;
  turnSecondsRemaining: number;
  turnPhase: string | null;
  turnOrder: string[];
  players: MapView<PlayerView>;
  territories: MapView<TerritoryView>;
  armies: MapView<ArmyView>;
  battles: { length: number } & Iterable<BattleView>;
  tradeOffers: { length: number } & Iterable<TradeOfferView>;
  pings: { length: number } & Iterable<PingView>;
}

/** "money:200,oil:50" → { money: 200, oil: 50 } */
export function decodeDelta(encoded: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!encoded) return out;
  for (const part of encoded.split(',')) {
    const [key, value] = part.split(':');
    if (key && value) out[key] = Number(value);
  }
  return out;
}

/** "rifle:12.5,tank:3" → { rifle: 12.5, tank: 3 } */
export function decodeUnits(encoded: string): UnitCounts {
  const out: UnitCounts = {};
  if (!encoded) return out;
  for (const part of encoded.split(',')) {
    const [unit, count] = part.split(':');
    if (unit && count) out[unit as keyof UnitCounts] = Number(count);
  }
  return out;
}
