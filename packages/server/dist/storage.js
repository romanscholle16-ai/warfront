import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDefaultLeader } from '@warfront/shared';
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
`;
export class SqliteStorage {
    constructor(file) {
        if (file !== ':memory:')
            mkdirSync(dirname(file), { recursive: true });
        this.db = new DatabaseSync(file);
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec(SCHEMA);
    }
    loadProfile(deviceId, fallbackName) {
        const now = Date.now();
        const existing = this.db.prepare(`SELECT p.display_name, p.matches_played, p.matches_won,
              l.name, l.class, l.level, l.xp, l.skill_points, l.skills, l.appearance
         FROM players p LEFT JOIN leaders l ON l.player_id = p.id
        WHERE p.id = ?`).get(deviceId);
        if (!existing) {
            const leader = createDefaultLeader(fallbackName);
            this.db.prepare('INSERT INTO players (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)').run(deviceId, fallbackName, now, now);
            this.writeLeader(deviceId, leader);
            return { id: deviceId, displayName: fallbackName, leader, matchesPlayed: 0, matchesWon: 0 };
        }
        this.db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').run(now, deviceId);
        const leader = createDefaultLeader(String(existing.name ?? fallbackName));
        if (existing.class) {
            leader.class = String(existing.class);
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
    saveLeader(deviceId, leader) {
        // A player who joined without a profile row (e.g. storage came up late) still gets one.
        const now = Date.now();
        this.db.prepare(`INSERT INTO players (id, display_name, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`).run(deviceId, leader.name, now, now);
        this.writeLeader(deviceId, leader);
    }
    writeLeader(deviceId, leader) {
        this.db.prepare(`INSERT INTO leaders (player_id, name, class, level, xp, skill_points, skills, appearance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         name = excluded.name, class = excluded.class, level = excluded.level,
         xp = excluded.xp, skill_points = excluded.skill_points,
         skills = excluded.skills, appearance = excluded.appearance`).run(deviceId, leader.name, leader.class, leader.level, Math.round(leader.xp), leader.skillPoints, JSON.stringify(leader.skills), JSON.stringify(leader.appearance));
    }
    recordMatch(matchId, code, mode, results) {
        this.db.prepare('INSERT OR REPLACE INTO matches (id, code, mode, ended_at) VALUES (?, ?, ?, ?)').run(matchId, code, mode, Date.now());
        const insert = this.db.prepare(`INSERT OR REPLACE INTO match_players
       (match_id, player_id, placement, territories, xp_earned, won)
       VALUES (?, ?, ?, ?, ?, ?)`);
        const bump = this.db.prepare('UPDATE players SET matches_played = matches_played + 1, matches_won = matches_won + ? WHERE id = ?');
        for (const row of results) {
            insert.run(matchId, row.playerId, row.placement, row.territories, Math.round(row.xpEarned), row.won ? 1 : 0);
            bump.run(row.won ? 1 : 0, row.playerId);
        }
    }
    close() {
        this.db.close();
    }
}
/** Used when persistence is disabled — every method is a no-op, nothing else changes. */
export class MemoryStorage {
    constructor() {
        this.profiles = new Map();
    }
    loadProfile(deviceId, fallbackName) {
        const existing = this.profiles.get(deviceId);
        if (existing)
            return existing;
        const profile = {
            id: deviceId,
            displayName: fallbackName,
            leader: createDefaultLeader(fallbackName),
            matchesPlayed: 0,
            matchesWon: 0,
        };
        this.profiles.set(deviceId, profile);
        return profile;
    }
    saveLeader(deviceId, leader) {
        const profile = this.loadProfile(deviceId, leader.name);
        profile.leader = leader;
    }
    recordMatch() { }
    close() { }
}
/** Ranks players by territories held, so the match record has a real placement. */
export function buildResults(state, deviceIds) {
    const rows = Object.values(state.players).map((player) => {
        let territories = 0;
        for (const territory of Object.values(state.territories)) {
            if (territory.ownerId === player.id)
                territories++;
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
        if (a.won !== b.won)
            return a.won ? -1 : 1;
        return b.territories - a.territories;
    });
    rows.forEach((row, index) => { row.placement = index + 1; });
    return rows.map(({ playerId, placement, territories, xpEarned, won }) => ({ playerId, placement, territories, xpEarned, won }));
}
/** Stored JSON is trusted-ish but not guaranteed — a corrupt row must not kill a join. */
function safeParse(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    }
    catch {
        return fallback;
    }
}
let singleton = null;
export function getStorage() {
    if (singleton)
        return singleton;
    const file = process.env.WARFRONT_DB ?? 'data/warfront.db';
    try {
        singleton = new SqliteStorage(file);
        console.log(`[storage] sqlite at ${file}`);
    }
    catch (error) {
        // Persistence is a convenience, not a dependency — a match must still be playable.
        console.warn('[storage] sqlite unavailable, falling back to memory:', error.message);
        singleton = new MemoryStorage();
    }
    return singleton;
}
//# sourceMappingURL=storage.js.map