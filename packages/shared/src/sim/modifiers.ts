import type { Leader, Modifiers, Player } from '../types.js';
import { LEADER_CLASSES, LEADER_SKILL_EFFECTS } from '../config/leaders.js';
import { TECH_BY_ID } from '../config/tech.js';

const MODIFIER_KEYS = [
  'incomeMul', 'foodMul', 'oilMul', 'materialsMul', 'researchMul',
  'buildSpeedMul', 'trainSpeedMul', 'unitAttackMul', 'unitDefenceMul',
  'unitSpeedMul', 'popGrowthMul', 'upkeepMul', 'tradeMul',
] as const satisfies readonly (keyof Modifiers)[];

export type ModifierKey = (typeof MODIFIER_KEYS)[number];

export const NEUTRAL_MODIFIERS: Required<Modifiers> = Object.fromEntries(
  MODIFIER_KEYS.map((k) => [k, 1]),
) as Required<Modifiers>;

/**
 * Leader class, skill points and completed tech all contribute *additively* to an
 * accumulator, which then becomes a single multiplier (1 + total).
 *
 * Additive stacking is deliberate: multiplicative stacking across ~130 techs would
 * make late game exponential and impossible to balance. This way a player with every
 * economy tech has a large but predictable advantage.
 */
export function computeModifiers(leader: Leader, ownedTech: readonly string[]): Required<Modifiers> {
  const acc: Record<string, number> = {};
  for (const k of MODIFIER_KEYS) acc[k] = 0;

  const add = (m: Modifiers | undefined, scale = 1) => {
    if (!m) return;
    for (const k of MODIFIER_KEYS) {
      const v = m[k];
      if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v * scale;
    }
  };

  add(LEADER_CLASSES[leader.class]?.base);

  for (const [branch, points] of Object.entries(leader.skills)) {
    const effect = LEADER_SKILL_EFFECTS[branch as keyof Leader['skills']];
    add(effect, points);
  }

  for (const techId of ownedTech) {
    add(TECH_BY_ID[techId]?.effects);
  }

  const out: Record<string, number> = {};
  for (const k of MODIFIER_KEYS) {
    // Floor at 0.1 so a pathological stack of negative modifiers can never invert a value.
    out[k] = Math.max(0.1, 1 + (acc[k] ?? 0));
  }
  return out as Required<Modifiers>;
}

/** Recompute and cache the player's modifiers. Called only when leader or tech changes. */
export function refreshModifiers(player: Player): void {
  player.modifiers = computeModifiers(player.leader, player.tech);
}
