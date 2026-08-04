import type { MatchState } from '../types.js';
/**
 * Resolves one tick of every ongoing battle and advances territory capture.
 * Returns the set of territory ids that saw fighting this tick — the population
 * model uses it to apply war damage.
 */
export declare function resolveCombat(state: MatchState): Set<string>;
//# sourceMappingURL=combat.d.ts.map