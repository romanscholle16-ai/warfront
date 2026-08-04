import type { BuildingType, MatchState, UnitType } from '../types.js';
import { MVP_BUILDINGS, buildingCost } from '../config/buildings.js';
import { availableTechs } from '../config/tech.js';
import { ADJACENCY } from '../data/worldMap.js';
import {
  areFriendly, armiesAt, armyUnitCount, canAfford, ownedTerritoryCount, playerTerritories,
  territoryDef,
} from './state.js';
import { bestAvailableUnit, buildingBlocker, unitBlocker } from './construction.js';
import { UNITS } from '../config/units.js';
import type { Command } from './commands.js';

/**
 * The advisor is what makes a game this deep learnable in five minutes.
 *
 * It is deliberately part of the *shared* package rather than the UI: it reads the
 * same state the server owns, so it can never suggest something the server would
 * reject, and the same code will later drive the caretaker AI for dropped players
 * and the bot opponents in the tutorial.
 */

export type SuggestionKind =
  | 'build' | 'expand' | 'defend' | 'attack' | 'research' | 'economy' | 'idle_army' | 'train';

export interface Suggestion {
  kind: SuggestionKind;
  /** 0-100; the UI shows the top 3. */
  priority: number;
  title: string;
  detail: string;
  territoryId?: string;
  /** Ready-to-send command, so "Do it" is a single tap. */
  command?: Command;
}

