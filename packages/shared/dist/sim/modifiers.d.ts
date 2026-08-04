import type { Leader, Modifiers, Player } from '../types.js';
declare const MODIFIER_KEYS: readonly ["incomeMul", "foodMul", "oilMul", "materialsMul", "researchMul", "buildSpeedMul", "trainSpeedMul", "unitAttackMul", "unitDefenceMul", "unitSpeedMul", "popGrowthMul", "upkeepMul", "tradeMul"];
export type ModifierKey = (typeof MODIFIER_KEYS)[number];
export declare const NEUTRAL_MODIFIERS: Required<Modifiers>;
/**
 * Leader class, skill points and completed tech all contribute *additively* to an
 * accumulator, which then becomes a single multiplier (1 + total).
 *
 * Additive stacking is deliberate: multiplicative stacking across ~130 techs would
 * make late game exponential and impossible to balance. This way a player with every
 * economy tech has a large but predictable advantage.
 */
export declare function computeModifiers(leader: Leader, ownedTech: readonly string[]): Required<Modifiers>;
/** Recompute and cache the player's modifiers. Called only when leader or tech changes. */
export declare function refreshModifiers(player: Player): void;
export {};
//# sourceMappingURL=modifiers.d.ts.map