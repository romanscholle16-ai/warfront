import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDefaultLeader } from '@warfront/shared';
import type { Leader, LeaderClass, MatchState } from '@warfront/shared';

// node:sqlite was added in Node 22.5 — if the runtime is older (e.g. Railway's
// default Node 20, or a 22.x build compiled without it), the static import would
// crash the entire module load. Using a dynamic require lets us fail gracefully.
let DatabaseSync: (new (file: string) => { exec(sql: string): void; prepare(sql: string): { get: (p: string) => unknown; run: (...args: unknown[]) => unknown }; close(): void }) | null = null;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSync });
} catch {
  // node:sqlite unavailable — SqliteStorage will throw, getStorage() falls back to memory.
}

/**
 * Persistence (M9/M12 groundwork).
 *
 * Uses Node's built-in `node:sqlite` — no native compilation, no dependency, no setup.
 * That matters: the point of the LAN-first design is that a friend can clone this and
 * run it, and a node-gyp build failure is exactly the kind of friction that stops that.
 *
 * Everything here is behind the `Storage` interface, so swapping SQLite for the
 * Supabase Postgres described in docs/04-database-design.md is one new class.
 */

export interface PlayerProfile {
  id: string;
  displayName: string;
  leader: Leader;
  matchesPlayed: number;
  matchesWon: number;
}

export interface MatchResultRow {
  playerId: string;
  placement: number;
  territories: number;
  xpEarned: number;
  won: boolean;
}

export interface Storage {
  loadProfile(deviceId: string, fallbackName: string): PlayerProfile;
  saveLeader(deviceId: string, leader: Leader): void;
  recordMatch(matchId: string, code: string, mode: string, results: MatchResultRow[]): void;
  saveGame(id: string, code: string, hostDeviceId: string, stateJson: string): void;
  loadGame(id: string): { code: string; stateJson: string } | null;
  listSavedGames(hostDeviceId: string): Array<{ id: string; code: string; savedAt: number }>;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  matches_won    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leaders (
  player_id    TEXT PRIMARY KEY REFERENCES players(id),
  name         TEXT NOT NULL,
  class        TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1,
  xp           INTEGER NOT NULL DEFAULT 0,
  skill_points INTEGER NOT NULL DEFAULT 0,
  skills       TEXT NOT NULL,
  appearance   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id         TEXT PRIMARY KEY,
  code       TEXT,
  mode       TEXT NOT NULL,
  ended_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id    TEXT NOT NULL REFERENCES matches(id),
  player_id   TEXT NOT NULL REFERENCES players(id),
  placement   INTEGER NOT NULL,
  territories INTEGER NOT NULL,
  xp_earned   INTEGER NOT NULL,
  won         INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);

CREATE TABLE IF NOT EXISTS saved_games (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  host_device_id  TEXT NOT NULL,
  saved_at        INTEGER NOT NULL,
  state_json      TEXT NOT NULL
);
`;

export class SqliteStorage implements Storage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;

  constructor(file: string) {
    if (!DatabaseSync) throw new Error('node:sqlite unavailable');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  loadProfile(deviceId: string, fallbackName: string): PlayerProfile {
    const now = Date.now();
    const existing = this.db.prepare(
      `SELECT p.display_name, p.matches_played, p.matches_won,
              l.name, l.class, l.level, l.xp, l.skill_points, l.skills, l.appearance
         FROM players p LEFT JOIN leaders l ON l.player_id = p.id
        WHERE p.id = ?`,
    ).get(deviceId) as Record<string, unknown> | undefined;

    if (!existing) {
      const leader = createDefaultLeader(fallbackName);
      this.db.prepare(
        'INSERT INTO players (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
      ).run(deviceId, fallbackName, now, now);
      this.writeLeader(deviceId, leader);
      return { id: deviceId, displayName: fallbackName, leader, matchesPlayed: 0, matchesWon: 0 };
    }

    this.db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').run(now, deviceId);

    const leader = createDefaultLeader(String(existing.name ?? fallbackName));
    if (existing.class) {
      leader.class = String(existing.class) as LeaderClass;
      leader.level = Number(existing.level ?? 1);
      leader.xp = Number(existing.xp ?? 0);
      leader.skillPoints = Number(existing.skill_points ?? 0);
      leader.skills = safeParse(existing.skills, leader.skills);
      leader.appearance = safeParse(existing.appearance, leader.appearance);
    }

    return {
      id: deviceId,
      displayName: String(existing.display_name ?? fallbackName),
      leader,
      matchesPlayed: Number(existing.matches_played ?? 0),
      matchesWon: Number(existing.matches_won ?? 0),
    };
  }

  saveLeader(deviceId: string, leader: Leader): void {
    // A player who joined without a profile row (e.g. storage came up late) still gets one.
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO players (id, display_name, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`,
    ).run(deviceId, leader.name, now, now);
    this.writeLeader(deviceId, leader);
  }

  private writeLeader(deviceId: string, leader: Leader): void {
    this.db.prepare(
      `INSERT INTO leaders (player_id, name, class, level, xp, skill_points, skills, appearance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         name = excluded.name, class = excluded.class, level = excluded.level,
         xp = excluded.xp, skill_points = excluded.skill_points,
         skills = excluded.skills, appearance = excluded.appearance`,
    ).run(
      deviceId, leader.name, leader.class, leader.level, Math.round(leader.xp),
      leader.skillPoints, JSON.stringify(leader.skills), JSON.stringify(leader.appearance),
    );
  }

  recordMatch(matchId: string, code: string, mode: string, results: MatchResultRow[]): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO matches (id, code, mode, ended_at) VALUES (?, ?, ?, ?)',
    ).run(matchId, code, mode, Date.now());

    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO match_players
       (match_id, player_id, placement, territories, xp_earned, won)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const bump = this.db.prepare(
      'UPDATE players SET matches_played = matches_played + 1, matches_won = matches_won + ? WHERE id = ?',
    );

    for (const row of results) {
      insert.run(matchId, row.playerId, row.placement, row.territories, Math.round(row.xpEarned), row.won ? 1 : 0);
      bump.run(row.won ? 1 : 0, row.playerId);
    }
  }

  saveGame(id: string, code: string, hostDeviceId: string, stateJson: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO saved_games (id, code, host_device_id, saved_at, state_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, code, hostDeviceId, Date.now(), stateJson);
  }

  loadGame(id: string): { code: string; stateJson: string } | null {
    const row = this.db.prepare(
      'SELECT code, state_json FROM saved_games WHERE id = ?',
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { code: String(row.code ?? ''), stateJson: String(row.state_json ?? '') };
  }

  listSavedGames(hostDeviceId: string): Array<{ id: string; code: string; savedAt: number }> {
    const rows = this.db.prepare(
      'SELECT id, code, saved_at FROM saved_games WHERE host_device_id = ? ORDER BY saved_at DESC LIMIT 10',
    ).all(hostDeviceId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id ?? ''),
      code: String(r.code ?? ''),
      savedAt: Number(r.saved_at ?? 0),
    }));
  }

  close(): void {
    this.db.close();
  }
}

