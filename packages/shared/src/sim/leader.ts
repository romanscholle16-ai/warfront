import type { Leader, MatchState, SkillBranch } from '../types.js';
import { MAX_SKILL_POINTS_PER_BRANCH, SKILL_POINTS_PER_LEVEL } from '../config/leaders.js';
import { addEvent } from './state.js';
import { refreshModifiers } from './modifiers.js';

/**
 * Leader progression (M9).
 *
 * Two hard rules, both of them anti-pay-to-win by construction:
 *  1. XP is earned only by playing — there is no code path that grants it any other way.
 *  2. Everything purchasable (appearance, uniform, accessory, flag) lives in
 *     `Leader.appearance` and is never read by the simulation. Grep for `appearance`
 *     under src/sim: this file is the only match, and it only copies it around.
 */

export const SKILL_BRANCHES: SkillBranch[] = ['warfare', 'economy', 'intelligence'];

/** XP needed to go from `level` to `level + 1`. Deliberately shallow — this is not a grind. */
export function xpForNextLevel(level: number): number {
  return Math.round(400 * Math.pow(1.35, level - 1));
}

export const MAX_LEADER_LEVEL = 30;

/** Applies earned XP, levels up as many times as the XP allows, and grants skill points. */
export function grantXp(leader: Leader, amount: number): { levelsGained: number } {
  if (amount <= 0) return { levelsGained: 0 };
  leader.xp += amount;
  let levelsGained = 0;

  while (leader.level < MAX_LEADER_LEVEL) {
    const needed = xpForNextLevel(leader.level);
    if (leader.xp < needed) break;
    leader.xp -= needed;
    leader.level += 1;
    leader.skillPoints += SKILL_POINTS_PER_LEVEL;
    levelsGained += 1;
  }
  return { levelsGained };
}

export type SkillBlocker = 'no_points' | 'branch_maxed' | 'unknown_branch';

export function skillBlocker(leader: Leader, branch: SkillBranch): SkillBlocker | null {
  if (!SKILL_BRANCHES.includes(branch)) return 'unknown_branch';
  if (leader.skillPoints < 1) return 'no_points';
  if (leader.skills[branch] >= MAX_SKILL_POINTS_PER_BRANCH) return 'branch_maxed';
  return null;
}

export function spendSkillPoint(leader: Leader, branch: SkillBranch): boolean {
  if (skillBlocker(leader, branch) !== null) return false;
  leader.skills[branch] += 1;
  leader.skillPoints -= 1;
  return true;
}

/**
 * In-match XP.
 *
 * Rewards the things the game is actually about — holding ground, winning fights,
 * developing territory — rather than time spent, so an AFK player earns nothing.
 */
export const XP_REWARDS = {
  territoryCaptured: 60,
  territoryLost: -25,
  battleWon: 40,
  buildingCompleted: 15,
  researchCompleted: 25,
  matchWon: 500,
  matchPlayed: 100,
  /** Per minute, scaled by territories held — a slow drip so a long game pays out. */
  perMinutePerTerritory: 2,
};

export function awardMatchXp(state: MatchState, playerId: string, amount: number): void {
  const player = state.players[playerId];
  if (!player) return;
  player.matchXp = Math.max(0, player.matchXp + amount);
}

/**
 * Commits the match's XP into the persistent leader. Called once, at match end — the
 * server then writes the leader back to storage.
 */
export function finaliseMatchXp(state: MatchState): void {
  for (const player of Object.values(state.players)) {
    const won = state.winnerTeam !== null && player.team === state.winnerTeam;
    const total = player.matchXp
      + XP_REWARDS.matchPlayed
      + (won ? XP_REWARDS.matchWon : 0);

    const { levelsGained } = grantXp(player.leader, total);
    player.matchXp = total;

    if (levelsGained > 0) {
      addEvent(state, 'leader_level_up', player.id,
        `${player.leader.name} reached level ${player.leader.level} (+${levelsGained} skill point${levelsGained > 1 ? 's' : ''}).`,
        { data: { level: player.leader.level, skillPoints: player.leader.skillPoints } });
    }
    // Skill points spent mid-match already refreshed modifiers; do it once more so a
    // level-up gained at the final tick is reflected in the end-of-match summary.
    refreshModifiers(player);
  }
}
