# 3. Multiplayer Networking Plan

## 3.1 Requirement → solution

The brief asks for: free during development, LAN if possible, server-authoritative, no desync, 2–10 players, friend codes, reconnect.

These pull in opposite directions — *serverless P2P* is free but cannot be authoritative, and P2P with 8 phones needs 28 connections and a host that can lie. The resolution:

> **Run one authoritative server. Make *where* it runs a deployment detail, not an architecture detail.**

The exact same `packages/server` binary runs in three places:

| Mode | Where the server runs | Cost | Use |
|---|---|---|---|
| **A. LAN** (default for dev) | Your laptop on the same WiFi, or one player's phone later | $0 forever | 4–8 friends in a room. Zero internet needed |
| **B. Free cloud** | Fly.io / Render / Railway free tier, one small instance | $0 within tier | Friends in different houses |
| **C. Scaled** | Same image, N instances + Redis presence | paid, later | Ranked / persistent worlds |

Clients only ever change one string: the server URL. Nothing else in the codebase knows the difference.

## 3.2 Why not pure P2P / serverless

* **WebRTC mesh:** free STUN exists, but NAT traversal fails for ~10–15 % of mobile carriers without a TURN relay, and TURN is not free. Reliability is the problem, not cost.
* **Host-authority P2P:** whoever hosts can trivially cheat, and the match dies when the host's phone rings.
* **"Serverless" (Firebase/Supabase realtime as a message bus):** free tier, but it's a dumb pipe with no place to run an authoritative tick. You'd end up trusting clients.

LAN mode gets you the *actual* benefit people want from P2P — no cloud bill, no signup, sub-5 ms latency — while keeping a real authority.

## 3.3 Transport and topology

```
Phone A ─┐
Phone B ─┤   WebSocket (ws://) over WiFi        ┌─────────────────┐
Phone C ─┼──────────────────────────────────────► Colyseus server │
Phone D ─┘   ~1–5 ms LAN / 30–80 ms cloud       │  WarRoom(code)  │
                                                └─────────────────┘
```

* **WebSocket, not UDP.** Browsers/WebViews can't do raw UDP. At a 5 Hz tick with delta-encoded state, TCP head-of-line blocking is a non-issue — this is a strategy game, not a shooter.
* **One room = one match.** Room ID is the 6-character match code (`AB7K2Q`, ambiguous characters removed).
* **Bandwidth budget:** full snapshot ≈ 6–9 KB (44 territories, 8 players); typical delta ≈ 200–900 B at 5 Hz ≈ **1–4 KB/s per player**. An 8-player match costs ~30 KB/s upstream at the server — comfortably inside every free tier.

## 3.4 Message protocol

**Client → server** (the only thing a client may send):

```ts
type Command =
  | { t: 'BUILD';          territoryId: string; building: BuildingType; }
  | { t: 'UPGRADE';        territoryId: string; slot: number; }
  | { t: 'TRAIN';          territoryId: string; unit: UnitType; count: number; }
  | { t: 'MOVE_ARMY';      armyId: string; toTerritoryId: string; }
  | { t: 'SPLIT_ARMY';     armyId: string; composition: UnitCounts; }
  | { t: 'SET_STANCE';     armyId: string; stance: 'aggressive'|'defensive'|'hold'; }
  | { t: 'START_RESEARCH'; techId: string; }
  | { t: 'PROPOSE_ALLY' | 'ACCEPT_ALLY' | 'DECLARE_WAR'; targetPlayerId: string; }
  | { t: 'TRADE_OFFER';    targetPlayerId: string; give: Resources; want: Resources; }
  | { t: 'CHAT';           channel: 'all'|'team'; text: string; }
  | { t: 'PING_MAP';       territoryId: string; kind: 'attack'|'defend'|'help'; };
```

Every command is validated server-side (`validateCommand`) and either applied or answered with `{ t:'REJECT', reason }` so the UI can say *why* ("Not enough materials", "Territory not adjacent").

**Server → client:**
* `state` — Colyseus Schema delta, automatic, 5 Hz.
* `event` — one-shot notifications for effects the delta can't express: battle resolved, territory captured, tech completed, player disconnected. Drives toasts and the event feed.
* `reject` — command rejection with reason.
* `snapshot` — full state on join/reconnect.

## 3.5 Server tick loop

```
every 200 ms:
  1. drain command queue (deterministic order: by playerId, then arrival index)
  2. validate + apply each command
  3. tick simulation: economy → construction → training → research → army movement
     → battle resolution → population → victory check
  4. mirror MatchState into the Colyseus Schema (framework computes the delta)
  5. flush queued events
```

Sim cost measured target: **< 2 ms/tick** for 10 players / 60 territories / 200 armies. That leaves a free-tier shared vCPU able to host several concurrent matches.

## 3.6 Client-side smoothing (no rollback needed)

This game does not need lockstep or rollback netcode:

* **Army movement** is the only continuously-changing quantity. The client interpolates `progress` between the last two snapshots — visually smooth at 5 Hz.
* **Resources** tick predictably; the client extrapolates the counter locally between snapshots and hard-snaps on each authoritative update. Players see numbers rising smoothly.
* **Buildings/research** are timers with a known end tick — rendered locally, no prediction risk.
* **Optimistic UI:** on tapping "Build", the client greys the slot immediately and reverts if a `reject` arrives. Cheap, and it hides all LAN latency.

## 3.7 Lobby and match codes

1. Host taps **Create Game** → `POST` to matchmaker → room created with a generated 6-char code.
2. Friends tap **Join** → enter code → `joinById(code)`.
3. **LAN discovery bonus:** the server also answers a UDP broadcast on port 41234 with its IP; the client's "Games on this WiFi" list is populated without typing anything. Falls back to manual code entry if broadcast is blocked.
4. Lobby state: players, ready flags, team assignment, map/mode/speed settings. Host presses **Start** → room phase `lobby → playing`.
5. **Deep links** (`warfront://join/AB7K2Q`) for share-sheet invites — Capacitor handles the URL scheme on both platforms.

## 3.8 Disconnect handling

| Event | Behaviour |
|---|---|
| Brief drop (< 120 s) | Seat held via `allowReconnection`. Nation keeps simulating under a passive caretaker AI: defends, doesn't attack, doesn't spend. |
| Rejoin | Full snapshot pushed; client rebuilds view; no replay |
| Long drop | Nation goes AI-controlled for the rest of the match (competitive) or the match auto-pauses (casual, if the host enabled it) |
| Host leaves | Nothing happens — the server is not a player |
| Server restart | `MatchState` is serialized every 30 s; the room rehydrates on boot (persistent-world mode) |

## 3.9 Dev-mode specifics for phones on WiFi

* Vite dev server binds `0.0.0.0`; phones open `http://<laptop-ip>:5173`.
* Colyseus listens on `0.0.0.0:2567`.
* Android release/dev builds need `android:usesCleartextTraffic="true"` (dev only) — plain `ws://` on LAN.
* iOS needs an `NSAppTransportSecurity` local-networking exception in dev builds only.
* Production uses `wss://` with the free TLS the cloud host provides, and both exceptions are removed.

## 3.10 Scaling path (nothing here is rework)

1. **Now:** one process, in-memory rooms, LAN.
2. **Friends over internet:** same process on a free-tier VM.
3. **Ranked:** add Colyseus' Redis presence + driver → many processes, one matchmaker. Room code logic unchanged.
4. **Persistent worlds:** rooms hibernate to Postgres and wake on demand; the sim's tick-based clock means a world can advance in scheduled bursts instead of running 24/7 — which is what makes multi-day campaigns affordable.
