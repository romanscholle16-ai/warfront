# 4. Database Design

## 4.1 Principle

**A live match does not touch the database.** The match lives in server RAM and is checkpointed as a blob. The DB stores what must outlive a match: identity, progression, cosmetics, ranked results, persistent worlds.

This keeps free-tier usage near zero (a few writes per match, not thousands per second) and keeps the sim pure.

## 4.2 Storage tiers

| Tier | Tech | When | Cost |
|---|---|---|---|
| 0 | In-memory `MatchState` | Always, during a live match | — |
| 1 | SQLite file (`better-sqlite3`) | Dev + LAN play + self-hosted | $0 |
| 2 | Supabase Postgres free tier | Accounts, ranked, clans, persistent worlds | $0 within tier |

The server talks to a `Storage` interface with two implementations (`SqliteStorage`, `PostgresStorage`). Swapping tiers is a config change.

## 4.3 Schema

```sql
-- ── Identity ───────────────────────────────────────────────────────────
CREATE TABLE players (
  id            TEXT PRIMARY KEY,          -- uuid
  display_name  TEXT NOT NULL,
  device_id     TEXT,                      -- anonymous login for MVP; no signup friction
  auth_provider TEXT,                      -- 'device' | 'google' | 'apple'  (phase 3)
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  elo_1v1       INTEGER NOT NULL DEFAULT 1200,
  elo_team      INTEGER NOT NULL DEFAULT 1200,
  elo_ffa       INTEGER NOT NULL DEFAULT 1200
);

-- ── Leader / cosmetics (never affects balance) ─────────────────────────
CREATE TABLE leaders (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  name        TEXT NOT NULL,
  class       TEXT NOT NULL,               -- military|economic|scientific|diplomatic
  skill_tree  TEXT NOT NULL,               -- JSON {warfare:n, economy:n, intelligence:n}
  appearance  TEXT NOT NULL,               -- JSON {body,face,hair,uniform,accessories,flag}
  level       INTEGER NOT NULL DEFAULT 1,
  xp          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cosmetics_owned (
  player_id   TEXT NOT NULL REFERENCES players(id),
  cosmetic_id TEXT NOT NULL,               -- 'flag.tricolor', 'uniform.desert', 'base.brutalist'
  source      TEXT NOT NULL,               -- purchase|season|achievement
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, cosmetic_id)
);

-- ── Matches ────────────────────────────────────────────────────────────
CREATE TABLE matches (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE,                 -- 6-char friend code, NULL for ranked
  mode        TEXT NOT NULL,               -- casual|ranked_1v1|ranked_2v2|ranked_4v4|ffa8|conquest10
  map_id      TEXT NOT NULL,
  seed        INTEGER NOT NULL,            -- replay/audit: seed + commands reproduce the match
  status      TEXT NOT NULL,               -- lobby|playing|paused|ended|abandoned
  tick        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  state_blob  BLOB                         -- gzipped MatchState; only for paused/persistent
);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_code   ON matches(code) WHERE code IS NOT NULL;

CREATE TABLE match_players (
  match_id    TEXT NOT NULL REFERENCES matches(id),
  player_id   TEXT NOT NULL REFERENCES players(id),
  slot        INTEGER NOT NULL,
  team        INTEGER,
  leader_id   TEXT REFERENCES leaders(id),
  placement   INTEGER,                     -- 1 = winner
  elo_delta   INTEGER,
  stats       TEXT,                        -- JSON: territories peak, kills, gdp, built
  PRIMARY KEY (match_id, player_id)
);

-- ── Persistent worlds (phase 3) ────────────────────────────────────────
CREATE TABLE worlds (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  season        INTEGER NOT NULL,
  tick          INTEGER NOT NULL,
  tick_rate_ms  INTEGER NOT NULL,          -- slow clock, e.g. 1 tick = 1 real minute
  started_at    INTEGER NOT NULL,
  ends_at       INTEGER,
  state_blob    BLOB NOT NULL
);
CREATE TABLE world_members (
  world_id  TEXT NOT NULL REFERENCES worlds(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  nation_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, player_id)
);

-- ── Social (phase 3) ───────────────────────────────────────────────────
CREATE TABLE friends (
  player_id  TEXT NOT NULL REFERENCES players(id),
  friend_id  TEXT NOT NULL REFERENCES players(id),
  status     TEXT NOT NULL,                -- pending|accepted|blocked
  PRIMARY KEY (player_id, friend_id)
);
CREATE TABLE clans (
  id         TEXT PRIMARY KEY,
  tag        TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE clan_members (
  clan_id   TEXT NOT NULL REFERENCES clans(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  role      TEXT NOT NULL,                 -- owner|officer|member
  PRIMARY KEY (clan_id, player_id)
);
```

## 4.4 Why `state_blob` instead of normalized match tables

A live 8-player match mutates thousands of fields per second. Normalizing it into `territories`/`armies` tables would mean constant writes for data nobody queries. Instead:

* **Live match** → RAM only.
* **Checkpoint** (pause, all-players-dropped, persistent world tick, server shutdown) → one gzipped JSON blob, ~40–120 KB.
* **Analytics** → a small denormalized row per player per match (`match_players.stats`), written once at match end. That's what leaderboards and profiles read.

Free-tier write volume: **~2 rows + 1 blob per match.** A Supabase free project handles tens of thousands of matches.

## 4.5 Migrations

Plain numbered SQL files (`migrations/001_init.sql`, …) applied by a tiny runner with a `schema_version` table. Same files work on SQLite and Postgres if you avoid vendor-specific types — which the schema above deliberately does (`TEXT`, `INTEGER`, `BLOB`).

## 4.6 What is *not* in the database

* Balance data (unit stats, building costs, tech trees) — those live in `packages/shared/src/config` as typed TS. They must be identical on client and server and versioned with the code, not the data. A server/client mismatch would be a desync; a compile error is better.
* Map data — same reasoning.
* Chat history — ephemeral, in-room only (avoids a moderation/retention obligation you don't want in an MVP).

## 4.7 MVP posture

For Phase 1, **no database at all**: anonymous device-id players, in-memory rooms, matches that end when they end. SQLite lands in Phase 2 when leaders and progression need to persist. This is deliberate — it removes an entire class of setup friction from "4 friends want to test the game tonight".
