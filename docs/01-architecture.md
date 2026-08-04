# 1. Architecture Plan — WARFRONT: Global Conquest

## 1.1 Design constraints that drive every decision

| Constraint | Architectural consequence |
|---|---|
| 4–8 players on separate phones, real-time | Authoritative server, fixed tick, clients send *intents* not *state* |
| Free to operate during dev/test | Server must be runnable on a laptop over LAN **and** on a free cloud tier, unchanged |
| Android + iOS | One codebase, no platform-specific game logic |
| Low-end devices | 2D vector/sprite rendering, ≤ 60 draw calls/frame, sim runs on the server, not the phone |
| Battery | Client renders at 30 fps when idle, network at 5 Hz, no per-frame allocations |
| Scalable for future expansion | Simulation is a **pure, engine-independent TypeScript package** — the renderer is replaceable |

## 1.2 The one rule that makes everything else work

> **The game simulation is a pure function: `(State, Command[], dt) -> State`.**
> It has no imports from Phaser, no imports from Colyseus, no `Date.now()`, no `Math.random()`.

Everything follows from this:

* The **server** runs it authoritatively → cheating is structurally impossible (clients can't write state).
* The **client** can run the *same* code for optimistic prediction and offline/tutorial/AI matches.
* Unit tests run it in milliseconds with no engine boot.
* A future engine swap (Godot/Unity/native) replaces only the render layer, not the game.
* A future AI opponent emits the same `Command` objects a human does.

## 1.3 Layer diagram

```
┌───────────────────────────────────────────────────────────────┐
│  packages/client   (Phaser 3 + TypeScript, wrapped by Capacitor)│
│  ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │ Scenes   │ │ UI panels  │ │ Input/touch│ │ NetClient     │ │
│  │ Map/Menu │ │ Eco/Mil/…  │ │ pan+pinch  │ │ (Colyseus SDK)│ │
│  └────┬─────┘ └─────┬──────┘ └─────┬──────┘ └───────┬───────┘ │
│       └─────────────┴──────────────┘                │         │
│                 reads ViewState (read-only mirror)  │ sends   │
└─────────────────────────────────────────────────────┼─Command─┘
                                                      │ (WebSocket)
┌─────────────────────────────────────────────────────▼─────────┐
│  packages/server   (Node 20+, Colyseus room per match)         │
│  ┌───────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │ Lobby / codes │  │ WarRoom          │  │ Persistence     │ │
│  │ matchmaking   │  │ 5 Hz tick loop   │  │ SQLite/Supabase │ │
│  └───────────────┘  └────────┬─────────┘  └─────────────────┘ │
└──────────────────────────────┼────────────────────────────────┘
                               │ calls
┌──────────────────────────────▼────────────────────────────────┐
│  packages/shared   ← PURE. No engine. No I/O. No clock.        │
│  types · balance · map data · economy · buildings · research   │
│  · combat · commands (validate+apply) · tick · seeded RNG      │
└───────────────────────────────────────────────────────────────┘
```

`shared` is a dependency of both `client` and `server`. Neither depends on the other.

## 1.4 Tick model

* **Simulation tick: 5 Hz (200 ms).** Slow enough for phones and free-tier CPU, fast enough that RTS combat feels live. A whole 8-player, 44-territory tick costs < 1 ms.
* **Network broadcast: 5 Hz**, delta-encoded by Colyseus Schema — only changed fields go on the wire.
* **Client render: 30–60 fps**, interpolating army positions between the last two authoritative snapshots.
* **Commands** are queued by the server and applied at the *start* of the next tick, in a deterministic order (by `playerId`, then arrival index). No mid-tick mutation.

Time in the sim is **tick count**, never wall-clock. Build timers, research, and unit training are all "completes at tick N". This makes pause/resume (casual mode) and multi-day persistent worlds trivial: you save the tick number.

## 1.5 State partitioning (what the sim owns)

```
MatchState
├─ tick, phase (lobby|playing|paused|ended), seed, config
├─ players[]        id, name, leader{class,skills,cosmetics}, resources, alliance, connected
├─ territories[]    ownerId, pop, buildings[], garrison, terrain, econ, unrest
├─ armies[]         id, ownerId, from, to, progress, composition{}, stance, orders[]
├─ battles[]        territoryId, attackers[], defenders[], startedTick
├─ research[]       per player: unlocked tech ids, in-progress {techId, endTick}
├─ diplomacy        alliances, trade offers, war declarations
└─ eventLog[]       ring buffer of the last 200 events (drives the UI feed + tooltips)
```

## 1.6 Anti-cheat / desync policy

1. Clients **never** send state. They send `Command` objects (`BUILD`, `MOVE_ARMY`, `START_RESEARCH`, …).
2. The server runs `validateCommand(state, playerId, cmd)` before applying — ownership, adjacency, cost, slot availability, cooldown. A rejected command returns a typed reason so the UI can explain it.
3. Server → client sync is one-directional. A hacked client can only lie to itself.
4. Randomness (combat rolls) uses a **seeded PRNG stored in state**, advanced only by the server. Same seed + same commands = same result, which also gives us replays for free.
5. Rate limit: max 20 commands/sec/client, hard-dropped above that.

## 1.7 Disconnect / resume

* Colyseus `allowReconnection(client, 120s)` keeps the seat warm; the player's nation keeps simulating (AI "caretaker" holds position, doesn't attack).
* On reconnect the client receives a full state snapshot, not a delta — no replay needed.
* Casual mode: if **all** players drop, the room serializes `MatchState` to disk/DB and shuts down. Rejoining with the match code rehydrates it.

## 1.8 Where each feature from the brief lives

| Brief feature | Package | Phase |
|---|---|---|
| World map, territories, ownership | `shared/data`, `shared/sim/territory` | 1 |
| Economy (money/food/oil/materials/research) | `shared/sim/economy` | 1 |
| Buildings + 10 upgrade levels | `shared/sim/buildings` | 1 (3 types) → 2 (all) |
| Infantry combat | `shared/sim/combat` | 1 |
| Vehicles/air/naval | `shared/sim/combat` (same resolver, new unit rows) | 2 |
| Research trees ×4 | `shared/sim/research` | 2 |
| Leaders + skill tree | `shared/sim/leader` | 2 |
| Lobby, codes, reconnect | `server/rooms` | 1 |
| Alliances, trade, shared ops | `shared/sim/diplomacy` | 2–3 |
| Ranked, clans, persistent worlds | `server` + DB | 3 |
| Cosmetics/monetization | client-only data, never touches sim | 3 |

Nothing in Phase 2/3 requires re-architecting Phase 1 — every one of them is either a new row in a data table or a new `Command` type.
