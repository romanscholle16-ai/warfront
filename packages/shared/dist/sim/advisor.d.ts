import type { MatchState } from '../types.js';
import type { Command } from './commands.js';
/**
 * The advisor is what makes a game this deep learnable in five minutes.
 *
 * It is deliberately part of the *shared* package rather than the UI: it reads the
 * same state the server owns, so it can never suggest something the server would
 * reject, and the same code will later drive the caretaker AI for dropped players
 * and the bot opponents in the tutorial.
 */
export type SuggestionKind = 'build' | 'expand' | 'defend' | 'attack' | 'research' | 'economy' | 'idle_army' | 'train';
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
export declare function getSuggestions(state: MatchState, playerId: string, limit?: number): Suggestion[];
//# sourceMappingURL=advisor.d.ts.map