import { COST_GROWTH, BUILD_TIME_GROWTH } from './constants.js';
/**
 * All 13 buildings across the three categories. `mvp: true` marks the Phase 1
 * buildable set — everything else is fully specified so Phase 2 is a UI change,
 * not a design exercise.
 *
 * Levels 1-10. Tier names change at 4 and 8, which is what the player actually
 * notices ("Basic farming → Industrial farming → AI agriculture").
 */
export const BUILDINGS = {
    // ── economic ────────────────────────────────────────────────────────────
    farm: {
        id: 'farm',
        name: 'Farm',
        category: 'economic',
        tiers: ['Basic Farming', 'Industrial Farming', 'AI Agriculture'],
        baseCost: { money: 200, materials: 120 },
        baseBuildTicks: 90,
        yieldPerMinute: { food: 14 },
        popGrowth: 0.6,
        mvp: true,
    },
    commercial: {
        id: 'commercial',
        name: 'Commercial District',
        category: 'economic',
        tiers: ['Market Town', 'Financial Centre', 'Global Exchange'],
        baseCost: { money: 320, materials: 160 },
        baseBuildTicks: 120,
        yieldPerMinute: { money: 34 },
        mvp: true,
    },
    factory: {
        id: 'factory',
        name: 'Factory',
        category: 'economic',
        tiers: ['Basic Production', 'Advanced Manufacturing', 'Autonomous Plants'],
        baseCost: { money: 380, materials: 220 },
        baseBuildTicks: 150,
        yieldPerMinute: { materials: 11, money: 6 },
        mvp: true,
    },
    mine: {
        id: 'mine',
        name: 'Mining Complex',
        category: 'economic',
        tiers: ['Surface Mining', 'Deep Extraction', 'Automated Drilling'],
        baseCost: { money: 260, materials: 200 },
        baseBuildTicks: 130,
        yieldPerMinute: { materials: 9, oil: 4 },
        requiresTerrain: ['mountain', 'desert', 'tundra', 'forest', 'plains'],
        mvp: false,
    },
    power_plant: {
        id: 'power_plant',
        name: 'Energy Plant',
        category: 'economic',
        tiers: ['Thermal Plant', 'Nuclear Plant', 'Fusion Grid'],
        baseCost: { money: 450, materials: 300, oil: 80 },
        baseBuildTicks: 180,
        yieldPerMinute: { money: 18, materials: 5 },
        mvp: false,
    },
    // ── military ────────────────────────────────────────────────────────────
    barracks: {
        id: 'barracks',
        name: 'Barracks',
        category: 'military',
        tiers: ['Militia Camp', 'Professional Army', 'Integrated Warfare'],
        baseCost: { money: 250, materials: 180 },
        baseBuildTicks: 100,
        defenceBonus: 0.05,
        unlocks: ['rifle', 'marine'],
        mvp: true,
    },
    academy: {
        id: 'academy',
        name: 'Military Academy',
        category: 'military',
        tiers: ['Officer School', 'Combat College', 'Doctrine Institute'],
        baseCost: { money: 500, materials: 260, research: 40 },
        baseBuildTicks: 200,
        defenceBonus: 0.03,
        unlocks: ['special_forces'],
        mvp: false,
    },
    vehicle_plant: {
        id: 'vehicle_plant',
        name: 'Vehicle Factory',
        category: 'military',
        tiers: ['Basic Assembly', 'Advanced Armour', 'Autonomous Manufacturing'],
        baseCost: { money: 620, materials: 420, oil: 60 },
        baseBuildTicks: 240,
        unlocks: ['tank', 'apc'],
        mvp: false,
    },
    airbase: {
        id: 'airbase',
        name: 'Airbase',
        category: 'military',
        tiers: ['Airstrip', 'Air Wing', 'Stealth Command'],
        baseCost: { money: 700, materials: 380, oil: 140 },
        baseBuildTicks: 260,
        unlocks: ['fighter', 'bomber', 'helicopter'],
        mvp: false,
    },
    naval_base: {
        id: 'naval_base',
        name: 'Naval Base',
        category: 'military',
        tiers: ['Harbour', 'Fleet Yard', 'Carrier Command'],
        baseCost: { money: 680, materials: 460, oil: 120 },
        baseBuildTicks: 260,
        requiresCoastal: true,
        unlocks: ['destroyer', 'submarine', 'carrier'],
        mvp: false,
    },
    // ── technology ──────────────────────────────────────────────────────────
    research_center: {
        id: 'research_center',
        name: 'Research Centre',
        category: 'technology',
        tiers: ['Laboratory', 'Research Institute', 'National Science Hub'],
        baseCost: { money: 400, materials: 200 },
        baseBuildTicks: 160,
        yieldPerMinute: { research: 3.2 },
        mvp: true,
    },
    university: {
        id: 'university',
        name: 'University',
        category: 'technology',
        tiers: ['College', 'University', 'Academy of Sciences'],
        baseCost: { money: 520, materials: 240 },
        baseBuildTicks: 200,
        yieldPerMinute: { research: 2.4, money: 8 },
        popGrowth: 0.3,
        mvp: false,
    },
    advanced_lab: {
        id: 'advanced_lab',
        name: 'Advanced Lab',
        category: 'technology',
        tiers: ['Applied Lab', 'Frontier Lab', 'AI Research Cluster'],
        baseCost: { money: 900, materials: 500, research: 120 },
        baseBuildTicks: 300,
        yieldPerMinute: { research: 7 },
        mvp: false,
    },
};
export const BUILDING_LIST = Object.values(BUILDINGS);
export const MVP_BUILDINGS = BUILDING_LIST.filter((b) => b.mvp);
/** Cost of taking a building from `level-1` to `level` (level 1 = initial construction). */
export function buildingCost(type, level) {
    const def = BUILDINGS[type];
    const mul = Math.pow(COST_GROWTH, level - 1);
    const out = {};
    for (const [k, v] of Object.entries(def.baseCost)) {
        out[k] = Math.round(v * mul);
    }
    return out;
}
/** Ticks required to reach `level`, before any build-speed modifiers. */
export function buildingTicks(type, level) {
    return Math.round(BUILDINGS[type].baseBuildTicks * Math.pow(BUILD_TIME_GROWTH, level - 1));
}
/** Per-minute yield of a building at a given level (linear in level). */
export function buildingYield(type, level) {
    const def = BUILDINGS[type];
    if (!def.yieldPerMinute)
        return {};
    const out = {};
    for (const [k, v] of Object.entries(def.yieldPerMinute)) {
        out[k] = v * level;
    }
    return out;
}
/** Human-readable tier name for the level, e.g. farm level 9 → "AI Agriculture". */
export function tierName(type, level) {
    const t = BUILDINGS[type].tiers;
    if (level <= 3)
        return t[0];
    if (level <= 7)
        return t[1];
    return t[2];
}
//# sourceMappingURL=buildings.js.map