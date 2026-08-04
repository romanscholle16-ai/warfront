import Phaser from 'phaser';
import type { LeaderAppearance, LeaderClass } from '@warfront/shared';
import { NetClient } from './net/NetClient.js';
import { MapScene } from './game/MapScene.js';
import { GameUI } from './ui/GameUI.js';
import { escapeHtml } from './ui/format.js';
import { AudioDirector } from './audio/AudioDirector.js';
import { LEADER_STYLES, leaderIcon } from './ui/cosmetics.js';

const net = new NetClient();
const mapScene = new MapScene();
const audio = new AudioDirector();
let game: Phaser.Game | null = null;
let ui: GameUI | null = null;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const screens = {
  menu: $('screen-menu'),
  lobby: $('screen-lobby'),
  game: $('screen-game'),
};

function showScreen(name: keyof typeof screens): void {
  for (const [key, element] of Object.entries(screens)) {
    element.classList.toggle('active', key === name);
  }
}

// ── menu ───────────────────────────────────────────────────────────────────

const nameInput = $<HTMLInputElement>('input-name');
const classInput = $<HTMLSelectElement>('input-class');
const codeInput = $<HTMLInputElement>('input-code');
const serverInput = $<HTMLInputElement>('input-server');
const uniformInput = $<HTMLSelectElement>('input-uniform');
const accessoryInput = $<HTMLSelectElement>('input-accessory');
const flagInput = $<HTMLSelectElement>('input-flag');
const colourInput = $<HTMLSelectElement>('input-colour');
const menuStatus = $('menu-status');

nameInput.value = localStorage.getItem('warfront.name') ?? '';
classInput.value = localStorage.getItem('warfront.class') ?? 'military';
serverInput.value = NetClient.defaultEndpoint();
uniformInput.value = localStorage.getItem('warfront.uniform') ?? 'standard';
accessoryInput.value = localStorage.getItem('warfront.accessory') ?? 'none';
flagInput.value = localStorage.getItem('warfront.flag') ?? 'plain';
colourInput.value = localStorage.getItem('warfront.colour') ?? '#e8493f';

function currentIdentity(): { name: string; leaderClass: LeaderClass; endpoint: string; appearance: Partial<LeaderAppearance> } {
  const name = nameInput.value.trim() || 'Commander';
  const leaderClass = (classInput.value || 'military') as LeaderClass;
  const endpoint = serverInput.value.trim() || NetClient.defaultEndpoint();
  localStorage.setItem('warfront.name', name);
  localStorage.setItem('warfront.class', leaderClass);
  const appearance = {
    uniform: uniformInput.value, accessory: accessoryInput.value,
    flag: flagInput.value, colour: colourInput.value,
    body: Number(localStorage.getItem('warfront.body') ?? 0),
    face: Number(localStorage.getItem('warfront.face') ?? 0),
    hair: Number(localStorage.getItem('warfront.hair') ?? 0),
  };
  for (const [key, value] of Object.entries(appearance)) localStorage.setItem(`warfront.${key}`, String(value));
  return { name, leaderClass, endpoint, appearance };
}

function setStatus(element: HTMLElement, text: string): void {
  element.textContent = text;
}

$('btn-create').addEventListener('click', async () => {
  const { name, leaderClass, endpoint, appearance } = currentIdentity();
  setStatus(menuStatus, 'Creating game…');
  try {
    const code = await net.create(endpoint, name, leaderClass);
    net.setAppearance(appearance);
    enterLobby(code);
  } catch (error) {
    setStatus(menuStatus, describeConnectionError(error, endpoint));
  }
});

$('btn-join').addEventListener('click', async () => {
  const { name, leaderClass, endpoint, appearance } = currentIdentity();
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    setStatus(menuStatus, 'A match code is 6 characters.');
    return;
  }
  setStatus(menuStatus, 'Joining…');
  try {
    await net.join(endpoint, code, name, leaderClass);
    net.setAppearance(appearance);
    enterLobby(code);
  } catch (error) {
    setStatus(menuStatus, describeConnectionError(error, endpoint));
  }
});

