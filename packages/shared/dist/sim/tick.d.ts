import type { MatchState } from '../types.js';
/**
 * One simulation step. This is the *entire* game loop — the server calls it every
 * 200 ms and nothing else mutates the match.
 *
 * Order matters and is fixed:
 *   economy → construction → training → research → movement → combat → population
 *   → attrition → elimination → victory
 *
 * Combat runs after movement so an army that arrives this tick fights this tick,
 * and population damage runs after combat so it sees the real contested set.
 */
export declare function tick(state: MatchState): void;
/** Runs `n` ticks. Used by tests, the headless balance tool and fast-forward. */
export declare function tickMany(state: MatchState, n: number): void;
//# sourceMappingURL=tick.d.ts.map