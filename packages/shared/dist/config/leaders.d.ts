import type { Leader, LeaderClass, Modifiers } from '../types.js';
/**
 * Leader classes give a clear identity without being pay-to-win: every bonus is a
 * modest multiplier available to everyone at match start. Cosmetics (appearance,
 * uniform, accessories, flag) never appear in this file — they are client-side data
 * and cannot touch the simulation, which is what keeps monetization cosmetic-only.
 */
export interface LeaderClassDef {
    id: LeaderClass;
    name: string;
    blurb: string;
    /** Applied once at match start. */
    base: Modifiers;
}
export declare const LEADER_CLASSES: Record<LeaderClass, LeaderClassDef>;
/** Per-point effect of each skill-tree branch (max 10 points per branch). */
export declare const LEADER_SKILL_EFFECTS: Record<keyof Leader['skills'], Modifiers>;
export declare const MAX_SKILL_POINTS_PER_BRANCH = 10;
/** Skill points granted per leader level. */
export declare const SKILL_POINTS_PER_LEVEL = 1;
export declare const DEFAULT_APPEARANCE: Leader['appearance'];
export declare function createDefaultLeader(name: string, cls?: LeaderClass): Leader;
export declare function totalSkillPoints(level: number): number;
//# sourceMappingURL=leaders.d.ts.map