$('btn-scan').addEventListener('click', async () => {
  const { endpoint } = currentIdentity();
  const list = $('lobby-list');
  setStatus(menuStatus, 'Looking for games…');
  try {
    const lobbies = await net.listLobbies(endpoint);
    list.innerHTML = lobbies.length
      ? lobbies.map((lobby) => `
          <li>
            <div class="grow"><strong>${escapeHtml(lobby.code)}</strong>
            <span class="tag">${lobby.players}/${lobby.maxPlayers} players</span></div>
            <button data-join="${escapeHtml(lobby.code)}">Join</button>
          </li>`).join('')
      : '<li>No open games on this server.</li>';
    setStatus(menuStatus, '');
  } catch (error) {
    setStatus(menuStatus, describeConnectionError(error, endpoint));
  }
});

$('lobby-list').addEventListener('click', (event) => {
  const code = (event.target as HTMLElement).closest('button')?.getAttribute('data-join');
  if (!code) return;
  codeInput.value = code;
  $('btn-join').click();
});

// ── lobby ──────────────────────────────────────────────────────────────────

function enterLobby(code: string): void {
  $('lobby-code').textContent = code;
  setStatus(menuStatus, '');
  showScreen('lobby');
  renderLeaderStyles();
  applyLeaderCustomisation();
}

$('btn-ready').addEventListener('click', () => {
  const me = net.state?.players.get(net.sessionId);
  net.setReady(!me?.ready);
});

$('btn-start').addEventListener('click', () => net.startMatch());

$('btn-leave-lobby').addEventListener('click', async () => {
  await net.leave();
  showScreen('menu');
});

function renderLobby(): void {
  const state = net.state;
  if (!state) return;
  $('lobby-code').textContent = state.code;

  const list = $('lobby-players');
  const rows: string[] = [];
  state.players.forEach((player) => {
    rows.push(`<li>
      <span class="swatch" style="background:${player.colour}"></span>
      <span class="lobby-icon">${leaderIcon(player.appearance)}</span>
      <span>${escapeHtml(player.name)}${player.id === net.sessionId ? ' (you)' : ''}</span>
      <span class="tag ${player.ready ? 'ready' : ''}">${player.id === state.hostId ? 'HOST · ' : ''}${player.ready ? 'READY' : 'waiting'}</span>
    </li>`);
  });
  list.innerHTML = rows.join('');

  const startButton = $<HTMLButtonElement>('btn-start');
  startButton.disabled = !net.isHost;
  startButton.textContent = net.isHost ? 'Start War' : 'Waiting for host';
  setStatus($('lobby-status'), state.players.size < 2
    ? 'You can start solo to try things out, but this game is built for friends.'
    : '');
}

// ── lobby: real-leader avatar customisation (the player icon) ────────────

// Sanitise the saved choice: ids from the old emoji era (e.g. 'strongman') no
// longer exist, and a stale id would leave the picker with no selected card.
let leaderStyle = LEADER_STYLES.some((s) => s.id === (localStorage.getItem('warfront.style') ?? ''))
  ? localStorage.getItem('warfront.style')!
  : 'biden';

function stylePreset(): (typeof LEADER_STYLES)[number] {
  return LEADER_STYLES.find((s) => s.id === leaderStyle) ?? LEADER_STYLES[0]!;
}

function renderLeaderStyles(): void {
  const grid = $('leader-styles');
  grid.innerHTML = LEADER_STYLES.map((style) => (
    `<button class="style-card ${style.id === leaderStyle ? 'selected' : ''}" data-style="${style.id}">
      <span class="style-icon"><img src="${style.img}" alt="${style.name}" /></span>
      <strong>${escapeHtml(style.name)}</strong>
      <small>${escapeHtml(style.title)}</small>
    </button>`
  )).join('');
}

