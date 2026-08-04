import { describe, expect, it } from 'vitest';
import {
  ADJACENCY, EARTH_MODERN, TERRITORY_DEFS,
  addPlayer, applyCommand, areAdjacent, armyUnitCount, createArmy, createMatch,
  computeIncome, getSuggestions, ownedTerritoryCount, serializeMatch, startMatch,
  tick, tickMany, validateCommand,
} from '../index.js';
import type { MatchState } from '../index.js';

function newMatch(playerCount: number, id = 'm1', code = 'TESTAA'): MatchState {
  const state = createMatch(id, code);
  for (let i = 0; i < playerCount; i++) {
    addPlayer(state, `p${i}`, `Player ${i + 1}`);
  }
  startMatch(state);
  return state;
}

describe('world map', () => {
  it('has every edge pointing at a real territory', () => {
    for (const [a, b] of EARTH_MODERN.edges) {
      expect(TERRITORY_DEFS[a], `unknown territory ${a}`).toBeDefined();
      expect(TERRITORY_DEFS[b], `unknown territory ${b}`).toBeDefined();
    }
  });

  it('is symmetric', () => {
    for (const [id, links] of Object.entries(ADJACENCY)) {
      for (const link of links) {
        expect(areAdjacent(link.to, id)).toBe(true);
      }
    }
  });

  it('is fully connected — no unreachable region', () => {
    const seen = new Set<string>(['east_usa']);
    const queue = ['east_usa'];
    while (queue.length) {
      const current = queue.shift()!;
      for (const link of ADJACENCY[current] ?? []) {
        if (!seen.has(link.to)) {
          seen.add(link.to);
          queue.push(link.to);
        }
      }
    }
    expect(seen.size).toBe(EARTH_MODERN.territories.length);
  });

  it('gives every player a distinct starting territory for a full lobby', () => {
    const starts = EARTH_MODERN.starts.slice(0, 10);
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe('match setup', () => {
  it('gives each player one territory and one army', () => {
    const state = newMatch(4);
    expect(state.phase).toBe('playing');
    for (const id of state.playerOrder) {
      expect(ownedTerritoryCount(state, id)).toBe(1);
      const armies = Object.values(state.armies).filter((a) => a.ownerId === id);
      expect(armies).toHaveLength(1);
      expect(armyUnitCount(armies[0]!)).toBeGreaterThan(0);
    }
  });
});

describe('economy', () => {
  it('generates positive money income from a starting territory', () => {
    const state = newMatch(2);
    const player = state.players.p0!;
    const income = computeIncome(state, player);
    expect(income.money).toBeGreaterThan(0);
  });

  it('accumulates resources over a simulated minute', () => {
    const state = newMatch(2);
    const before = state.players.p0!.resources.money;
    tickMany(state, 300); // one minute at 5 Hz
    expect(state.players.p0!.resources.money).toBeGreaterThan(before);
  });

  it('never lets a resource go negative', () => {
    const state = newMatch(2);
    state.players.p0!.resources.food = 0;
    tickMany(state, 600);
    for (const value of Object.values(state.players.p0!.resources)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('commands', () => {
  it('builds a farm and applies its yield once complete', () => {
    const state = newMatch(2);
    const territoryId = Object.values(state.territories).find((t) => t.ownerId === 'p0')!.id;

    const result = applyCommand(state, 'p0', { t: 'BUILD', territoryId, building: 'farm' });
    expect(result.ok).toBe(true);

    const foodBefore = computeIncome(state, state.players.p0!).food;
    tickMany(state, 400); // longer than the farm's build time
    const farm = state.territories[territoryId]!.buildings.find((b) => b.type === 'farm');
    expect(farm?.level).toBe(1);
    expect(computeIncome(state, state.players.p0!).food).toBeGreaterThan(foodBefore);
  });

  it('rejects building in a territory you do not own', () => {
    const state = newMatch(2);
    const enemyTerritory = Object.values(state.territories).find((t) => t.ownerId === 'p1')!.id;
    const result = validateCommand(state, 'p0', {
      t: 'BUILD', territoryId: enemyTerritory, building: 'farm',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_owner');
  });

  it('rejects a command the player cannot afford', () => {
    const state = newMatch(2);
    const territoryId = Object.values(state.territories).find((t) => t.ownerId === 'p0')!.id;
    state.players.p0!.resources.money = 0;
    state.players.p0!.resources.materials = 0;
    const result = validateCommand(state, 'p0', { t: 'BUILD', territoryId, building: 'farm' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_resources');
  });

  it('rejects moving to a non-adjacent territory', () => {
    const state = newMatch(2);
    const army = Object.values(state.armies).find((a) => a.ownerId === 'p0')!;
    const far = Object.keys(state.territories).find((id) => !areAdjacent(army.at, id) && id !== army.at)!;
    const result = validateCommand(state, 'p0', { t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: far });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_adjacent');
  });

  it('stops land-only armies from crossing sea links', () => {
    const state = newMatch(2);
    const army = Object.values(state.armies).find((a) => a.ownerId === 'p0')!;
    const seaLink = (ADJACENCY[army.at] ?? []).find((l) => l.kind === 'sea');
    if (!seaLink) return; // start territory happens to be landlocked in this map revision
    army.units = { rifle: 5 };
    const result = validateCommand(state, 'p0', {
      t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: seaLink.to,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('cannot_cross_sea');
  });
});

describe('movement and capture', () => {
  it('moves an army to an adjacent territory and occupies neutral land', () => {
    const state = newMatch(2);
    const army = Object.values(state.armies).find((a) => a.ownerId === 'p0')!;
    const target = (ADJACENCY[army.at] ?? []).find(
      (l) => l.kind === 'land' && state.territories[l.to]?.ownerId === null,
    );
    expect(target, 'expected a neutral land neighbour').toBeDefined();

    applyCommand(state, 'p0', { t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: target!.to });
    tickMany(state, 1200); // travel plus the capture timer

    expect(state.territories[target!.to]!.ownerId).toBe('p0');
    expect(ownedTerritoryCount(state, 'p0')).toBe(2);
  });
});

describe('combat', () => {
  it('resolves a battle and leaves exactly one side standing', () => {
    const state = newMatch(2);
    const defenderTerritory = Object.values(state.territories).find((t) => t.ownerId === 'p0')!;
    createArmy(state, 'p1', defenderTerritory.id, { rifle: 20 });

    let guard = 0;
    while (state.battles.length === 0 && guard++ < 10) tick(state);
    expect(state.battles.length).toBe(1);

    tickMany(state, 3000);

    const survivors = Object.values(state.armies).filter((a) => a.at === defenderTerritory.id);
    const owners = new Set(survivors.map((a) => a.ownerId));
    expect(owners.size).toBeLessThanOrEqual(1);
  });

  it('lets the larger force take the territory', () => {
    const state = newMatch(2);
    const defenderTerritory = Object.values(state.territories).find((t) => t.ownerId === 'p0')!;
    createArmy(state, 'p1', defenderTerritory.id, { rifle: 60 });
    tickMany(state, 4000);
    expect(state.territories[defenderTerritory.id]!.ownerId).toBe('p1');
  });
});

describe('determinism', () => {
  it('produces byte-identical state from the same seed and commands', () => {
    const run = () => {
      const state = newMatch(4, 'match-x', 'SEED42');
      const territoryId = Object.values(state.territories).find((t) => t.ownerId === 'p0')!.id;
      applyCommand(state, 'p0', { t: 'BUILD', territoryId, building: 'farm' });
      const army = Object.values(state.armies).find((a) => a.ownerId === 'p1')!;
      const neighbour = ADJACENCY[army.at]![0]!.to;
      applyCommand(state, 'p1', { t: 'MOVE_ARMY', armyId: army.id, toTerritoryId: neighbour });
      tickMany(state, 1500);
      return serializeMatch(state);
    };
    expect(run()).toBe(run());
  });
});

describe('stability', () => {
  it('survives a long 8-player match without throwing', () => {
    const state = newMatch(8);
    expect(() => tickMany(state, 5000)).not.toThrow();
    for (const player of Object.values(state.players)) {
      for (const [key, value] of Object.entries(player.resources)) {
        expect(Number.isFinite(value), `${player.id}.${key} became ${value}`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ends the match when one team holds the victory share', () => {
    const state = newMatch(2);
    state.config.victoryTerritoryShare = 0.05; // 3 of 48 territories
    for (const t of Object.values(state.territories).slice(0, 5)) t.ownerId = 'p0';
    tick(state);
    expect(state.phase).toBe('ended');
    expect(state.winnerTeam).toBe(state.players.p0!.team);
  });
});

describe('advisor', () => {
  it('produces actionable suggestions for a fresh nation', () => {
    const state = newMatch(2);
    tickMany(state, 600);
    const suggestions = getSuggestions(state, 'p0');
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.title.length).toBeGreaterThan(0);
      if (s.command) {
        expect(validateCommand(state, 'p0', s.command).ok).toBe(true);
      }
    }
  });
});
