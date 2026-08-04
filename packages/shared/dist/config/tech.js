import { MAX_TECH_LEVEL } from './constants.js';
const BRANCHES = [
    // ── military ────────────────────────────────────────────────────────────
    { tree: 'military', branch: 'infantry', label: 'Infantry Doctrine',
        names: ['Small Arms', 'Combined Arms', 'Networked Infantry'],
        baseCost: 40, baseTicks: 200, perLevel: { unitAttackMul: 0.04, unitDefenceMul: 0.03 } },
    { tree: 'military', branch: 'vehicles', label: 'Armoured Warfare',
        names: ['Mechanisation', 'Composite Armour', 'Autonomous Armour'],
        baseCost: 55, baseTicks: 240, perLevel: { unitAttackMul: 0.05, unitSpeedMul: 0.02 } },
    { tree: 'military', branch: 'aircraft', label: 'Air Power',
        names: ['Air Superiority', 'Precision Strike', 'Stealth Doctrine'],
        baseCost: 70, baseTicks: 280, perLevel: { unitAttackMul: 0.055 } },
    { tree: 'military', branch: 'naval', label: 'Naval Doctrine',
        names: ['Blue Water Navy', 'Missile Cruisers', 'Autonomous Fleets'],
        baseCost: 65, baseTicks: 270, perLevel: { unitDefenceMul: 0.05, unitSpeedMul: 0.02 } },
    // ── economy ─────────────────────────────────────────────────────────────
    { tree: 'economy', branch: 'agriculture', label: 'Agriculture',
        names: ['Crop Rotation', 'Green Revolution', 'Vertical Farming'],
        baseCost: 35, baseTicks: 180, perLevel: { foodMul: 0.07, popGrowthMul: 0.03 } },
    { tree: 'economy', branch: 'industry', label: 'Industry',
        names: ['Mass Production', 'Lean Manufacturing', 'Dark Factories'],
        baseCost: 45, baseTicks: 210, perLevel: { materialsMul: 0.07, oilMul: 0.04 } },
    { tree: 'economy', branch: 'finance', label: 'Finance',
        names: ['Central Banking', 'Capital Markets', 'Algorithmic Trading'],
        baseCost: 50, baseTicks: 220, perLevel: { incomeMul: 0.07, tradeMul: 0.05 } },
    // ── infrastructure ──────────────────────────────────────────────────────
    { tree: 'infrastructure', branch: 'construction', label: 'Construction',
        names: ['Prefabrication', 'Modular Building', 'Robotic Construction'],
        baseCost: 40, baseTicks: 190, perLevel: { buildSpeedMul: 0.06 } },
    { tree: 'infrastructure', branch: 'population', label: 'Public Health',
        names: ['Sanitation', 'National Health', 'Genomic Medicine'],
        baseCost: 38, baseTicks: 200, perLevel: { popGrowthMul: 0.08 } },
    { tree: 'infrastructure', branch: 'logistics', label: 'Logistics',
        names: ['Rail Networks', 'Containerisation', 'Predictive Supply'],
        baseCost: 42, baseTicks: 200, perLevel: { unitSpeedMul: 0.05, upkeepMul: -0.03 } },
    // ── technology ──────────────────────────────────────────────────────────
    { tree: 'technology', branch: 'ai', label: 'Artificial Intelligence',
        names: ['Machine Learning', 'Autonomous Systems', 'Strategic AI'],
        baseCost: 60, baseTicks: 260, perLevel: { researchMul: 0.06, buildSpeedMul: 0.02 } },
    { tree: 'technology', branch: 'weapons', label: 'Advanced Weapons',
        names: ['Guided Munitions', 'Hypersonics', 'Directed Energy'],
        baseCost: 80, baseTicks: 300, perLevel: { unitAttackMul: 0.06 } },
    { tree: 'technology', branch: 'automation', label: 'Automation',
        names: ['Industrial Robotics', 'Smart Grids', 'Full Automation'],
        baseCost: 70, baseTicks: 280, perLevel: { materialsMul: 0.05, incomeMul: 0.04, upkeepMul: -0.02 } },
];
function nameFor(b, level) {
    const idx = level <= 3 ? 0 : level <= 7 ? 1 : 2;
    return `${b.names[idx]} ${romanNumeral(level)}`;
}
function romanNumeral(n) {
    const table = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return table[n - 1] ?? String(n);
}
function buildTechList() {
    const out = [];
    for (const b of BRANCHES) {
        for (let level = 1; level <= MAX_TECH_LEVEL; level++) {
            const scale = Math.pow(1.45, level - 1);
            out.push({
                id: `${b.tree}.${b.branch}.${level}`,
                tree: b.tree,
                branch: b.branch,
                name: nameFor(b, level),
                level,
                costResearch: Math.round(b.baseCost * scale),
                researchTicks: Math.round(b.baseTicks * Math.pow(1.18, level - 1)),
                effects: b.perLevel,
            });
        }
    }
    return out;
}
export const TECHS = buildTechList();
export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));
export const TECH_BRANCHES = BRANCHES.map(({ tree, branch, label }) => ({ tree, branch, label }));
/** The tech that must be completed before `techId` becomes available (null for level 1). */
export function techPrerequisite(techId) {
    const t = TECH_BY_ID[techId];
    if (!t || t.level === 1)
        return null;
    return `${t.tree}.${t.branch}.${t.level - 1}`;
}
/** Every tech the player could start right now, given what they already own. */
export function availableTechs(owned) {
    const ownedSet = new Set(owned);
    return TECHS.filter((t) => {
        if (ownedSet.has(t.id))
            return false;
        const prereq = techPrerequisite(t.id);
        return prereq === null || ownedSet.has(prereq);
    });
}
//# sourceMappingURL=tech.js.map