function applyLeaderCustomisation(): void {
  localStorage.setItem('warfront.style', leaderStyle);
  const preset = stylePreset();
  const appearance = {
    body: 0,
    face: preset.face,
    hair: 0,
    uniform: preset.uniform,
    accessory: preset.accessory,
    flag: preset.flag,
    colour: colourInput.value,
  };
  for (const [key, value] of Object.entries(appearance)) {
    localStorage.setItem(`warfront.${key}`, String(value));
  }
  $('lobby-portrait').innerHTML = leaderIcon(appearance);
  renderLeaderStyles();
  // Cosmetics are client-owned; the server stores them so every player sees the
  // same portrait. The appearance command is accepted pre-match, so this works
  // live while players are still readying up.
  net.setAppearance(appearance);
}

$('leader-styles').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('button[data-style]');
  if (!button) return;
  leaderStyle = button.getAttribute('data-style')!;
  applyLeaderCustomisation();
});

// ── in-match menu (☰): tutorials, settings, quit ─────────────────────────

const matchMenu = $('match-menu');
const menuTabs = document.querySelectorAll('#match-menu [data-menutab]');
const menuContents: Record<string, HTMLElement> = {
  tutorials: $('menu-tutorials'),
  settings: $('menu-settings'),
};

$('btn-menu').addEventListener('click', () => {
  matchMenu.classList.toggle('hidden');
});

$('menu-close').addEventListener('click', () => {
  matchMenu.classList.add('hidden');
});

matchMenu.addEventListener('click', (event) => {
  // Tapping the dark backdrop closes the menu without leaving the match.
  if (event.target === matchMenu) {
    matchMenu.classList.add('hidden');
    return;
  }
  const tab = (event.target as HTMLElement).closest('button[data-menutab]');
  if (tab) {
    const name = tab.getAttribute('data-menutab')!;
    for (const button of menuTabs) button.classList.toggle('active', button === tab);
    for (const [key, element] of Object.entries(menuContents)) {
      element.classList.toggle('hidden', key !== name);
    }
    return;
  }
  if ((event.target as HTMLElement).closest('#mute-music')) {
    audio.setMusicMuted(!audio.musicMuted);
    syncAudioUi();
  } else if ((event.target as HTMLElement).closest('#mute-sfx')) {
    audio.setSfxMuted(!audio.sfxMuted);
    syncAudioUi();
  }
});

const volMusic = $<HTMLInputElement>('vol-music');
const volSfx = $<HTMLInputElement>('vol-sfx');
volMusic.addEventListener('input', () => {
  audio.setMusicVolume(Number(volMusic.value) / 100);
  syncAudioUi();
});
volSfx.addEventListener('input', () => {
  audio.setSfxVolume(Number(volSfx.value) / 100);
  syncAudioUi();
});

function syncAudioUi(): void {
  volMusic.value = String(Math.round(audio.musicVolume * 100));
  volSfx.value = String(Math.round(audio.sfxVolume * 100));
  $('vol-music-val').textContent = `${Math.round(audio.musicVolume * 100)}%`;
  $('vol-sfx-val').textContent = `${Math.round(audio.sfxVolume * 100)}%`;
  $('mute-music').textContent = audio.musicMuted ? '🔊 Unmute music' : '🔇 Mute music';
  $('mute-sfx').textContent = audio.sfxMuted ? '🔊 Unmute effects' : '🔇 Mute effects';
}
syncAudioUi();

$('btn-quit').addEventListener('click', async () => {
  try {
    await net.leave();
  } finally {
    // Reset in the finally block so a rejected leave can never wedge the flag —
    // the next match must always be a fresh entry.
    matchMenu.classList.add('hidden');
    showScreen('menu');
    matchEntered = false;
    audio.playMenu();
  }
});

// ── game boot ──────────────────────────────────────────────────────────────