/** Used when persistence is disabled — every method is a no-op, nothing else changes. */
export class MemoryStorage implements Storage {
  private profiles = new Map<string, PlayerProfile>();

  loadProfile(deviceId: string, fallbackName: string): PlayerProfile {
    const existing = this.profiles.get(deviceId);
    if (existing) return existing;
    const profile: PlayerProfile = {
      id: deviceId,
      displayName: fallbackName,
      leader: createDefaultLeader(fallbackName),
      matchesPlayed: 0,
      matchesWon: 0,
    };
    this.profiles.set(deviceId, profile);
    return profile;
  }

  saveLeader(deviceId: string, leader: Leader): void {
    const profile = this.loadProfile(deviceId, leader.name);
    profile.leader = leader;
  }

  recordMatch(): void { /* nothing to do */ }
  saveGame(): void { /* nothing to do */ }
  loadGame(): null { return null; }
  listSavedGames(): [] { return []; }
  close(): void { /* nothing to do */ }
}

/** Ranks players by territories held, so the match record has a real placement. */
export function buildResults(state: MatchState, deviceIds: Map<string, string>): MatchResultRow[] {
  const rows = Object.values(state.players).map((player) => {
    let territories = 0;
    for (const territory of Object.values(state.territories)) {
      if (territory.ownerId === player.id) territories++;
    }
    return {
      sessionId: player.id,
      playerId: deviceIds.get(player.id) ?? player.id,
      territories,
      xpEarned: player.matchXp,
      won: state.winnerTeam !== null && player.team === state.winnerTeam,
      placement: 0,
    };
  });

  rows.sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    return b.territories - a.territories;
  });
  rows.forEach((row, index) => { row.placement = index + 1; });
  return rows.map(({ playerId, placement, territories, xpEarned, won }) => (
    { playerId, placement, territories, xpEarned, won }
  ));
}

/** Stored JSON is trusted-ish but not guaranteed — a corrupt row must not kill a join. */
function safeParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

let singleton: Storage | null = null;

export function getStorage(): Storage {
  if (singleton) return singleton;
  const file = process.env.WARFRONT_DB ?? 'data/warfront.db';
  try {
    singleton = new SqliteStorage(file);
    console.log(`[storage] sqlite at ${file}`);
  } catch (error) {
    // Persistence is a convenience, not a dependency — a match must still be playable.
    console.warn('[storage] sqlite unavailable, falling back to memory:', (error as Error).message);
    singleton = new MemoryStorage();
  }
  return singleton;
}
