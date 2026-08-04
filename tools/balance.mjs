/**
 * Headless balance harness.
 *
 * Runs a full match with scripted "reasonable player" behaviour and prints the
 * economy curve. This is how balance changes get checked before they reach a phone —
 * because the simulation is pure, a 30-minute match runs in well under a second.
 *
 *   node tools/balance.mjs [players] [minutes]
 */
import {
  addPlayer, applyCommand, createMatch, getSuggestions, ownedTerritoryCount,
  playerTerritories, startMatch, tickMany, TICKS_PER_MINUTE,
} from '../packages/shared/dist/index.js';

const playerCount = Number(process.argv[2] ?? 4);
const minutes = Number(process.argv[3] ?? 30);

const state = createMatch('balance-run', 'BAL001');
const classes = ['military', 'economic', 'scientific', 'diplomatic'];
for (let i = 0; i < playerCount; i++) {
  const player = addPlayer(state, `p${i}`, `Player ${i + 1}`);
  player.leader.class = classes[i % classes.length];
}
startMatch(state);

const fmt = (n) => String(Math.round(n)).padStart(7);

console.log(`\nWARFRONT balance run — ${playerCount} players, ${minutes} minutes\n`);
console.log('  min | player   | terr |   money |    food |     oil |   mat |  army | suggestion');
console.log('  ----+----------+------+---------+---------+---------+-------+-------+------------------------');

for (let minute = 1; minute <= minutes; minute++) {
  // Every simulated minute each nation takes the advisor's top suggestion, which is a
  // decent proxy for a competent-but-not-expert human.
  for (const id of state.playerOrder) {
    if (state.players[id].eliminatedAtTick !== null) continue;
    for (const s of getSuggestions(state, id, 3)) {
      if (s.command) applyCommand(state, id, s.command);
    }
    // Keep a trickle of soldiers coming from any barracks.
    for (const territory of playerTerritories(state, id)) {
      const barracks = territory.buildings.find((b) => b.type === 'barracks' && b.level > 0);
      if (barracks) applyCommand(state, id, { t: 'TRAIN', territoryId: territory.id, unit: 'rifle', count: 2 });
    }
  }

  tickMany(state, TICKS_PER_MINUTE);

  if (minute % 5 === 0 || minute === 1) {
    for (const id of state.playerOrder) {
      const p = state.players[id];
      let army = 0;
      for (const a of Object.values(state.armies)) {
        if (a.ownerId !== id) continue;
        for (const n of Object.values(a.units)) army += n ?? 0;
      }
      const top = getSuggestions(state, id, 1)[0];
      console.log(
        `  ${String(minute).padStart(3)} | ${p.name.padEnd(8)} | ${String(ownedTerritoryCount(state, id)).padStart(4)} |`
        + ` ${fmt(p.resources.money)} | ${fmt(p.resources.food)} | ${fmt(p.resources.oil)} |`
        + ` ${fmt(p.resources.materials)} | ${fmt(army)} | ${top ? top.title : '—'}`,
      );
    }
    console.log('  ----+----------+------+---------+---------+---------+-------+-------+------------------------');
  }

  if (state.phase === 'ended') {
    console.log(`\n  Match ended at minute ${minute}. Winning team: ${state.winnerTeam}\n`);
    break;
  }
}

const battles = state.events.filter((e) => e.type === 'battle_started').length;
const captures = state.events.filter((e) => e.type === 'territory_captured').length;
console.log(`\n  ticks simulated: ${state.tick}   battles: ${battles}   captures: ${captures}   armies: ${Object.keys(state.armies).length}\n`);
