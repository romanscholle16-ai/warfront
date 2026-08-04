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
export declare const UNITS: Record<UnitType, UnitDef>;
export declare const UNIT_LIST: UnitDef[];
export declare const MVP_UNITS: UnitDef[];
/** Damage multiplier of `attacker` against a target of `targetDomain`. */
export declare function counterMultiplier(attacker: UnitType, targetDomain: UnitDef['domain']): number;
//# sourceMappingURL=units.d.ts.map