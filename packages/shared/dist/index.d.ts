/**
 * @warfront/shared — the pure game simulation.
 *
 * Imported by BOTH the server (authoritative) and the client (prediction, UI rules,
 * offline/tutorial matches). Contains no engine, network or platform code.
 */
export * from './types.js';
export * from './config/constants.js';
export * from './config/buildings.js';
export * from './config/units.js';
export * from './config/tech.js';
export * from './config/leaders.js';
export * from './data/worldMap.js';
export * from './util/rng.js';
export * from './sim/state.js';
export * from './sim/modifiers.js';
export * from './sim/economy.js';
export * from './sim/construction.js';
export * from './sim/armies.js';
export * from './sim/combat.js';
export * from './sim/commands.js';
export * from './sim/tick.js';
export * from './sim/advisor.js';
export * from './sim/leader.js';
export * from './sim/diplomacy.js';
//# sourceMappingURL=index.d.ts.map