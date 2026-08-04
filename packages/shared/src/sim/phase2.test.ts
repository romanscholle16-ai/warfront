import { describe, expect, it } from 'vitest';
import {
  ADJACENCY, MAX_SKILL_POINTS_PER_BRANCH, TERRITORY_DEFS, UNITS,
  acceptTradeOffer, addPlayer, applyCommand, areFriendly, bestAvailableUnit,
  buildingsForTerritory, createArmy, createMatch, expirePings, expireTradeOffers,
  grantXp, hasGroundForce, legalDestinations, moveBlocker, startMatch, tickMany,
  traverseBlocker, unlockedUnits, validateCommand, xpForNextLevel,
} from '../index.js';
import type { MatchState } from '../index.js';

function newMatch(playerCount = 2, id = 'p2', code = 'PHASE2'): MatchState {
  const state = createMatch(id, code);
  for (let i = 0; i < playerCount; i++) addPlayer(state, `p${i}`, `Player ${i + 1}`);
  startMatch(state);
  return state;
}

/** Gives a player a building at a level, bypassing the construction queue. */
function grantBuilding(state: MatchState, territoryId: string, type: string, level: number): void {
  const territory = state.territories[territoryId]!;
  territory.buildings.push({ type: type as never, level, targetLevel: level, completesAtTick: 0 });
}

// ── M7: full roster, domains, stances ──────────────────────────────────────

describe('M7 — unit domains', () => {
  it('lets aircraft cross both land and sea links', () => {
    expect(traverseBlocker({ fighter: 3 }, 'sea', false)).toBeNull();
    expect(traverseBlocker({ fighter: 3 }, 'land', false)).toBeNull();
  });

  it('keeps ships off land links and away from landlocked territories', () => {
    expect(traverseBlocker({ destroyer: 2 }, 'land', true)).toBe('ships_need_water');
    expect(traverseBlocker({ destroyer: 2 }, 'sea', false)).toBe('ships_need_coast');
    expect(traverseBlocker({ destroyer: 2 }, 'sea', true)).toBeNull();
  });

  it('lets marines swim but not tanks', () => {
    expect(traverseBlocker({ marine: 5 }, 'sea', true)).toBeNull();
    expect(traverseBlocker({ tank: 5 }, 'sea', true)).toBe('cannot_cross_sea');
  });

  it('restricts a mixed army to what its most restricted unit allows', () => {
    expect(traverseBlocker({ marine: 5, tank: 1 }, 'sea', true)).toBe('cannot_cross_sea');
  });

  it('only counts land units as able to hold ground', () => {
    expect(hasGroundForce({ rifle: 1 })).toBe(true);
    expect(hasGroundForce({ destroyer: 4, fighter: 4 })).toBe(false);
  });

  it('reports legal destinations that match the move validator', () => {
    const state = newMatch(2);
    const army = Object.values(state.armies).find((a) => a.ownerId === 'p0')!;
    army.units = { destroyer: 3 };
    for (const destination of legalDestinations(state, army)) {
      expect(moveBlocker(state, army, destination)).toBeNull();
    }
    const illegal = (ADJACENCY[army.at] ?? [])
      .map((l) => l.to)
      .filter((id) => !legalDestinations(state, army).includes(id));
    for (const destination of illegal) {
      expect(moveBlocker(state, army, destination)).not.toBeNull();
    }
  });
});

describe('M7 — capture requires ground forces', () => {
  it('does not let a fleet alone take a territory', () => {
    const state = newMatch(2);
    const target = Object.values(state.territories).find(
      (t) => t.ownerId === null && TERRITORY_DEFS[t.id]!.coastal,
    )!;
    createArmy(state, 'p0', target.id, { destroyer: 5 });
    tickMany(state, 300);
    expect(state.territories[target.id]!.ownerId).toBeNull();
  });

  it('lets infantry take the same territory', () => {
    const state = newMatch(2);
    const target = Object.values(state.territories).find(
      (t) => t.ownerId === null && TERRITORY_DEFS[t.id]!.coastal,
    )!;
    createArmy(state, 'p0', target.id, { rifle: 5 });
    tickMany(state, 300);
    expect(state.territories[target.id]!.ownerId).toBe('p0');
  });

  it('does not capture while an army is on hold', () => {
    const state = newMatch(2);
    const target = Object.values(state.territories).find((t) => t.ownerId === null)!;
    const army = createArmy(state, 'p0', target.id, { rifle: 5 });
    army.stance = 'hold';
    tickMany(state, 300);
    expect(state.territories[target.id]!.ownerId).toBeNull();
  });
});

