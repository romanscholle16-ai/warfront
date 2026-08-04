export const LEADER_CLASSES = {
    military: {
        id: 'military',
        name: 'Military Commander',
        blurb: 'Stronger armies and faster training. Win by taking ground early.',
        base: { unitAttackMul: 0.12, unitDefenceMul: 0.08, trainSpeedMul: 0.15 },
    },
    economic: {
        id: 'economic',
        name: 'Economic Leader',
        blurb: 'Higher income and faster construction. Out-build the world.',
        base: { incomeMul: 0.15, buildSpeedMul: 0.18, materialsMul: 0.08 },
    },
    scientific: {
        id: 'scientific',
        name: 'Scientific Leader',
        blurb: 'Faster research. Reach late-game technology first.',
        base: { researchMul: 0.25, buildSpeedMul: 0.05 },
    },
    diplomatic: {
        id: 'diplomatic',
        name: 'Diplomatic Leader',
        blurb: 'Better alliances and trade. Strongest with friends.',
        base: { tradeMul: 0.3, incomeMul: 0.06, upkeepMul: -0.08 },
    },
};
/** Per-point effect of each skill-tree branch (max 10 points per branch). */
export const LEADER_SKILL_EFFECTS = {
    warfare: { unitAttackMul: 0.02, unitDefenceMul: 0.015 },
    economy: { incomeMul: 0.02, foodMul: 0.015, materialsMul: 0.015 },
    intelligence: { researchMul: 0.025, buildSpeedMul: 0.01 },
};
export const MAX_SKILL_POINTS_PER_BRANCH = 10;
/** Skill points granted per leader level. */
export const SKILL_POINTS_PER_LEVEL = 1;
export const DEFAULT_APPEARANCE = {
    body: 0,
    face: 0,
    hair: 0,
    uniform: 'standard',
    accessory: 'none',
    flag: 'plain',
    colour: '#e8493f',
};
export function createDefaultLeader(name, cls = 'military') {
    return {
        name,
        class: cls,
        level: 1,
        xp: 0,
        skills: { warfare: 0, economy: 0, intelligence: 0 },
        skillPoints: 0,
        appearance: { ...DEFAULT_APPEARANCE },
    };
}
export function totalSkillPoints(level) {
    return (level - 1) * SKILL_POINTS_PER_LEVEL;
}
//# sourceMappingURL=leaders.js.map