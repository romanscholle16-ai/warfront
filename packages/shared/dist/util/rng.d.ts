/**
 * Mulberry32 — small, fast, deterministic 32-bit PRNG.
 *
 * The generator state lives in MatchState.rngState, not in a closure, so the whole
 * match is a plain serializable object. Same seed + same commands = same match,
 * which gives us replays and desync detection for free.
 */
export interface RngHolder {
    rngState: number;
}
/** Advances the holder's state and returns a float in [0, 1). */
export declare function rand(holder: RngHolder): number;
/** Float in [min, max). */
export declare function randRange(holder: RngHolder, min: number, max: number): number;
/** Integer in [min, max]. */
export declare function randInt(holder: RngHolder, min: number, max: number): number;
export declare function randPick<T>(holder: RngHolder, items: readonly T[]): T | undefined;
/** Deterministic in-place shuffle. */
export declare function shuffle<T>(holder: RngHolder, items: T[]): T[];
/** Turns an arbitrary string (e.g. a match code) into a usable seed. */
export declare function seedFromString(s: string): number;
//# sourceMappingURL=rng.d.ts.map