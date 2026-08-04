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
export function rand(holder: RngHolder): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) | 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Float in [min, max). */
export function randRange(holder: RngHolder, min: number, max: number): number {
  return min + rand(holder) * (max - min);
}

/** Integer in [min, max]. */
export function randInt(holder: RngHolder, min: number, max: number): number {
  return Math.floor(randRange(holder, min, max + 1));
}

export function randPick<T>(holder: RngHolder, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[randInt(holder, 0, items.length - 1)];
}

/** Deterministic in-place shuffle. */
export function shuffle<T>(holder: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(holder, 0, i);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/** Turns an arbitrary string (e.g. a match code) into a usable seed. */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
