import type { Leader, MatchState, SkillBranch } from '../types.js';
/**
 * Leader progression (M9).
 *
 * Two hard rules, both of them anti-pay-to-win by construction:
 *  1. XP is earned only by playing — there is no code path that grants it any other way.
 *  2. Everything purchasable (appearance, uniform, accessory, flag) lives in
 *     `Leader.appearance` and is never read by the simulation. Grep for `appearance`
 *     under src/sim: this file is the only match, and it only copies it around.
 */
export declare const SKILL_BRANCHES: SkillBranch[];
/** XP needed to go from `level` to `level + 1`. Deliberately shallow — this is not a grind. */
export declare function xpForNextLevel(level: number): number;
export declare const MAX_LEADER_LEVEL = 30;
/** Applies earned XP, levels up as many times as the XP allows, and grants skill points. */
export declare function grantXp(leader: Leader, amount: number): {
    levelsGained: number;
};
export type SkillBlocker = 'no_points' | 'branch_maxed' | 'unknown_branch';
export declare function skillBlocker(leader: Leader, branch: SkillBranch): SkillBlocker | null;
export declare function spendSkillPoint(leader: Leader, branch: SkillBranch): boolean;
/**
 * In-match XP.
 *
 * Rewards the things the game is actually about — holding ground, winning fights,
 * developing territory — rather than time spent, so an AFK player earns nothing.
 */
export declare const XP_REWARDS: {
    territoryCaptured: number;
    territoryLost: number;
    battleWon: number;
    buildingCompleted: number;
    researchCompleted: number;
    matchWon: number;
    matchPlayed: number;
    /** Per minute, scaled by territories held — a slow drip so a long game pays out. */
    perMinutePerTerritory: number;
};
export declare function awardMatchXp(state: MatchState, playerId: string, amount: number): void;
/**
 * Commits the match's XP into the persistent leader. Called once, at match end — the
 * server then writes the leader back to storage.
 */
export declare function finaliseMatchXp(state: MatchState): void;
//# sourceMappingURL=leader.d.ts.map