describe('M7 — stances and capture', () => {
  it('hold stance prevents territory capture', () => {
    const state = newMatch(2);
    const target = Object.values(state.territories).find((t) => t.ownerId === null)!;
    const army = createArmy(state, 'p0', target.id, { rifle: 20 });
    army.stance = 'hold';
    tickMany(state, 400);
    // Hold prevents capture — territory stays neutral despite army present.
    expect(state.territories[target.id]!.ownerId).toBeNull();
  });

  it('aggressive and defensive stances allow capture', () => {
    const state = newMatch(2);
    const target = Object.values(state.territories).find((t) => t.ownerId === null)!;
    const army = createArmy(state, 'p0', target.id, { rifle: 20 });
    army.stance = 'aggressive';
    tickMany(state, 400);
    expect(state.territories[target.id]!.ownerId).toBe('p0');
  });
});

// ── M8/M10: unlocks ────────────────────────────────────────────────────────

describe('M10 — the full building catalogue', () => {
  it('offers naval bases only on the coast', () => {
    const inland = Object.values(TERRITORY_DEFS).find((t) => !t.coastal)!;
    const coastal = Object.values(TERRITORY_DEFS).find((t) => t.coastal)!;
    expect(buildingsForTerritory(inland.id).some((b) => b.id === 'naval_base')).toBe(false);
    expect(buildingsForTerritory(coastal.id).some((b) => b.id === 'naval_base')).toBe(true);
  });

  it('unlocks units as the building that trains them levels up', () => {
    const state = newMatch(2);
    const territoryId = Object.values(state.territories).find((t) => t.ownerId === 'p0')!.id;
    expect(unlockedUnits(state, territoryId)).toHaveLength(0);

    grantBuilding(state, territoryId, 'barracks', 1);
    expect(unlockedUnits(state, territoryId).map((u) => u.id)).toContain('rifle');
    expect(unlockedUnits(state, territoryId).map((u) => u.id)).not.toContain('marine');

    state.territories[territoryId]!.buildings[0]!.level = 3;
    expect(unlockedUnits(state, territoryId).map((u) => u.id)).toContain('marine');
  });

  it('recommends the strongest ground unit the player has unlocked', () => {
    const state = newMatch(2);
    const territoryId = Object.values(state.territories).find((t) => t.ownerId === 'p0')!.id;
    grantBuilding(state, territoryId, 'barracks', 3);
    grantBuilding(state, territoryId, 'vehicle_plant', 3);
    expect(bestAvailableUnit(state, 'p0')?.unit.id).toBe('tank');
  });

  it('rejects training a unit whose building is missing', () => {
    const state = newMatch(2);
    const territoryId = Object.values(state.territories).find((t) => t.ownerId === 'p0')!.id;
    const result = validateCommand(state, 'p0', {
      t: 'TRAIN', territoryId, unit: 'tank', count: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_building');
  });
});

// ── M9: leaders ────────────────────────────────────────────────────────────

describe('M9 — leader progression', () => {
  it('levels up and grants a skill point', () => {
    const state = newMatch(1);
    const leader = state.players.p0!.leader;
    expect(leader.level).toBe(1);
    grantXp(leader, xpForNextLevel(1));
    expect(leader.level).toBe(2);
    expect(leader.skillPoints).toBe(1);
  });

  it('spends a point and the modifier actually changes', () => {
    const state = newMatch(1);
    const player = state.players.p0!;
    player.leader.skillPoints = 2;
    const before = player.modifiers.unitAttackMul;

    const result = applyCommand(state, 'p0', { t: 'SPEND_SKILL', branch: 'warfare' });
    expect(result.ok).toBe(true);
    expect(player.leader.skills.warfare).toBe(1);
    expect(player.modifiers.unitAttackMul).toBeGreaterThan(before);
  });

  it('refuses to spend points the leader does not have', () => {
    const state = newMatch(1);
    state.players.p0!.leader.skillPoints = 0;
    const result = validateCommand(state, 'p0', { t: 'SPEND_SKILL', branch: 'economy' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_points');
  });

  it('caps a branch at its maximum', () => {
    const state = newMatch(1);
    const player = state.players.p0!;
    player.leader.skills.warfare = MAX_SKILL_POINTS_PER_BRANCH;
    player.leader.skillPoints = 5;
    const result = validateCommand(state, 'p0', { t: 'SPEND_SKILL', branch: 'warfare' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('branch_maxed');
  });

  it('awards XP for playing and commits it when the match ends', () => {
    const state = newMatch(2);
    state.config.victoryByConquest = false;
    state.config.victoryTerritoryShare = 0.05;
    for (const t of Object.values(state.territories).slice(0, 5)) t.ownerId = 'p0';
    tickMany(state, 2);
    expect(state.phase).toBe('ended');
    expect(state.players.p0!.leader.level).toBeGreaterThan(1);
  });

  it('never lets cosmetics touch the simulation', () => {
    const state = newMatch(1);
    const player = state.players.p0!;
    const before = JSON.stringify(player.modifiers);
    applyCommand(state, 'p0', {
      t: 'SET_APPEARANCE',
      appearance: { uniform: 'desert', flag: 'tricolor', accessory: 'beret' },
    });
    expect(player.leader.appearance.uniform).toBe('desert');
    expect(JSON.stringify(player.modifiers)).toBe(before);
  });
});

// ── M11: diplomacy ─────────────────────────────────────────────────────────

describe('M11 — alliances', () => {
  it('needs both sides before an alliance exists', () => {
    const state = newMatch(2);
    applyCommand(state, 'p0', { t: 'PROPOSE_ALLY', targetPlayerId: 'p1' });
    expect(areFriendly(state, 'p0', 'p1')).toBe(false);
    expect(state.players.p1!.allianceOffers).toContain('p0');

    applyCommand(state, 'p1', { t: 'ACCEPT_ALLY', targetPlayerId: 'p0' });
    expect(areFriendly(state, 'p0', 'p1')).toBe(true);
    expect(areFriendly(state, 'p1', 'p0')).toBe(true);
  });

  it('forms the alliance when both propose simultaneously', () => {
    const state = newMatch(2);
    applyCommand(state, 'p0', { t: 'PROPOSE_ALLY', targetPlayerId: 'p1' });
    applyCommand(state, 'p1', { t: 'PROPOSE_ALLY', targetPlayerId: 'p0' });
    expect(areFriendly(state, 'p0', 'p1')).toBe(true);
  });

  it('lets a player decline', () => {
    const state = newMatch(2);
    applyCommand(state, 'p0', { t: 'PROPOSE_ALLY', targetPlayerId: 'p1' });
    applyCommand(state, 'p1', { t: 'DECLINE_ALLY', targetPlayerId: 'p0' });
    expect(state.players.p1!.allianceOffers).not.toContain('p0');
    expect(areFriendly(state, 'p0', 'p1')).toBe(false);
  });

  it('makes betrayal public and costly', () => {
    const state = newMatch(2);
    applyCommand(state, 'p0', { t: 'PROPOSE_ALLY', targetPlayerId: 'p1' });
    applyCommand(state, 'p1', { t: 'ACCEPT_ALLY', targetPlayerId: 'p0' });

    const own = Object.values(state.territories).find((t) => t.ownerId === 'p0')!;
    own.unrest = 0;
    applyCommand(state, 'p0', { t: 'BREAK_ALLY', targetPlayerId: 'p1' });

    expect(areFriendly(state, 'p0', 'p1')).toBe(false);
    expect(state.players.p0!.betrayals).toBe(1);
    expect(own.unrest).toBeGreaterThan(0);
  });

  it('stops allies fighting each other', () => {
    const state = newMatch(2);
    applyCommand(state, 'p0', { t: 'PROPOSE_ALLY', targetPlayerId: 'p1' });
    applyCommand(state, 'p1', { t: 'ACCEPT_ALLY', targetPlayerId: 'p0' });
    const territory = Object.values(state.territories).find((t) => t.ownerId === 'p0')!;
    createArmy(state, 'p1', territory.id, { rifle: 10 });
    tickMany(state, 50);
    expect(state.battles).toHaveLength(0);
    expect(state.territories[territory.id]!.ownerId).toBe('p0');
  });
});

describe('M11 — trade', () => {
  it('escrows the offer, then swaps both halves on acceptance', () => {
    const state = newMatch(2);
    const a = state.players.p0!;
    const b = state.players.p1!;
    a.resources.oil = 500;
    b.resources.money = 1000;
    const moneyBefore = a.resources.money;

    const result = applyCommand(state, 'p0', {
      t: 'TRADE_OFFER', targetPlayerId: 'p1', give: { oil: 200 }, want: { money: 400 },
    });
    expect(result.ok).toBe(true);
    // Escrowed immediately — the oil has already left the proposer's stockpile.
    expect(a.resources.oil).toBe(300);

    const offer = state.tradeOffers[0]!;
    expect(acceptTradeOffer(state, 'p1', offer.id)).toBe('accepted');
    expect(b.resources.oil).toBeGreaterThanOrEqual(200);
    expect(b.resources.money).toBe(600);
    expect(a.resources.money).toBe(moneyBefore + 400);
    expect(state.tradeOffers).toHaveLength(0);
  });

  it('refunds the escrow when an offer is declined', () => {
    const state = newMatch(2);
    state.players.p0!.resources.oil = 500;
    applyCommand(state, 'p0', {
      t: 'TRADE_OFFER', targetPlayerId: 'p1', give: { oil: 200 }, want: { money: 100 },
    });
    const offer = state.tradeOffers[0]!;
    applyCommand(state, 'p1', { t: 'TRADE_DECLINE', offerId: offer.id });
    expect(state.players.p0!.resources.oil).toBe(500);
    expect(state.tradeOffers).toHaveLength(0);
  });

  it('refunds the escrow when an offer expires', () => {
    const state = newMatch(2);
    state.players.p0!.resources.oil = 500;
    applyCommand(state, 'p0', {
      t: 'TRADE_OFFER', targetPlayerId: 'p1', give: { oil: 200 }, want: { money: 100 },
    });
    state.tick = state.tradeOffers[0]!.expiresAtTick;
    expireTradeOffers(state);
    expect(state.tradeOffers).toHaveLength(0);
    expect(state.players.p0!.resources.oil).toBe(500);
  });

  it('cannot offer resources it does not have', () => {
    const state = newMatch(2);
    state.players.p0!.resources.oil = 10;
    const result = validateCommand(state, 'p0', {
      t: 'TRADE_OFFER', targetPlayerId: 'p1', give: { oil: 5000 }, want: {},
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_resources');
  });

  it('ignores negative amounts instead of minting resources', () => {
    const state = newMatch(2);
    const before = state.players.p1!.resources.money;
    const result = validateCommand(state, 'p0', {
      t: 'TRADE_OFFER', targetPlayerId: 'p1', give: { money: -5000 }, want: {},
    });
    expect(result.ok).toBe(false);
    expect(state.players.p1!.resources.money).toBe(before);
  });

  it('cannot accept a trade addressed to somebody else', () => {
    const state = newMatch(3);
    state.players.p0!.resources.oil = 500;
    applyCommand(state, 'p0', {
      t: 'TRADE_OFFER', targetPlayerId: 'p1', give: { oil: 100 }, want: { money: 50 },
    });
    const offer = state.tradeOffers[0]!;
    const result = validateCommand(state, 'p2', { t: 'TRADE_ACCEPT', offerId: offer.id });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_recipient');
  });
});

describe('M11 — map pings', () => {
  it('records a ping and lets it expire on its own', () => {
    const state = newMatch(2);
    const territoryId = Object.keys(state.territories)[0]!;
    applyCommand(state, 'p0', { t: 'PING_MAP', territoryId, kind: 'attack' });
    expect(state.pings).toHaveLength(1);

    state.tick = state.pings[0]!.expiresAtTick;
    expirePings(state);
    expect(state.pings).toHaveLength(0);
  });

  it('replaces rather than stacks repeated pings on one territory', () => {
    const state = newMatch(2);
    const territoryId = Object.keys(state.territories)[0]!;
    for (let i = 0; i < 5; i++) {
      applyCommand(state, 'p0', { t: 'PING_MAP', territoryId, kind: 'help' });
    }
    expect(state.pings).toHaveLength(1);
  });
});

describe('phase 2 stability', () => {
  it('runs a long match with the full roster without breaking', () => {
    const state = newMatch(6, 'long-p2', 'LONGP2');
    for (const id of state.playerOrder) {
      const territoryId = Object.values(state.territories).find((t) => t.ownerId === id)!.id;
      grantBuilding(state, territoryId, 'barracks', 5);
      grantBuilding(state, territoryId, 'vehicle_plant', 3);
      const def = TERRITORY_DEFS[territoryId]!;
      if (def.coastal) grantBuilding(state, territoryId, 'naval_base', 4);
      createArmy(state, id, territoryId, def.coastal ? { destroyer: 4, marine: 6 } : { tank: 4, rifle: 8 });
    }
    expect(() => tickMany(state, 4000)).not.toThrow();
    for (const player of Object.values(state.players)) {
      expect(Number.isFinite(player.resources.money)).toBe(true);
      expect(player.leader.skills.warfare).toBeLessThanOrEqual(MAX_SKILL_POINTS_PER_BRANCH);
    }
    for (const unitId of Object.keys(UNITS)) {
      expect(UNITS[unitId as keyof typeof UNITS].hp).toBeGreaterThan(0);
    }
  });
});
