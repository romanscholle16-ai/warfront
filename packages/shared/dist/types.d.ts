/**
 * Core data model for the WARFRONT simulation.
 *
 * RULES FOR THIS FILE (and everything under src/sim):
 *  - No engine imports. No DOM. No Node APIs.
 *  - No Date.now(), no Math.random(). Time is `tick`; randomness is the seeded RNG in state.
 *  - Everything is plain JSON-serializable data, so a whole match can be snapshotted with
 *    JSON.stringify for save/resume and replay.
 */
export declare const RESOURCE_KEYS: readonly ["money", "food", "oil", "materials", "research"];
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type Resources = Record<ResourceKey, number>;
/** Partial resource bundle — used for costs, yields and trade offers. */
export type ResourceDelta = Partial<Resources>;
export type Terrain = 'city' | 'plains' | 'mountain' | 'coast' | 'desert' | 'forest' | 'tundra';
export interface TerritoryDef {
    id: string;
    name: string;
    continent: Continent;
    /** Geographic centre, used by the client for equirectangular projection. */
    lon: number;
    lat: number;
    terrain: Terrain;
    /** Population in thousands at match start. */
    basePop: number;
    /** Relative economic weight, 1 = average. */
    baseEcon: number;
    /** Natural resource richness, drives mine/oil yields. */
    resources: {
        oil: number;
        materials: number;
        food: number;
    };
    /** How many buildings this territory can hold. */
    slots: number;
    /** True if the territory touches ocean — required for naval buildings. */
    coastal: boolean;
}
export type Continent = 'north_america' | 'south_america' | 'europe' | 'africa' | 'middle_east' | 'asia' | 'oceania';
/** Terrain kind of the link between two territories. Sea links need naval capacity later. */
export type LinkKind = 'land' | 'sea';
export interface MapDef {
    id: string;
    name: string;
    territories: TerritoryDef[];
    /** Undirected edges, expanded into an adjacency map at load time. */
    edges: Array<[string, string, LinkKind?]>;
    /** Suggested starting territories, in slot order, spread across the globe. */
    starts: string[];
}
export type BuildingCategory = 'economic' | 'military' | 'technology';
export type BuildingType = 'farm' | 'commercial' | 'factory' | 'mine' | 'power_plant' | 'barracks' | 'academy' | 'vehicle_plant' | 'airbase' | 'naval_base' | 'research_center' | 'university' | 'advanced_lab';
export interface BuildingDef {
    id: BuildingType;
    name: string;
    category: BuildingCategory;
    /** Tier names shown in the UI as the building levels up (levels 1-3, 4-7, 8-10). */
    tiers: [string, string, string];
    /** Cost of level 1. Later levels scale by COST_GROWTH ** (level-1). */
    baseCost: ResourceDelta;
    /** Ticks to build level 1; later levels scale by BUILD_TIME_GROWTH. */
    baseBuildTicks: number;
    /** Per-minute yield at level 1, scaled linearly by level. */
    yieldPerMinute?: ResourceDelta;
    /** Flat additive population growth bonus (people/minute per level). */
    popGrowth?: number;
    /** Multiplicative defence bonus for the territory, per level. */
    defenceBonus?: number;
    /** Units this building unlocks for training in its territory. */
    unlocks?: UnitType[];
    /** Terrain restriction; omitted means "anywhere". */
    requiresTerrain?: Terrain[];
    requiresCoastal?: boolean;
    /** Phase 1 buildable set — everything else is defined but gated in the UI. */
    mvp: boolean;
}
export interface BuildingInstance {
    type: BuildingType;
    level: number;
    /** Tick at which the in-progress build/upgrade completes; 0 when idle. */
    completesAtTick: number;
    /** Level being built toward while construction is in progress. */
    targetLevel: number;
}
export type UnitDomain = 'land' | 'air' | 'sea';
export type UnitType = 'rifle' | 'special_forces' | 'marine' | 'tank' | 'apc' | 'fighter' | 'bomber' | 'helicopter' | 'destroyer' | 'carrier' | 'submarine';
export interface UnitDef {
    id: UnitType;
    name: string;
    domain: UnitDomain;
    cost: ResourceDelta;
    /** Manpower (in thousands) consumed from the territory's population. */
    manpower: number;
    /** Resources consumed per minute while the unit is alive. */
    upkeepPerMinute: ResourceDelta;
    trainTicks: number;
    attack: number;
    defence: number;
    hp: number;
    /** Territory links crossed per minute — lower is slower. */
    speed: number;
    /** Damage multiplier against each domain. Missing entry means 1. */
    vs?: Partial<Record<UnitDomain, number>>;
    /** Building (and minimum level) required to train it. */
    requires: {
        building: BuildingType;
        level: number;
    };
    mvp: boolean;
}
export type UnitCounts = Partial<Record<UnitType, number>>;
export type TechTree = 'military' | 'economy' | 'infrastructure' | 'technology';
export interface TechDef {
    id: string;
    tree: TechTree;
    name: string;
    /** 1-10 within its branch; requires the previous level of the same branch. */
    level: number;
    branch: string;
    costResearch: number;
    researchTicks: number;
    effects: Modifiers;
}
/**
 * Multiplicative modifiers, aggregated from leader class + skills + completed tech.
 * 1.0 means "no change". They are recomputed only when something changes, then cached
 * on the player, so the hot tick loop never walks the tech tree.
 */
