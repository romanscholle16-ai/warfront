# 5. MVP Milestone List

Each milestone ends in something you can **put on a phone and play**. No milestone is "refactoring". Estimates assume one developer.

---

## PHASE 1 — Playable MVP

### M0 — Skeleton *(done in this commit)*
Monorepo, shared/server/client packages, TypeScript strict, Vitest, Vite, Colyseus boot.
**Done when:** `npm run dev` starts the server and the client, and the sim's unit tests pass.

### M1 — The simulation core *(done in this commit)*
Map data (44 territories, adjacency, terrain), resources, buildings, construction queue, army movement, infantry combat, victory check, command validation, seeded RNG.
**Done when:** a headless test simulates 5 000 ticks of a 4-player match with no errors and plausible economies.

### M2 — Authoritative room *(done in this commit)*
Colyseus `WarRoom`: join by code, lobby, ready-up, start, 5 Hz tick, delta state sync, command intake + rejection, reconnection window.
**Done when:** two browser tabs join by code, both see the same world, and a build in one appears in the other within 200 ms.

### M3 — Playable map client *(done in this commit)*
Phaser map render, pan/pinch, territory selection, ownership colours, army markers, HUD resource bar, build panel, recruit panel, army move orders, event feed.
**Done when:** you can win a 1v1 from the UI without touching a console.

### M4 — On the phone *(~2 days)*
Capacitor Android project, landscape lock, safe-area insets, touch target pass (min 44 px), LAN URL entry screen, cleartext dev exception, APK built and sideloaded.
**Done when:** two physical Android phones on the same WiFi play a full match against each other.

### M5 — Feel *(~3 days)*
Onboarding (interactive first-match tutorial, ≤ 5 min), advisor suggestions ("excess food → build farms", "enemy border weak → attack"), tooltips everywhere, auto-battle toggle for beginners, toast notifications, sound stubs.
**Done when:** someone who has never seen the game plays a match without asking you a question.

### M6 — Robustness *(~2 days)*
Reconnect, pause/resume (casual), caretaker AI for dropped players, match end screen + stats, error boundaries, 30 fps idle throttle, battery profiling.
**Done when:** you can kill a phone's WiFi for 60 s mid-battle and rejoin cleanly.

**→ Phase 1 exit criterion: 4–8 friends on their own phones play a 30-minute match, start to finish, with no crashes and no desync.**

---

## PHASE 2 — Depth

### M7 — Full unit roster *(~4 days)*
Vehicles, air, naval. Terrain modifiers (mountain defence, coastal naval, city income), rock-paper-scissors counter matrix, army composition UI, stances, formations for advanced play.

### M8 — Research *(~4 days)*
Four trees × 10 levels (military / economy / infrastructure / technology), research point economy, tree UI with prerequisite lines, effects applied as sim modifiers.

### M9 — Leaders *(~4 days)*
Creator (appearance, clothing, uniform, accessories), four classes with real modifiers, three-branch skill tree (warfare / economy / intelligence), XP and levels, persistence via SQLite.

### M10 — Buildings to level 10 *(~3 days)*
All 13 building types across economic/military/technology, tiered upgrade curve with named tiers (Basic farming → Industrial → AI agriculture), slot rules per terrain.

### M11 — Diplomacy *(~3 days)*
Alliances, resource trading, shared vision, joint operations, in-match chat, map pings, betrayal mechanics.

**→ Phase 2 exit criterion: a match has genuine strategic branching — three viable win paths (military rush / economic snowball / tech supremacy).**

---

## PHASE 3 — Live game

### M12 — Accounts + persistence *(~4 days)* — Supabase, device→social account upgrade, profiles.
### M13 — Ranked *(~5 days)* — 1v1 / 2v2 / 4v4 / FFA8 queues, Elo, seasons, leaderboards.
### M14 — Persistent worlds *(~6 days)* — 10-player global conquest, slow clock, hibernate/wake, multi-day campaigns.
### M15 — Clans *(~4 days)* — creation, roles, clan wars, clan chat.
### M16 — Monetization *(~4 days)* — cosmetic store (skins, leader items, flags, base designs), seasonal pass, IAP via Capacitor. **Nothing sold touches the sim.**
### M17 — Ship *(~5 days)* — iOS build on a Mac, store listings, privacy manifests, crash reporting, analytics, soft launch.

---

## Ordering rules

1. **Never build Phase 2 content before Phase 1 is playable on two physical phones.** Content is cheap to add later; the wrong architecture is not.
2. **Every new feature must arrive as a new `Command` type + a new data row.** If a feature needs a change to the tick loop or the sync layer, stop and re-read the architecture doc.
3. **Balance data stays in typed config**, never hard-coded in logic, so tuning is a one-file change.
4. **Every sim change ships with a Vitest case.** The sim is the only thing in this project that is genuinely expensive to debug remotely.

## Risk register

| Risk | Mitigation |
|---|---|
| Scope creep from the full brief | Phase gates above; content additions are data, not code |
| Free cloud tier sleeps/cold starts | LAN mode is the primary dev path; cloud is optional |
| iOS needs a Mac | Android-first; borrow/rent a Mac at M17 only |
| RTS too complex for 5-minute onboarding | M5 is a *gate*, not a nice-to-have: auto-battle + advisor before any Phase 2 work |
| Sim performance on 10-player worlds | Pure sim = trivially profilable; budget is 2 ms/tick, measured in CI |