export function getSuggestions(state: MatchState, playerId: string, limit = 3): Suggestion[] {
  const player = state.players[playerId];
  if (!player || state.phase !== 'playing') return [];

  const out: Suggestion[] = [];
  const mine = playerTerritories(state, playerId);
  const income = player.income;

  // ── economy: food is the growth constraint players miss first ────────────
  if (income.food < 0) {
    const target = mine.find((t) => buildingBlocker(state, playerId, t.id, 'farm') === null);
    out.push({
      kind: 'economy',
      priority: 92,
      title: 'Your people are going hungry',
      detail: `Food is falling by ${Math.abs(Math.round(income.food))}/min. Build a farm before your population starts to shrink.`,
      territoryId: target?.id,
      command: target ? { t: 'BUILD', territoryId: target.id, building: 'farm' } : undefined,
    });
  } else if (player.resources.food > 3000 && income.food > 20) {
    out.push({
      kind: 'economy',
      priority: 40,
      title: 'You have excess food',
      detail: 'Surplus food does nothing on its own. Convert it into soldiers or trade it to an ally.',
    });
  }

  // ── money piling up = under-building ────────────────────────────────────
  if (player.resources.money > 2500) {
    const pick = suggestBuilding(state, playerId);
    if (pick) {
      out.push({
        kind: 'build',
        priority: 78,
        title: 'Your treasury is idle',
        detail: `${Math.round(player.resources.money)} in the bank. Build a ${pick.label} in ${territoryDef(pick.territoryId).name}.`,
        territoryId: pick.territoryId,
        command: { t: 'BUILD', territoryId: pick.territoryId, building: pick.building },
      });
    }
  }

  // ── army too small for the land you hold ────────────────────────────────
  const held = ownedTerritoryCount(state, playerId);
  const troops = Object.values(state.armies)
    .filter((a) => a.ownerId === playerId)
    .reduce((sum, a) => sum + armyUnitCount(a), 0);
  if (held > 0 && troops < held * 5) {
    // Recommend the best ground unit the player has actually unlocked, not always
    // rifles — otherwise the advisor keeps giving beginner advice to a late-game nation.
    const best = bestAvailableUnit(state, playerId);
    const site = best && canAfford(player.resources, best.unit.cost)
      ? best.territoryId
      : findTrainingSite(state, playerId, 'rifle');
    const unit = best && site === best.territoryId ? best.unit.id : 'rifle';

    if (site) {
      out.push({
        kind: 'train',
        priority: 80,
        title: 'Your army is too small to hold your borders',
        detail: `${Math.round(troops)} units across ${held} territories. Train more ${UNITS[unit].name.toLowerCase()} before someone notices.`,
        territoryId: site,
        command: { t: 'TRAIN', territoryId: site, unit, count: 3 },
      });
    } else if (!mine.some((t) => t.buildings.some((b) => b.type === 'barracks'))) {
      const target = mine.find((t) => buildingBlocker(state, playerId, t.id, 'barracks') === null);
      if (target) {
        out.push({
          kind: 'build',
          priority: 82,
          title: 'You cannot train any soldiers',
          detail: 'You have no barracks. Without one, you cannot replace losses or defend your land.',
          territoryId: target.id,
          command: { t: 'BUILD', territoryId: target.id, building: 'barracks' },
        });
      }
    }
  }

  // ── research idle ────────────────────────────────────────────────────────
  if (!player.research) {
    const options = availableTechs(player.tech)
      .filter((t) => t.costResearch <= player.resources.research)
      .sort((a, b) => a.costResearch - b.costResearch);
    const cheapest = options[0];
    if (cheapest) {
      out.push({
        kind: 'research',
        priority: 70,
        title: 'No research in progress',
        detail: `You can afford ${cheapest.name}. Technology compounds — start it now.`,
        command: { t: 'START_RESEARCH', techId: cheapest.id },
      });
    }
  }

  // ── free expansion: neutral land next door ──────────────────────────────
  const neutral = findNeutralBorder(state, playerId);
  if (neutral) {
    out.push({
      kind: 'expand',
      priority: 85,
      title: `${territoryDef(neutral.territoryId).name} is unclaimed`,
      detail: 'Unclaimed land can be taken without a fight. Move an army in to occupy it.',
      territoryId: neutral.territoryId,
      command: { t: 'MOVE_ARMY', armyId: neutral.armyId, toTerritoryId: neutral.territoryId },
    });
  }

  // ── undefended borders ──────────────────────────────────────────────────
  for (const territory of mine) {
    const defenders = armiesAt(state, territory.id)
      .filter((a) => a.ownerId === playerId)
      .reduce((sum, a) => sum + armyUnitCount(a), 0);
    if (defenders > 0) continue;
    const threat = borderThreat(state, playerId, territory.id);
    if (threat <= 0) continue;
    out.push({
      kind: 'defend',
      priority: Math.min(95, 60 + threat * 2),
      title: `${territoryDef(territory.id).name} is undefended`,
      detail: `An enemy force is one move away and you have no garrison here.`,
      territoryId: territory.id,
    });
    break; // one defence warning at a time — the UI must not become a wall of text
  }

  // ── attack opportunity ──────────────────────────────────────────────────
  const opening = findWeakEnemyBorder(state, playerId);
  if (opening) {
    out.push({
      kind: 'attack',
      priority: 74,
      title: `${territoryDef(opening.territoryId).name} is weakly held`,
      detail: `Your force outnumbers the defenders. This is an opening.`,
      territoryId: opening.territoryId,
      command: { t: 'MOVE_ARMY', armyId: opening.armyId, toTerritoryId: opening.territoryId },
    });
  }

  // ── armies sitting in safe rear territories ─────────────────────────────
  if (ownedTerritoryCount(state, playerId) > 2) {
    for (const army of Object.values(state.armies)) {
      if (army.ownerId !== playerId || army.movingTo !== null) continue;
      if (borderThreat(state, playerId, army.at) > 0) continue;
      const hasFrontier = (ADJACENCY[army.at] ?? []).some(
        (l) => state.territories[l.to]?.ownerId !== playerId,
      );
      if (hasFrontier) continue;
      out.push({
        kind: 'idle_army',
        priority: 35,
        title: 'An army is doing nothing',
        detail: `Your force in ${territoryDef(army.at).name} is deep behind your own lines. Move it to the front.`,
        territoryId: army.at,
      });
      break;
    }
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Picks the building that best fixes the player's *current* weakest link, rather
 * than following a fixed order — a fixed order makes the advisor recommend a fifth
 * farm while the nation runs out of materials.
 */
function suggestBuilding(
  state: MatchState,
  playerId: string,
): { territoryId: string; building: BuildingType; label: string } | null {
  const player = state.players[playerId]!;
  const mine = playerTerritories(state, playerId);
  const income = player.income;
  const hasBarracks = mine.some((t) => t.buildings.some((b) => b.type === 'barracks' && b.level > 0));

  const scores: Array<{ building: BuildingType; score: number }> = [
    { building: 'farm', score: 100 - income.food * 1.5 },
    { building: 'factory', score: 95 - income.materials * 3 },
    { building: 'commercial', score: 85 - income.money / 4 },
    { building: 'barracks', score: hasBarracks ? 10 : 75 },
    { building: 'research_center', score: 60 - income.research * 6 },
  ];
  const ranked = scores.sort((a, b) => b.score - a.score);

  for (const { building } of ranked) {
    for (const territory of mine) {
      if (buildingBlocker(state, playerId, territory.id, building) !== null) continue;
      const existing = territory.buildings.find((b) => b.type === building);
      const cost = buildingCost(building, (existing?.level ?? 0) + 1);
      if (!canAfford(player.resources, cost)) continue;
      const def = MVP_BUILDINGS.find((b) => b.id === building);
      return { territoryId: territory.id, building, label: def?.name ?? building };
    }
  }
  return null;
}

/** A territory that can train the given unit right now. */
function findTrainingSite(state: MatchState, playerId: string, unit: UnitType): string | null {
  for (const territory of playerTerritories(state, playerId)) {
    if (unitBlocker(state, playerId, territory.id, unit, 1) === null) return territory.id;
  }
  return null;
}

function findNeutralBorder(
  state: MatchState,
  playerId: string,
): { territoryId: string; armyId: string } | null {
  for (const army of Object.values(state.armies)) {
    if (army.ownerId !== playerId || army.movingTo !== null) continue;
    if (armyUnitCount(army) < 2) continue;
    for (const link of ADJACENCY[army.at] ?? []) {
      const target = state.territories[link.to];
      if (!target || target.ownerId !== null) continue;
      if (armiesAt(state, link.to).length > 0) continue;
      return { territoryId: link.to, armyId: army.id };
    }
  }
  return null;
}

/** Enemy strength within one move of a territory. */
function borderThreat(state: MatchState, playerId: string, territoryId: string): number {
  let threat = 0;
  for (const link of ADJACENCY[territoryId] ?? []) {
    for (const army of armiesAt(state, link.to)) {
      if (areFriendly(state, army.ownerId, playerId)) continue;
      threat += armyUnitCount(army);
    }
  }
  return threat;
}

function findWeakEnemyBorder(
  state: MatchState,
  playerId: string,
): { territoryId: string; armyId: string } | null {
  for (const army of Object.values(state.armies)) {
    if (army.ownerId !== playerId || army.movingTo !== null) continue;
    const strength = armyUnitCount(army);
    if (strength < 4) continue;
    for (const link of ADJACENCY[army.at] ?? []) {
      const target = state.territories[link.to];
      if (!target || target.ownerId === null) continue;
      if (areFriendly(state, target.ownerId, playerId)) continue;
      const defenders = armiesAt(state, link.to).reduce((sum, a) => sum + armyUnitCount(a), 0);
      if (defenders * 1.5 < strength) return { territoryId: link.to, armyId: army.id };
    }
  }
  return null;
}
