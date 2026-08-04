# 2. Engine Recommendation

## 2.1 Recommendation

> **TypeScript + Phaser 3 (WebGL) for the client, wrapped by Capacitor for Android/iOS.**
> **Node.js + Colyseus for the authoritative server.** One language across the whole stack.

Cost: **$0**. Every piece is MIT/Apache licensed and self-hostable.

## 2.2 Why, against the actual requirements

This game is a **2D map-based strategy game**: coloured territories, icons, arrows, panels, numbers. It is not a 3D battlefield. That single fact changes the correct engine choice — you are paying for a 3D engine's weight and build pipeline for a game that draws polygons and text.

| Requirement | How this stack satisfies it |
|---|---|
| Mobile-first, Android + iOS | Capacitor produces a real native shell for both from one web build |
| Low-end devices | Phaser 3 on WebGL draws this map in ~30 draw calls; APK ≈ 8–12 MB vs 45–70 MB for Unity |
| Free multiplayer | Colyseus is open source, runs on your laptop for LAN play, and fits any free cloud tier |
| Server-authoritative | Colyseus rooms *are* an authoritative server model — it is the framework's core premise |
| Shared simulation code | **Client and server run the literal same TypeScript sim module.** No porting, no drift |
| Fast iteration | Vite HMR: save file → phone on the same WiFi reloads in <1 s. No engine recompile |
| Already installed | Node 24 + npm 11 are on this machine; `npm install` is the entire setup |
| Scalable later | Rendering is one layer; the sim can be driven by a Godot/Unity/native client later unchanged |

The shared-simulation point is the decisive one. In a server-authoritative RTS you need the same rules on both sides (server = truth, client = prediction + instant UI feedback). With TypeScript on both ends that's one file imported twice. With Unity or Godot you either write the rules twice or run a headless instance of the engine as your server — both are real, recurring costs.

## 2.3 Alternatives considered, and why not

**Unity 6 (Unity Hub *is* installed on this machine)** — Runner-up, and the right choice if you later want 3D battle scenes.
Rejected for the MVP because: free multiplayer is the weak spot (Netcode for GameObjects needs Relay/Lobby, whose free tier is capped and metered; Mirror is free but you still host it yourself, so you gain nothing over Colyseus). Builds are minutes, not seconds. C# sim code can't run in the Node server without a second implementation. APK is 4–6× larger, which matters on low-end devices. iOS still needs a Mac either way, so Unity buys you nothing there.

**Godot 4** — Excellent, genuinely free, small binaries, and my recommendation *if the client were 3D*. Rejected because: not installed here; GDScript sim code can only be reused server-side by running headless Godot as a game server (works, but it's a heavier deploy target than Node on a free tier); the 2D UI/text-heavy work Phaser+HTML does effortlessly is more effort in Godot's Control nodes; and web-stack hot reload is much faster for a game that is 80% menus, numbers and tooltips.

**Flutter / React Native** — Great for the menus, wrong for a pannable real-time map with hundreds of moving markers. Ruled out.

**Unreal** — Wrong tool by an order of magnitude for a 2D mobile strategy game.

## 2.4 Concrete stack

| Layer | Choice | Licence | Why |
|---|---|---|---|
| Language | TypeScript 5 | Apache 2 | One language, catches sim/wire mismatches at compile time |
| Client renderer | Phaser 3.80 (WebGL, Canvas fallback) | MIT | Mature 2D, camera/pan/pinch, works on old Androids |
| UI panels | HTML/CSS over the canvas | — | Text, lists, tooltips are far cheaper in DOM than in a canvas widget kit |
| Bundler | Vite 5 | MIT | Instant HMR over LAN to a real phone |
| Native shell | Capacitor 6 | MIT | Android Studio + Xcode projects generated from the web build |
| Server | Node 20+ / Colyseus 0.15 | MIT | Rooms, match codes, reconnection, delta state sync out of the box |
| Wire format | @colyseus/schema | MIT | Binary delta encoding — only changed fields transmit |
| Sim tests | Vitest | MIT | Sim is pure, so tests are instant |
| DB (dev) | SQLite via better-sqlite3 | MIT | Zero-setup file DB |
| DB (later) | Supabase Postgres free tier | — | Same SQL, drop-in when you need accounts/ranked |

## 2.5 Device targets

* **Floor:** Android 8, 2 GB RAM, WebGL1 — the sim isn't on the phone, so the floor is set by rendering, which is trivial here.
* **iOS:** 13+ (WKWebView).
* **Orientation:** landscape-locked, as specified.
* **Battery:** render loop throttles to 30 fps with no input, and pauses entirely on `visibilitychange`; the socket keeps the seat alive with a 15 s heartbeat.

## 2.6 Honest limitations of this choice

1. **iOS builds still need a Mac + Xcode.** No stack avoids this. Android can be built entirely on this Windows machine.
2. **WebView ≠ native performance.** Irrelevant at this game's draw complexity; it would matter if you later add 3D battles — at which point the sim package survives the port and only the renderer is rewritten.
3. **Capacitor apps need a `capacitor.config` allowlist** for cleartext LAN traffic during dev (documented in the networking plan).
