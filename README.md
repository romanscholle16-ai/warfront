# WARFRONT: Global Conquest

A mobile-first, real-time strategy game for Android and iOS. Modern Earth, 48 territories,
4–8 friends on their own phones, server-authoritative multiplayer that costs nothing to run.

**Status: Phase 1 MVP core is built and verified.** Lobby, codes, world map, territory
ownership, five-resource economy, buildings with 10 upgrade levels, infantry combat,
capture, victory, advisor and reconnection all work end to end.

---

## Documents

| | |
|---|---|
| [Architecture plan](docs/01-architecture.md) | Layers, tick model, anti-cheat, where every brief feature lives |
| [Engine recommendation](docs/02-engine-recommendation.md) | Why TypeScript + Phaser + Capacitor, and what was rejected |
| [Multiplayer networking](docs/03-multiplayer-networking.md) | LAN-first, free-tier cloud, protocol, disconnect handling |
| [Database design](docs/04-database-design.md) | Schema, why live matches never touch the DB |
| [MVP milestones](docs/05-mvp-milestones.md) | M0–M17 with exit criteria |

## The one thing to understand

```
packages/shared   ← the game. Pure TypeScript. No engine, no network, no clock, no random.
      ↑                                    ↑
packages/server   ← runs it authoritatively    packages/client ← renders it, sends intents
```

`(State, Command[]) -> State`. The server owns the only real copy. Clients send commands
and are told what happened. That is what makes cheating structurally impossible and lets
the same code run in unit tests, on a laptop, or on a free cloud instance.

## Quick start

```bash
npm install
npm run dev
```

That builds the shared simulation, starts the authoritative server on `:2567` and the
client on `:5173`. Open `http://localhost:5173`, tap **Create Game**, and share the
6-character code.

### Playing across phones on the same WiFi

1. Start the server on a laptop: `npm run dev`. It prints the address to use, e.g.
   `ws://192.168.1.10:2567`.
2. On each phone, open `http://192.168.1.10:5173` in a browser (or install the APK).
3. One player taps **Create Game**; the rest enter the code. No accounts, no internet, no cost.

If the phone can't reach the laptop, open **Server** on the menu screen and paste the
`ws://…` address the server printed.

## Commands

```bash
npm run dev            # server + client, hot reload, LAN-visible
npm run dev:server     # authoritative server only
npm run dev:client     # client only
npm test               # 20 simulation tests (map, economy, combat, determinism, stability)
npm run balance        # headless 4-player, 30-minute match with an economy report
npm run integration    # two real clients against a running server, end to end
npm run typecheck      # whole monorepo
```

## Building the mobile apps

```bash
cd packages/client
npm run cap:add:android   # once — generates the Android Studio project
npm run android           # build + sync + open Android Studio
```

iOS is identical (`cap:add:ios`, `npm run ios`) but requires a Mac with Xcode. Android
builds fine on Windows.

Development builds allow cleartext `ws://` so phones can reach a laptop on the LAN
(`capacitor.config.ts`). **Remove that before shipping** — production uses `wss://`.

## Project layout

```
warfront/
├── docs/                        the five design documents
├── tools/
│   ├── balance.mjs              headless match runner + economy report
│   └── integration.mjs          two-client end-to-end multiplayer check
└── packages/
    ├── shared/                  THE GAME — pure, engine-free, 100 % testable
    │   └── src/
    │       ├── types.ts         complete data model
    │       ├── config/          balance data: constants, buildings, units, tech, leaders
    │       ├── data/worldMap.ts 48 territories, adjacency, terrain, real lon/lat
    │       ├── util/rng.ts      seeded PRNG stored in state → replays, no desync
    │       └── sim/             economy · construction · armies · combat · commands
    │                            · tick · advisor · modifiers
    ├── server/                  authoritative Colyseus room
    │   └── src/
    │       ├── index.ts         HTTP (codes, lobbies, health) + WebSocket
    │       ├── codes.ts         unambiguous 6-character match codes
    │       ├── lanDiscovery.ts  UDP responder for "games on this WiFi"
    │       └── rooms/
    │           ├── WarRoom.ts   5 Hz tick, command intake, reconnection, caretaker AI
    │           └── schema.ts    wire model + sim → schema mirroring (delta encoded)
    └── client/                  Phaser map + HTML UI, wrapped by Capacitor
        └── src/
            ├── main.ts          menu → lobby → match, reconnect, battery handling
            ├── net/             NetClient + the read-only view model
            ├── game/MapScene.ts world map, pan/pinch/tap
            └── ui/GameUI.ts     resource bar, panels, advisor, toasts
```

## What is deliberately not built yet

Phase 2 and 3 features are **specified and wired but gated**, not missing by accident:

- Vehicles, air and naval units are fully statted in `config/units.ts` and run through
  the same combat resolver — they are gated by `mvp: false` and the buildings that unlock them.
- All four research trees (130 techs) exist and apply real modifiers; the UI lists them.
- Leader classes work and modify the simulation. Appearance, uniforms and the skill tree
  are Phase 2 — and are cosmetic, never sold for advantage.
- Ranked, clans and persistent worlds need the database in
  [docs/04-database-design.md](docs/04-database-design.md); the MVP runs entirely in memory
  on purpose, so four friends can play tonight with zero setup.

## Design rules for anyone extending this

1. New gameplay arrives as a **new `Command` type plus a data row**. If a feature needs a
   change to the tick loop or the sync layer, re-read the architecture doc first.
2. Balance numbers live in `packages/shared/src/config`. Never inline them in logic.
3. Nothing under `src/sim` may import an engine, touch the network, call `Date.now()` or
   `Math.random()`. Time is `tick`; randomness is the seeded RNG in state.
4. Every simulation change ships with a Vitest case. The sim is the only thing here that
   is genuinely expensive to debug on someone else's phone.