export interface Modifiers {
    incomeMul?: number;
    foodMul?: number;
    oilMul?: number;
    materialsMul?: number;
    researchMul?: number;
    buildSpeedMul?: number;
    trainSpeedMul?: number;
    unitAttackMul?: number;
    unitDefenceMul?: number;
    unitSpeedMul?: number;
    popGrowthMul?: number;
    upkeepMul?: number;
    /** Diplomatic: trade rate bonus and alliance income share. */
    tradeMul?: number;
}
export type LeaderClass = 'military' | 'economic' | 'scientific' | 'diplomatic';
export interface LeaderAppearance {
    body: number;
    face: number;
    hair: number;
    uniform: string;
    accessory: string;
    flag: string;
    colour: string;
}
export type SkillBranch = 'warfare' | 'economy' | 'intelligence';
export interface Leader {
    name: string;
    class: LeaderClass;
    level: number;
    xp: number;
    /** Points spent per branch, 0-10 each. */
    skills: Record<SkillBranch, number>;
    /** Earned but not yet allocated. */
    skillPoints: number;
    appearance: LeaderAppearance;
}
export interface Player {
    id: string;
    name: string;
    /** Team number; solo players each get a unique team. */
    team: number;
    colour: string;
    leader: Leader;
    resources: Resources;
    /** Net per-minute flow, recomputed each tick for the UI. */
    income: Resources;
    /** Completed tech ids. */
    tech: string[];
    research: {
        techId: string;
        completesAtTick: number;
    } | null;
    /** Cached aggregate of leader + tech effects. */
    modifiers: Required<Modifiers>;
    connected: boolean;
    /** Set when the player is dropped/AI-controlled or eliminated. */
    ai: boolean;
    eliminatedAtTick: number | null;
    /** Confirmed, mutual alliances only. */
    allies: string[];
    /** Player ids who have offered an alliance and are waiting on an answer. */
    allianceOffers: string[];
    /** Alliances broken by this player. Visible to everyone — trust is a resource. */
    betrayals: number;
    /** XP accumulated this match; awarded to the persistent leader when it ends. */
    matchXp: number;
}
export interface Territory {
    id: string;
    ownerId: string | null;
    /** Population in thousands. */
    pop: number;
    /** 0-1; high unrest suppresses income in recently conquered land. */
    unrest: number;
    buildings: BuildingInstance[];
    /** Non-null while an enemy holds the field and a capture timer is running. */
    captureProgress: number;
    captureBy: string | null;
}
export type Stance = 'aggressive' | 'defensive' | 'hold';
export interface Army {
    id: string;
    ownerId: string;
    units: UnitCounts;
    /** Territory the army is standing in, or the origin while moving. */
    at: string;
    /** Destination while moving, else null. */
    movingTo: string | null;
    /** 0-1 along the current link. */
    progress: number;
    stance: Stance;
    /** Queue of territory ids for multi-hop orders. */
    waypoints: string[];
}
export interface TrainingOrder {
    id: string;
    ownerId: string;
    territoryId: string;
    unit: UnitType;
    remaining: number;
    nextCompletesAtTick: number;
}
/**
 * A two-sided trade. Unlike a gift, both halves move at once when accepted, and the
 * offer is validated against the sender's resources at acceptance time — so you cannot
 * promise oil you have already spent.
 */
export interface TradeOffer {
    id: string;
    fromId: string;
    toId: string;
    give: ResourceDelta;
    want: ResourceDelta;
    createdAtTick: number;
    expiresAtTick: number;
}
export type PingKind = 'attack' | 'defend' | 'help';
/** A map marker an ally can see. Expires on its own; never needs a cleanup command. */
export interface MapPing {
    id: string;
    playerId: string;
    territoryId: string;
    kind: PingKind;
    expiresAtTick: number;
}
export interface Battle {
    territoryId: string;
    startedAtTick: number;
    /** Player ids involved, for the UI. */
    attackerIds: string[];
    defenderIds: string[];
    /** Cumulative losses, for the after-action report. */
    losses: Record<string, number>;
}
export type GameEventType = 'match_started' | 'territory_captured' | 'battle_started' | 'battle_ended' | 'building_completed' | 'units_trained' | 'research_completed' | 'player_eliminated' | 'player_disconnected' | 'player_reconnected' | 'alliance_formed' | 'alliance_offered' | 'war_declared' | 'betrayal' | 'trade_offered' | 'trade_completed' | 'trade_declined' | 'leader_level_up' | 'ping' | 'chat' | 'match_ended';
export interface GameEvent {
    tick: number;
    type: GameEventType;
    /** Player this event is most relevant to; null = global. */
    playerId: string | null;
    territoryId?: string;
    text: string;
    data?: Record<string, unknown>;
}
export type MatchPhase = 'lobby' | 'playing' | 'paused' | 'ended';
export type GameMode = 'casual' | 'ranked_1v1' | 'ranked_2v2' | 'ranked_4v4' | 'ffa_8' | 'conquest_10';
export interface MatchConfig {
    mode: GameMode;
    mapId: string;
    /** Multiplies all rates; 1 = normal, 2 = fast friendly match. */
    speed: number;
    /** Fraction of the map a player (or team) must hold to win. */
    victoryTerritoryShare: number;
    /** Hard cap so a match always terminates; 0 = unlimited. */
    maxTicks: number;
    allowPause: boolean;
}
export interface MatchState {
    id: string;
    code: string;
    phase: MatchPhase;
    tick: number;
    config: MatchConfig;
    /** PRNG state — advanced only by the server, which makes matches reproducible. */
    rngState: number;
    players: Record<string, Player>;
    /** Turn order / slot order, also the deterministic command-application order. */
    playerOrder: string[];
    territories: Record<string, Territory>;
    armies: Record<string, Army>;
    training: TrainingOrder[];
    battles: Battle[];
    tradeOffers: TradeOffer[];
    pings: MapPing[];
    events: GameEvent[];
    winnerTeam: number | null;
    nextEntityId: number;
}
//# sourceMappingURL=types.d.ts.map