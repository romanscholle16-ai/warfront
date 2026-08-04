/**
 * Core data model for the WARFRONT simulation.
 *
 * RULES FOR THIS FILE (and everything under src/sim):
 *  - No engine imports. No DOM. No Node APIs.
 *  - No Date.now(), no Math.random(). Time is `tick`; randomness is the seeded RNG in state.
 *  - Everything is plain JSON-serializable data, so a whole match can be snapshotted with
 *    JSON.stringify for save/resume and replay.
 */
// ─────────────────────────────────────────────────────────── resources ────
export const RESOURCE_KEYS = ['money', 'food', 'oil', 'materials', 'research'];
//# sourceMappingURL=types.js.map