// The server pushes state at 5 Hz and startGame() is called on every playing sync,
// so the one-time entry work (UI reset, soundtrack switch, camera refocus) must run
// only on the first sync of a match — otherwise a live match would reset its own
// panels, restart its music and yank the camera back five times a second.
let matchEntered = false;

function startGame(): void {
  showScreen('game');
  const firstEntry = !matchEntered;
  if (firstEntry) {
    matchEntered = true;
    if (game) {
      // Re-entering after a quit: the renderer persists, but intent state must reset
      // and the soundtrack must switch back to match mode.
      ui?.reset();
      audio.playGame();
    }
  }

  if (!game) {
    game = new Phaser.Game({
      type: Phaser.AUTO, // WebGL where available, Canvas on old devices
      parent: 'map',
      backgroundColor: '#0b1016',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      // The game never uses Phaser's sound manager — all audio comes from
      // AudioDirector. Disabling it keeps a single AudioContext on the page;
      // a second live context (created by Phaser's WebAudio plugin) can make
      // audio fail on load, especially on iOS.
      audio: { noAudio: true },
      // Low-end devices: no physics, no audio decode, capped pixel ratio.
      render: { antialias: true, powerPreference: 'low-power' },
      fps: { target: 60, min: 30 },
      scene: [mapScene],
    });

    mapScene.bind(
      () => net.state,
      () => net.sessionId,
      (territoryId) => ui?.selectTerritory(territoryId),
    );

    ui = new GameUI(net, mapScene, audio);
    ui.start();
    audio.playGame();
  }

  // Centre on the player's own nation once, as soon as the map exists — also on
  // re-entry after a quit, so a fresh match always opens on your territory.
  if (firstEntry) {
    window.setTimeout(() => {
      const state = net.state;
      if (!state) return;
      for (const [id, territory] of state.territories) {
        if (territory.ownerId === net.sessionId) {
          mapScene.focus(id);
          break;
        }
      }
    }, 400);
  }
}

net.onState((state) => {
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'playing' || state.phase === 'paused') startGame();
});

net.onMatchOver(({ winnerTeam }) => {
  const state = net.state;
  const winners = state
    ? [...state.players.values()].filter((p) => p.team === winnerTeam).map((p) => p.name).join(', ')
    : '';
  const mine = state?.players.get(net.sessionId)?.team === winnerTeam;
  ui?.toast(mine ? `Victory! ${winners}` : `Defeat. ${winners} won.`, !mine);
  // Whatever happens next, a new match must start from a clean slate.
  matchEntered = false;
});

net.onLeave((code) => {
  // 1000 = normal close (we left on purpose). Anything else is a real disconnect.
  if (code === 1000) return;
  ui?.toast('Connection lost — trying to reconnect…', true);
  void attemptReconnect();
});

async function attemptReconnect(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    if (await net.tryReconnect()) {
      ui?.toast('Reconnected');
      return;
    }
  }
  ui?.toast('Could not reconnect. Returning to the menu.', true);
  showScreen('menu');
  matchEntered = false; // a later match is a fresh entry again
}

// ── battery ────────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  // A backgrounded phone should not render or play music. The server keeps
  // simulating; the seat is held by the reconnection window, so nothing is lost.
  if (document.hidden) {
    game?.loop.sleep();
    audio.suspend();
  } else {
    game?.loop.wake();
    audio.resume();
  }
});

document.addEventListener('pointerdown', () => {
  audio.unlock();
  if (!game) audio.playMenu();
}, { once: true });

// Dev-only handle for poking at a live match from the browser console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__warfront = {
    net,
    scene: mapScene,
    audio,
    game: () => game,
    ui: () => ui,
  };
}

function describeConnectionError(error: unknown, endpoint: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no_such_game|not found|4212/i.test(message)) return 'No game with that code.';
  if (/locked/i.test(message)) return 'That match has already started.';
  return `Cannot reach ${endpoint}. Check the server address under "Server".`;
}
