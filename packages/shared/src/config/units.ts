import type { UnitDef, UnitType } from '../types.js';

/**
 * The full modern roster. Phase 1 ships the three infantry types (`mvp: true`);
 * the rest are already balanced and wired into the same combat resolver, so
 * enabling them in Phase 2 is a UI gate, not new combat code.
 *
 * Design intent — a counter triangle rather than a power ladder:
 *   infantry hold ground cheaply · armour breaks land lines · air beats armour
 *   · naval projects power along coasts · AA-capable units punish air spam.
 */
export const UNITS: Record<UnitType, UnitDef> = {
  // ── infantry ────────────────────────────────────────────────────────────
  rifle: {
    id: 'rifle',
    name: 'Rifle Infantry',
    domain: 'land',
    cost: { money: 60, materials: 20 },
    manpower: 1,
    upkeepPerMinute: { money: 1.2, food: 0.8 },
    trainTicks: 40,
    attack: 10,
    defence: 12,
    hp: 100,
    speed: 1.0,
    vs: { air: 0.35 },
    requires: { building: 'barracks', level: 1 },
    mvp: true,
  },
  marine: {
    id: 'marine',
    name: 'Marines',
    domain: 'land',
    cost: { money: 110, materials: 40, oil: 10 },
    manpower: 1,
    upkeepPerMinute: { money: 2.2, food: 1.0 },
    trainTicks: 65,
    attack: 15,
    defence: 14,
    hp: 115,
    speed: 1.25, // crosses sea links without a fleet
    vs: { air: 0.4, sea: 0.6 },
    requires: { building: 'barracks', level: 3 },
    mvp: true,
  },
  special_forces: {
    id: 'special_forces',
    name: 'Special Forces',
    domain: 'land',
    cost: { money: 220, materials: 60, oil: 20 },
    manpower: 1,
    upkeepPerMinute: { money: 4.5, food: 1.2 },
    trainTicks: 110,
    attack: 30,
    defence: 20,
    hp: 130,
    speed: 1.5,
    vs: { air: 0.5 },
    requires: { building: 'academy', level: 1 },
    mvp: false, // gated behind the Military Academy, which unlocks in Phase 2
  },

  // ── vehicles ────────────────────────────────────────────────────────────
  apc: {
    id: 'apc',
    name: 'Armoured Vehicles',
    domain: 'land',
    cost: { money: 180, materials: 120, oil: 40 },
    manpower: 1,
    upkeepPerMinute: { money: 3, oil: 1.5 },
    trainTicks: 70,
    attack: 18,
    defence: 24,
    hp: 200,
    speed: 1.4,
    vs: { air: 0.5 },
    requires: { building: 'vehicle_plant', level: 1 },
    mvp: false,
  },
  tank: {
    id: 'tank',
    name: 'Main Battle Tank',
    domain: 'land',
    cost: { money: 420, materials: 300, oil: 110 },
    manpower: 2,
    upkeepPerMinute: { money: 7, oil: 4 },
    trainTicks: 130,
    attack: 46,
    defence: 40,
    hp: 340,
    speed: 1.2,
    vs: { air: 0.25 },
    requires: { building: 'vehicle_plant', level: 3 },
    mvp: false,
  },

  // ── air ─────────────────────────────────────────────────────────────────
  helicopter: {
    id: 'helicopter',
    name: 'Attack Helicopter',
    domain: 'air',
    cost: { money: 400, materials: 200, oil: 140 },
    manpower: 1,
    upkeepPerMinute: { money: 8, oil: 6 },
    trainTicks: 120,
    attack: 42,
    defence: 18,
    hp: 150,
    speed: 2.2,
    vs: { land: 1.6, sea: 0.9 },
    requires: { building: 'airbase', level: 1 },
    mvp: false,
  },
  fighter: {
    id: 'fighter',
    name: 'Fighter Jet',
    domain: 'air',
    cost: { money: 620, materials: 280, oil: 200 },
    manpower: 1,
    upkeepPerMinute: { money: 12, oil: 9 },
    trainTicks: 160,
    attack: 50,
    defence: 30,
    hp: 170,
    speed: 3.0,
    vs: { air: 2.0, land: 0.8 },
    requires: { building: 'airbase', level: 3 },
    mvp: false,
  },
  bomber: {
    id: 'bomber',
    name: 'Strategic Bomber',
    domain: 'air',
    cost: { money: 850, materials: 420, oil: 300 },
    manpower: 2,
    upkeepPerMinute: { money: 18, oil: 14 },
    trainTicks: 220,
    attack: 78,
    defence: 14,
    hp: 210,
    speed: 2.0,
    vs: { land: 1.8, sea: 1.4, air: 0.3 },
    requires: { building: 'airbase', level: 5 },
    mvp: false,
  },

  // ── naval ───────────────────────────────────────────────────────────────
  destroyer: {
    id: 'destroyer',
    name: 'Destroyer',
    domain: 'sea',
    cost: { money: 560, materials: 400, oil: 160 },
    manpower: 2,
    upkeepPerMinute: { money: 10, oil: 7 },
    trainTicks: 170,
    attack: 40,
    defence: 42,
    hp: 400,
    speed: 1.8,
    vs: { sea: 1.3, air: 0.9, land: 0.8 },
    requires: { building: 'naval_base', level: 1 },
    mvp: false,
  },
  submarine: {
    id: 'submarine',
    name: 'Submarine',
    domain: 'sea',
    cost: { money: 720, materials: 460, oil: 200 },
    manpower: 2,
    upkeepPerMinute: { money: 14, oil: 10 },
    trainTicks: 200,
    attack: 66,
    defence: 22,
    hp: 300,
    speed: 1.5,
    vs: { sea: 1.8, air: 0.1, land: 0.3 },
    requires: { building: 'naval_base', level: 4 },
    mvp: false,
  },
  carrier: {
    id: 'carrier',
    name: 'Aircraft Carrier',
    domain: 'sea',
    cost: { money: 1600, materials: 900, oil: 420 },
    manpower: 4,
    upkeepPerMinute: { money: 34, oil: 22 },
    trainTicks: 380,
    attack: 70,
    defence: 55,
    hp: 900,
    speed: 1.3,
    vs: { sea: 1.2, air: 1.4, land: 1.2 },
    requires: { building: 'naval_base', level: 7 },
    mvp: false,
  },
};

export const UNIT_LIST: UnitDef[] = Object.values(UNITS);
export const MVP_UNITS: UnitDef[] = UNIT_LIST.filter((u) => u.mvp);

/** Damage multiplier of `attacker` against a target of `targetDomain`. */
export function counterMultiplier(attacker: UnitType, targetDomain: UnitDef['domain']): number {
  return UNITS[attacker].vs?.[targetDomain] ?? 1;
}
