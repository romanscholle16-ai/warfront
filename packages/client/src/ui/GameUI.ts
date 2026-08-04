import {
  ADJACENCY, BUILDINGS, BUILDING_LIST, LEADER_CLASSES, MAX_BUILDING_LEVEL,
  MAX_SKILL_POINTS_PER_BRANCH, MAX_TECH_LEVEL, RESOURCE_KEYS, TECH_BRANCHES, TECH_BY_ID,
  TERRITORY_DEFS, UNITS, UNIT_LIST, availableTechs, buildingCost, canAfford, tierName,
} from '@warfront/shared';
import type {
  BuildingCategory, BuildingType, Command, GameEvent, ResourceDelta, ResourceKey,
  SkillBranch, Stance, UnitCounts, UnitType,
} from '@warfront/shared';
import type { NetClient, Suggestion } from '../net/NetClient.js';
import type { MatchView, PlayerView, TerritoryView } from '../net/view.js';
import { decodeDelta, decodeUnits } from '../net/view.js';
import type { MapScene } from '../game/MapScene.js';
import type { AudioDirector } from '../audio/AudioDirector.js';
import { RESOURCE_ICONS, compact, costLine, escapeHtml, rate, ticksToClock } from './format.js';
import { leaderIcon } from './cosmetics.js';

type Tab = 'world' | 'economy' | 'military' | 'research' | 'diplomacy' | 'leader';

/** Per-tab war-room identity — feeds the themed banner atop every panel. */
const TAB_META: Record<Tab, { emblem: string; title: string; sub: string }> = {
  world: { emblem: '🗺', title: 'WORLD', sub: 'Theatre of operations' },
  economy: { emblem: '⚙', title: 'ECONOMY', sub: 'War production' },
  military: { emblem: '⚔', title: 'MILITARY', sub: 'Order of battle' },
  research: { emblem: '⚗', title: 'RESEARCH', sub: 'Weapons laboratories' },
  diplomacy: { emblem: '🕊', title: 'ALLIES', sub: 'Pact & trade desk' },
  leader: { emblem: '★', title: 'LEADER', sub: 'Supreme command' },
};

const STANCE_LABELS: Record<Stance, { label: string; hint: string }> = {
  aggressive: { label: 'Attack', hint: 'More damage, less protection. Use when pushing.' },
  defensive: { label: 'Defend', hint: 'Balanced. Can still take ground.' },
  hold: { label: 'Dig in', hint: 'Heavy defence, but will not capture territory.' },
};

const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  economic: 'Economic',
  military: 'Military',
  technology: 'Technology',
};

const CATEGORY_ICONS: Record<BuildingCategory, string> = {
  economic: '🏭', military: '🪖', technology: '🔬',
};

const BUILDING_ICONS: Record<BuildingType, string> = {
  farm: '🌾', commercial: '🏙️', factory: '🏭', mine: '⛏️', power_plant: '⚡',
  barracks: '🪖', academy: '🎓', vehicle_plant: '🚜', airbase: '✈️', naval_base: '⚓',
  research_center: '🔬', university: '🏛️', advanced_lab: '🧪',
};

const UNIT_ICONS: Record<UnitType, string> = {
  rifle: '🔫', marine: '🌊', special_forces: '🎯', apc: '🚐', tank: '🛡️',
  helicopter: '🚁', fighter: '🛩️', bomber: '💣', destroyer: '🚢', submarine: '🐬', carrier: '🛳️',
};

/**
 * All in-match UI.
 *
 * Rendering is pull-based: the server pushes state at 5 Hz and this class re-renders
 * the visible panel from it. There is no local game state here — if a value appears on
 * screen, the server said it. The only local state is *intent* (what the player is in
 * the middle of doing), which is why the fields below are all about pending actions.
 */
export class GameUI {
  private tab: Tab = 'world';
  private selectedTerritory: string | null = null;
  /** Army awaiting a destination tap. */
  private movingArmyId: string | null = null;
  /** Army whose composition is being split, plus the counts chosen so far. */
  private splitArmyId: string | null = null;
  private splitCounts: Record<string, number> = {};
  /** Trade being composed: who it is for and the two halves. */
  private tradeTargetId: string | null = null;
  private tradeGive: Record<string, number> = {};
  private tradeWant: Record<string, number> = {};
  private pendingAdvice: Suggestion[] = [];
  private dismissedAdvice = new Set<string>();
  private adviceTimers = new Map<string, number>();
  private feedEntries: string[] = [];
  private chatLog: Array<{ who: string; colour: string; text: string }> = [];
  private lastRender = 0;

  private readonly el = {
    resources: document.getElementById('resource-bar')!,
    advisor: document.getElementById('advisor')!,
    feed: document.getElementById('feed')!,
    panel: document.getElementById('panel')!,
    panelTitle: document.getElementById('panel-title')!,
    panelBody: document.getElementById('panel-body')!,
    panelClose: document.getElementById('panel-close')!,
    nav: document.getElementById('hud-bottom')!,
    commander: document.getElementById('commander-badge')!,
    badge: document.getElementById('diplo-badge')!,
    toasts: document.getElementById('toast-host')!,
  };

  constructor(
    private readonly net: NetClient,
    private readonly map: MapScene,
    private readonly audio: AudioDirector,
  ) {}

  start(): void {
    this.el.nav.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button[data-tab]');
      if (!button) return;
      this.setTab(button.getAttribute('data-tab') as Tab);
    });

    this.el.panelClose.addEventListener('click', () => this.closePanel());
    this.el.commander.addEventListener('click', () => this.setTab('leader'));

    const screen = document.getElementById('screen-game')!;
    screen.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button[data-action]');
      if (button) this.handleAction(button as HTMLButtonElement);
    });
    // Sliders and number fields feed the split/trade composers.
    screen.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.split) {
        this.splitCounts[input.dataset.split] = Number(input.value);
        const label = document.getElementById(`split-count-${input.dataset.split}`);
        if (label) label.textContent = input.value;
      } else if (input.dataset.give) {
        this.tradeGive[input.dataset.give] = Math.max(0, Number(input.value) || 0);
      } else if (input.dataset.want) {
        this.tradeWant[input.dataset.want] = Math.max(0, Number(input.value) || 0);
      }
    });
    screen.addEventListener('keydown', (event) => {
      const target = event.target as HTMLInputElement;
      if ((event as KeyboardEvent).key === 'Enter' && target.id === 'chat-input') this.sendChat();
    });

    this.net.onState(() => this.render());
    this.net.onEvents((events) => this.handleEvents(events));
    this.net.onReject((payload) => this.toast(payload.message ?? humanReason(payload.reason), true));
    this.net.onAdvice((suggestions) => this.renderAdvisor(suggestions));

    window.setInterval(() => this.net.requestAdvice(), 5000);
    this.net.requestAdvice();
  }

  /**
   * Forget every in-progress intent. Called when a player quits to the menu and
   * starts a new match — the renderer persists, but nothing else should.
   */
  reset(): void {
    this.tab = 'world';
    this.selectedTerritory = null;
    this.movingArmyId = null;
    this.splitArmyId = null;
    this.splitCounts = {};
    this.tradeTargetId = null;
    this.tradeGive = {};
    this.tradeWant = {};
    this.chatLog = [];
    this.feedEntries = [];
    this.el.panel.classList.add('hidden');
    this.el.feed.innerHTML = '';
    this.map.select(null);
    this.map.highlight([]);
    this.syncNav();
  }

  /** Called by the map when a territory is tapped. */
  selectTerritory(territoryId: string): void {
    if (this.movingArmyId) {
      this.net.send({ t: 'MOVE_ARMY', armyId: this.movingArmyId, toTerritoryId: territoryId });
      this.movingArmyId = null;
      this.map.highlight([]);
      this.toast(`Advancing on ${TERRITORY_DEFS[territoryId]?.name ?? territoryId}`);
      this.audio.effect('move');
      return;
    }
    this.selectedTerritory = territoryId;
    this.splitArmyId = null;
    this.map.select(territoryId);
    this.tab = 'world';
    this.syncNav();
    this.el.panel.classList.remove('hidden');
    this.render(true);
  }

  // ── rendering ────────────────────────────────────────────────────────────

  render(force = false): void {
    const state = this.net.state;
    if (!state) return;
    const now = performance.now();
    if (!force && now - this.lastRender < 250) return;
    this.lastRender = now;

    this.renderResources(state);
    this.renderBadge(state);
    this.map.setPings([...state.pings]);
    const active = document.activeElement as HTMLElement | null;
    // Never replace a live text box while a player is composing a chat/trade message.
    if (!this.el.panel.classList.contains('hidden') && active?.matches('input, textarea')) return;
    if (!this.el.panel.classList.contains('hidden')) this.renderPanel(state);
  }

  private renderResources(state: MatchView): void {
    const me = state.players.get(this.net.sessionId);
    if (!me) return;
    const parts: string[] = [];
    for (const key of RESOURCE_KEYS) {
      const value = me.resources[key] ?? 0;
      const flow = me.income[key] ?? 0;
      parts.push(
        `<div class="res"><span class="icon">${RESOURCE_ICONS[key]}</span>`
        + `<span class="value">${compact(value)}</span>`
        + `<span class="rate ${flow < 0 ? 'negative' : ''}">${rate(flow)}</span></div>`,
      );
    }
    this.el.resources.innerHTML = parts.join('');
    this.el.commander.innerHTML = leaderIcon(me.appearance);
    this.el.commander.setAttribute('title', `${me.leaderName || me.name} — open leader profile`);
    (this.el.commander as HTMLElement).style.borderColor = me.appearance.colour || me.colour;
  }

  /** Anything waiting on the player — alliance offers and incoming trades. */
  private renderBadge(state: MatchView): void {
    const me = state.players.get(this.net.sessionId);
    if (!me) return;
    const offers = me.allianceOffers ? me.allianceOffers.split(',').filter(Boolean).length : 0;
    const trades = [...state.tradeOffers].filter((o) => o.toId === me.id).length;
    const total = offers + trades;
    this.el.badge.textContent = String(total);
    this.el.badge.classList.toggle('hidden', total === 0);
  }

  private renderAdvisor(suggestions: Suggestion[]): void {
    this.pendingAdvice = suggestions;
    const visible = suggestions.filter((s) => !this.dismissedAdvice.has(adviceKey(s)));
    if (!visible.length) {
      this.el.advisor.innerHTML = '';
      return;
    }
    this.el.advisor.innerHTML = visible.slice(0, 3).map((s) => `
      <div class="advice">
        <button class="advice-close" data-action="dismiss-advice" data-key="${adviceKey(s)}" aria-label="Dismiss suggestion">×</button>
        <strong>${escapeHtml(s.title)}</strong>
        <p>${escapeHtml(s.detail)}</p>
        ${s.territoryId ? `<button data-action="focus" data-territory="${s.territoryId}">Show me</button>` : ''}
        ${s.command ? `<button data-action="advice" data-index="${this.pendingAdvice.indexOf(s)}">Do it</button>` : ''}
      </div>`).join('');
    for (const suggestion of visible) {
      const key = adviceKey(suggestion);
      if (!this.adviceTimers.has(key)) {
        this.adviceTimers.set(key, window.setTimeout(() => this.dismissAdvice(key), 5000));
      }
    }
  }

  private dismissAdvice(key: string): void {
    this.dismissedAdvice.add(key);
    const timer = this.adviceTimers.get(key);
    if (timer) window.clearTimeout(timer);
    this.adviceTimers.delete(key);
    this.renderAdvisor(this.pendingAdvice);
  }

  private handleEvents(events: GameEvent[]): void {
    const state = this.net.state;
    for (const event of events) {
      if (event.type === 'chat') {
        const fromId = String(event.data?.from ?? '');
        const player = state?.players.get(fromId);
        this.chatLog.push({
          who: player?.name ?? 'Unknown',
          colour: player?.colour ?? '#8b949e',
          text: event.text,
        });
        this.chatLog = this.chatLog.slice(-40);
        if (this.tab !== 'diplomacy') this.toast(`${player?.name ?? '?'}: ${event.text}`);
        continue;
      }

      this.feedEntries.unshift(event.text);
      if (['territory_captured', 'battle_started', 'research_completed', 'match_ended',
        'alliance_formed', 'alliance_offered', 'betrayal', 'trade_offered',
        'trade_completed', 'leader_level_up'].includes(event.type)) {
        this.toast(event.text);
      }
      if (event.type === 'ping' && event.territoryId) this.map.focus(event.territoryId);
    }
    this.feedEntries = this.feedEntries.slice(0, 6);
    this.el.feed.innerHTML = this.feedEntries.map((t) => `<div>${escapeHtml(t)}</div>`).join('');
  }

  toast(text: string, bad = false): void {
    const node = document.createElement('div');
    node.className = `toast${bad ? ' bad' : ''}`;
    node.textContent = text;
    this.el.toasts.appendChild(node);
    window.setTimeout(() => node.remove(), 2600);
  }

  // ── panel routing ────────────────────────────────────────────────────────

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.splitArmyId = null;
    this.syncNav();
    this.el.panel.dataset.tab = tab;
    if (tab === 'world' && !this.selectedTerritory) this.closePanel();
    else this.el.panel.classList.remove('hidden');
    this.render(true);
  }

  private syncNav(): void {
    for (const button of this.el.nav.querySelectorAll('button[data-tab]')) {
      button.classList.toggle('active', button.getAttribute('data-tab') === this.tab);
    }
  }

  private closePanel(): void {
    this.el.panel.classList.add('hidden');
    this.selectedTerritory = null;
    this.splitArmyId = null;
    this.map.select(null);
    this.map.highlight([]);
    this.movingArmyId = null;
  }

  private renderPanel(state: MatchView): void {
    const me = state.players.get(this.net.sessionId);
    if (!me) return;
    this.el.panel.dataset.tab = this.tab;
    switch (this.tab) {
      case 'world': return this.renderTerritoryPanel(state, me);
      case 'economy': return this.renderEconomyPanel(state, me);
      case 'military': return this.renderMilitaryPanel(state, me);
      case 'research': return this.renderResearchPanel(state, me);
      case 'diplomacy': return this.renderDiplomacyPanel(state, me);
      case 'leader': return this.renderLeaderPanel(state, me);
    }
  }

  /** War-room header strip — emblem, title and flavour line, themed per tab. */
  private panelBanner(): string {
    const meta = TAB_META[this.tab];
    return `<div class="war-banner">
      <span class="war-banner-emblem">${meta.emblem}</span>
      <div class="grow"><strong>${meta.title}</strong><small>${meta.sub}</small></div>
      <span class="war-banner-rune">★</span>
    </div>`;
  }

  // ── world / territory ────────────────────────────────────────────────────

  private renderTerritoryPanel(state: MatchView, me: PlayerView): void {
    const id = this.selectedTerritory;
    if (!id) {
      this.el.panelTitle.textContent = 'World';
      this.el.panelBody.innerHTML = `${this.panelBanner()}<p class="hint">Tap a territory on the map.</p>`;
      return;
    }
    const def = TERRITORY_DEFS[id]!;
    const territory = state.territories.get(id);
    if (!territory) return;

    const owner = territory.ownerId ? state.players.get(territory.ownerId) : null;
    const mine = territory.ownerId === me.id;
    this.el.panelTitle.textContent = def.name;

    const armiesHere = [...state.armies.values()].filter((a) => a.at === id && !a.movingTo);
    const html: string[] = [this.panelBanner()];

    html.push(`<div class="stat-grid">
      <div class="stat"><div class="k">Owner</div><div class="v" style="color:${owner?.colour ?? '#8b949e'}">${owner ? escapeHtml(owner.name) : 'Unclaimed'}</div></div>
      <div class="stat"><div class="k">Terrain</div><div class="v">${def.terrain}${def.coastal ? ' · coastal' : ''}</div></div>
      <div class="stat"><div class="k">Population</div><div class="v">${compact(territory.pop * 1000)}</div></div>
      <div class="stat"><div class="k">Slots</div><div class="v">${territory.buildings.length}/${def.slots}</div></div>
      ${territory.unrest > 0.05 ? `<div class="stat"><div class="k">Unrest</div><div class="v">${Math.round(territory.unrest * 100)}%</div></div>` : ''}
    </div>`);

    html.push(`<div class="chip-row">
      <button class="chip" data-action="ping" data-territory="${id}" data-kind="attack">📣 Attack here</button>
      <button class="chip" data-action="ping" data-territory="${id}" data-kind="defend">🛡 Defend here</button>
      <button class="chip" data-action="ping" data-territory="${id}" data-kind="help">🆘 Need help</button>
    </div>`);

    if (armiesHere.length) {
      html.push('<div class="section-title">Forces present</div>');
      for (const army of armiesHere) {
        html.push(this.armyRow(state, army.id, army.ownerId === me.id));
      }
    }

    if (mine) {
      html.push('<div class="section-title">Build</div>');
      html.push(this.buildingCatalogue(state, me, territory, def.slots));
      html.push('<div class="section-title">Recruit</div>');
      html.push(this.recruitCatalogue(state, me, territory));
    }

    this.el.panelBody.innerHTML = html.join('');
  }

  /**
   * The FULL catalogue (M10), with locked entries shown and explained rather than
   * hidden. A player should be able to see that a Naval Base exists and learn that it
   * needs a coast — hiding it just makes the game feel arbitrary.
   */
  private buildingCatalogue(state: MatchView, me: PlayerView, territory: TerritoryView, slots: number): string {
    const def = TERRITORY_DEFS[territory.id]!;
    const existing = new Map<string, { level: number; targetLevel: number; completesAtTick: number }>();
    territory.buildings.forEach((b) => existing.set(b.type, b));

    const out: string[] = [];
    for (const category of ['economic', 'military', 'technology'] as BuildingCategory[]) {
      const buildings = BUILDING_LIST.filter((b) => b.category === category);
      out.push(`<div class="section-title">${CATEGORY_ICONS[category]} ${CATEGORY_LABELS[category]}</div>`);

      for (const building of buildings) {
        const current = existing.get(building.id);
        const level = current?.level ?? 0;
        const inProgress = (current?.completesAtTick ?? 0) > 0;
        const nextLevel = level + 1;
        const cost = buildingCost(building.id, Math.min(nextLevel, MAX_BUILDING_LEVEL));
        const affordable = canAfford(me.resources, cost);

        let lock: string | null = null;
        if (building.requiresCoastal && !def.coastal) lock = 'Needs a coastal territory';
        else if (building.requiresTerrain && !building.requiresTerrain.includes(def.terrain)) {
          lock = `Only on ${building.requiresTerrain.join(', ')}`;
        } else if (!current && territory.buildings.length >= slots) lock = 'No free building slot';
        else if (level >= MAX_BUILDING_LEVEL) lock = 'Fully upgraded';

        const blocked = lock !== null || inProgress || !affordable;
        let sub: string;
        if (inProgress) {
          sub = `Building level ${current!.targetLevel} — ${ticksToClock(Math.max(0, current!.completesAtTick - state.tick))}`;
        } else if (lock) {
          sub = lock;
        } else {
          sub = `${costLine(cost)}${level > 0 ? ` · ${tierName(building.id, level)}` : ''}`;
        }

        const unlocks = building.unlocks?.length
          ? ` · unlocks ${building.unlocks.map((u) => UNITS[u].name).join(', ')}`
          : '';

        out.push(`<div class="list-row cat-${category} ${blocked ? 'disabled' : ''} ${lock ? 'locked' : ''}">
          <div class="grow">
        <div class="name" title="${escapeHtml(buildingDescription(building.id, nextLevel))}">${BUILDING_ICONS[building.id] ?? ''} ${building.name}${level > 0 ? ` <span class="sub">Lv ${level}</span>` : ''}</div>
        <div class="sub ${lock ? 'locked-reason' : ''}">${escapeHtml(sub)}</div>
        <div class="sub">${escapeHtml(buildingDescription(building.id, nextLevel))}</div>
            ${!lock && level === 0 && unlocks ? `<div class="sub">${escapeHtml(unlocks.slice(3))}</div>` : ''}
          </div>
          <button data-action="build" data-territory="${territory.id}" data-building="${building.id}" ${blocked ? 'disabled' : ''}>
            ${level === 0 ? 'Build' : `Lv ${nextLevel}`}
          </button>
        </div>`);
      }
    }
    return out.join('');
  }

  /** The full unit roster with the building each one needs (M7). */
  private recruitCatalogue(state: MatchView, me: PlayerView, territory: TerritoryView): string {
    const levels = new Map<string, number>();
    territory.buildings.forEach((b) => levels.set(b.type, b.level));

    return UNIT_LIST.map((unit) => {
      const have = levels.get(unit.requires.building) ?? 0;
      const unlocked = have >= unit.requires.level;
      const affordable = canAfford(me.resources, unit.cost);
      const manpower = territory.pop >= unit.manpower * 3;
      const blocked = !unlocked || !affordable || !manpower;

      let sub: string;
      if (!unlocked) {
        sub = `Needs ${BUILDINGS[unit.requires.building].name} level ${unit.requires.level}`;
      } else if (!manpower) {
        sub = 'Not enough population here';
      } else {
        sub = `${costLine(unit.cost)} · ⚔${unit.attack} 🛡${unit.defence} ♥${unit.hp}`;
      }

      return `<div class="list-row ${blocked ? 'disabled' : ''} ${!unlocked ? 'locked' : ''}">
        <div class="grow">
          <div class="name" title="${escapeHtml(unitDescription(unit.id))}">${UNIT_ICONS[unit.id] ?? ''} ${unit.name} <span class="badge-domain ${unit.domain}">${unit.domain}</span></div>
          <div class="sub ${!unlocked ? 'locked-reason' : ''}">${escapeHtml(sub)}</div>
          <div class="sub">${escapeHtml(unitDescription(unit.id))}</div>
        </div>
        <button data-action="train" data-territory="${territory.id}" data-unit="${unit.id}" ${blocked ? 'disabled' : ''}>Train 3</button>
      </div>`;
    }).join('');
  }

  // ── armies ───────────────────────────────────────────────────────────────

  private armyRow(state: MatchView, armyId: string, mine: boolean): string {
    const army = state.armies.get(armyId);
    if (!army) return '';
    const player = state.players.get(army.ownerId);
    const units = decodeUnits(army.units);
    const composition = Object.entries(units)
      .map(([unit, n]) => `${Math.round(n ?? 0)} ${UNITS[unit as UnitType]?.name ?? unit}`)
      .join(', ') || 'empty';

    const where = army.movingTo
      ? `Moving to ${TERRITORY_DEFS[army.movingTo]?.name} — ${Math.round(army.progress * 100)}%`
      : `Holding ${TERRITORY_DEFS[army.at]?.name}`;

    const controls = mine && !army.movingTo ? `
      <div class="chip-row" style="margin-top:6px">
        ${(Object.keys(STANCE_LABELS) as Stance[]).map((stance) => `
          <button class="chip ${army.stance === stance ? 'active' : ''}"
                  data-action="stance" data-army="${army.id}" data-stance="${stance}"
                  title="${escapeHtml(STANCE_LABELS[stance].hint)}">${STANCE_LABELS[stance].label}</button>`).join('')}
        <button class="chip" data-action="move" data-army="${army.id}">➜ Move</button>
        <button class="chip" data-action="split-open" data-army="${army.id}">⑂ Split</button>
      </div>` : '';

    const splitComposer = this.splitArmyId === army.id ? this.splitComposer(units) : '';

    return `<div class="list-row" style="display:block">
      <div style="display:flex;gap:10px;align-items:center">
        <span class="swatch" style="background:${player?.colour ?? '#666'}"></span>
        <div class="grow">
          <div class="name">${escapeHtml(player?.name ?? 'Unknown')}${mine ? '' : ' (enemy)'}</div>
          <div class="sub">${escapeHtml(composition)}</div>
          <div class="sub">${escapeHtml(where)} · ${STANCE_LABELS[army.stance]?.label ?? army.stance}</div>
          ${army.movingTo ? `<div class="progress"><i style="width:${Math.round(army.progress * 100)}%"></i></div>` : ''}
        </div>
      </div>
      ${controls}
      ${splitComposer}
    </div>`;
  }

  /** Per-unit split composer — the "army composition" control from M7. */
  private splitComposer(units: UnitCounts): string {
    const rows = Object.entries(units).map(([unitId, count]) => {
      const max = Math.floor(count ?? 0);
      if (max < 1) return '';
      const value = this.splitCounts[unitId] ?? 0;
      return `<div class="unit-line">
        <span class="grow">${UNITS[unitId as UnitType]?.name ?? unitId}</span>
        <input type="range" min="0" max="${max}" value="${Math.min(value, max)}" data-split="${unitId}" />
        <span id="split-count-${unitId}">${Math.min(value, max)}</span>
        <span class="sub">/ ${max}</span>
      </div>`;
    }).join('');

    return `<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">
      <div class="section-title">Detach a force</div>
      ${rows}
      <div class="chip-row">
        <button class="chip" data-action="split-confirm" data-army="${this.splitArmyId}">Detach</button>
        <button class="chip" data-action="split-cancel">Cancel</button>
      </div>
    </div>`;
  }

  private renderMilitaryPanel(state: MatchView, me: PlayerView): void {
    this.el.panelTitle.textContent = 'Military';
    const armies = [...state.armies.values()].filter((a) => a.ownerId === me.id);
    const total = armies.reduce((sum, a) => sum + a.total, 0);

    const byDomain = { land: 0, air: 0, sea: 0 };
    for (const army of armies) {
      for (const [unitId, n] of Object.entries(decodeUnits(army.units))) {
        const def = UNITS[unitId as UnitType];
        if (def) byDomain[def.domain] += n ?? 0;
      }
    }

    const battles = [...state.battles].map((b) => `
      <div class="list-row">
        <div class="grow">
          <div class="name">Battle: ${TERRITORY_DEFS[b.territoryId]?.name}</div>
          <div class="sub">Running for ${ticksToClock(state.tick - b.startedAtTick)}</div>
        </div>
        <button data-action="focus" data-territory="${b.territoryId}">View</button>
      </div>`).join('');

    this.el.panelBody.innerHTML = `${this.panelBanner()}
      <div class="stat-grid">
        <div class="stat"><div class="k">Armies</div><div class="v">${armies.length}</div></div>
        <div class="stat"><div class="k">Ground</div><div class="v">${Math.round(byDomain.land)}</div></div>
        <div class="stat"><div class="k">Air</div><div class="v">${Math.round(byDomain.air)}</div></div>
        <div class="stat"><div class="k">Naval</div><div class="v">${Math.round(byDomain.sea)}</div></div>
        <div class="stat"><div class="k">Total</div><div class="v">${Math.round(total)}</div></div>
      </div>
      ${battles ? `<div class="section-title">Active battles</div>${battles}` : ''}
      <div class="section-title">Your forces</div>
      ${armies.map((a) => this.armyRow(state, a.id, true)).join('')
        || '<p class="hint">You have no armies. Build a barracks and recruit infantry.</p>'}`;
  }

  // ── economy ──────────────────────────────────────────────────────────────

  private renderEconomyPanel(state: MatchView, me: PlayerView): void {
    this.el.panelTitle.textContent = 'Economy';
    const mine = [...state.territories.values()].filter((t) => t.ownerId === me.id);
    const totalPop = mine.reduce((sum, t) => sum + t.pop, 0);

    const stats = RESOURCE_KEYS.map((key) => `
      <div class="stat">
        <div class="k">${key}</div>
        <div class="v">${compact(me.resources[key] ?? 0)}</div>
        <div class="sub" style="color:${(me.income[key] ?? 0) < 0 ? '#e8493f' : '#3fbf6a'}">${rate(me.income[key] ?? 0)}/min</div>
      </div>`).join('');

    const rows = mine.map((t) => {
      const def = TERRITORY_DEFS[t.id]!;
      const building = [...t.buildings].find((b) => b.completesAtTick > 0);
      return `<div class="list-row">
        <div class="grow">
          <div class="name">${def.name}</div>
          <div class="sub">${def.terrain} · ${compact(t.pop * 1000)} people · ${t.buildings.length}/${def.slots} slots</div>
          ${building ? `<div class="sub">Building ${BUILDINGS[building.type as BuildingType].name} — ${ticksToClock(Math.max(0, building.completesAtTick - state.tick))}</div>` : ''}
        </div>
        <button data-action="focus" data-territory="${t.id}">Open</button>
      </div>`;
    }).join('');

    this.el.panelBody.innerHTML = `${this.panelBanner()}
      <div class="stat-grid">${stats}</div>
      <div class="section-title">Territories — ${mine.length} held, ${compact(totalPop * 1000)} people</div>
      ${rows || '<p class="hint">You hold no territory.</p>'}`;
  }

  // ── research (M8) ────────────────────────────────────────────────────────

  private renderResearchPanel(state: MatchView, me: PlayerView): void {
    this.el.panelTitle.textContent = 'Research';
    const owned = me.tech ? me.tech.split(',').filter(Boolean) : [];
    const ownedSet = new Set(owned);
    const available = new Map(availableTechs(owned).map((tech) => [`${tech.tree}.${tech.branch}`, tech]));

    const active = me.researchTechId ? TECH_BY_ID[me.researchTechId] : null;
    const activeBlock = active ? `
      <div class="list-row">
        <div class="grow">
          <div class="name">Researching ${escapeHtml(active.name)}</div>
          <div class="sub">${ticksToClock(Math.max(0, me.researchEndTick - state.tick))} remaining</div>
          <div class="progress"><i style="width:${researchPercent(state.tick, me.researchEndTick, active.researchTicks)}%"></i></div>
        </div>
      </div>` : '';

    // One row per branch showing progress through its ten levels — the whole tree at
    // a glance, which a nested node graph cannot do on a phone screen.
    const trees = new Map<string, string[]>();
    for (const branch of TECH_BRANCHES) {
      const key = `${branch.tree}.${branch.branch}`;
      let level = 0;
      for (let i = 1; i <= MAX_TECH_LEVEL; i++) {
        if (ownedSet.has(`${key}.${i}`)) level = i;
      }
      const next = available.get(key);
      const affordable = next ? (me.resources.research ?? 0) >= next.costResearch : false;
      const researchingThis = active?.tree === branch.tree && active?.branch === branch.branch;

      const pips = Array.from({ length: MAX_TECH_LEVEL }, (_, i) => {
        if (i < level) return '<i class="pip filled"></i>';
        if (i === level && researchingThis) return '<i class="pip next"></i>';
        return '<i class="pip"></i>';
      }).join('');

      const row = `<div class="branch">
        <div class="branch-head">
          <span class="name">${escapeHtml(branch.label)}</span>
          <span class="level">${level}/${MAX_TECH_LEVEL}</span>
        </div>
        <div class="pips">${pips}</div>
        <div class="list-row ${next && affordable && !active ? '' : 'disabled'}" style="margin-top:6px">
          <div class="grow">
            <div class="name">${next ? escapeHtml(next.name) : 'Complete'}</div>
            <div class="sub">${next ? `🔬 ${next.costResearch} · ${ticksToClock(next.researchTicks)}` : 'Every level researched'}</div>
          </div>
          ${next ? `<button data-action="research" data-tech="${next.id}" ${affordable && !active ? '' : 'disabled'}>Start</button>` : ''}
        </div>
      </div>`;

      if (!trees.has(branch.tree)) trees.set(branch.tree, []);
      trees.get(branch.tree)!.push(row);
    }

    const treeBlocks = [...trees.entries()]
      .map(([tree, rows]) => `<div class="section-title">${tree}</div>${rows.join('')}`)
      .join('');

    this.el.panelBody.innerHTML = `${this.panelBanner()}
      <div class="stat-grid">
        <div class="stat"><div class="k">Research points</div><div class="v">${compact(me.resources.research ?? 0)}</div>
          <div class="sub" style="color:#3fbf6a">${rate(me.income.research ?? 0)}/min</div></div>
        <div class="stat"><div class="k">Technologies</div><div class="v">${owned.length}</div></div>
      </div>
      ${activeBlock}
      ${treeBlocks}`;
  }

  // ── diplomacy (M11) ──────────────────────────────────────────────────────

  private renderDiplomacyPanel(state: MatchView, me: PlayerView): void {
    this.el.panelTitle.textContent = 'Diplomacy';
    const others = [...state.players.values()].filter((p) => p.id !== me.id);
    const myAllies = new Set(me.allies.split(',').filter(Boolean));
    const offersToMe = new Set(me.allianceOffers.split(',').filter(Boolean));
    const html: string[] = [this.panelBanner()];

    // Incoming alliance offers first — they are the thing waiting on the player.
    if (offersToMe.size) {
      html.push('<div class="section-title">Alliance offers</div>');
      for (const id of offersToMe) {
        const player = state.players.get(id);
        if (!player) continue;
        html.push(`<div class="list-row">
          <span class="swatch" style="background:${player.colour}"></span>
          <div class="grow"><div class="name">${escapeHtml(player.name)}</div>
            <div class="sub">wants an alliance${player.betrayals ? ` · ${player.betrayals} betrayal(s) on record` : ''}</div></div>
          <button data-action="ally-accept" data-player="${id}">Accept</button>
          <button class="chip" data-action="ally-decline" data-player="${id}">No</button>
        </div>`);
      }
    }

    const incoming = [...state.tradeOffers].filter((o) => o.toId === me.id);
    if (incoming.length) {
      html.push('<div class="section-title">Trade offers</div>');
      for (const offer of incoming) {
        const from = state.players.get(offer.fromId);
        const affordable = canAfford(me.resources as never, decodeDelta(offer.want) as ResourceDelta);
        html.push(`<div class="list-row">
          <div class="grow">
            <div class="name">${escapeHtml(from?.name ?? '?')} offers ${escapeHtml(deltaLine(offer.give))}</div>
            <div class="sub">wants ${escapeHtml(deltaLine(offer.want))} · expires in ${ticksToClock(Math.max(0, offer.expiresAtTick - state.tick))}</div>
          </div>
          <button data-action="trade-accept" data-offer="${offer.id}" ${affordable ? '' : 'disabled'}>Accept</button>
          <button class="chip" data-action="trade-decline" data-offer="${offer.id}">No</button>
        </div>`);
      }
    }

    const outgoing = [...state.tradeOffers].filter((o) => o.fromId === me.id);
    if (outgoing.length) {
      html.push('<div class="section-title">Your open offers</div>');
      for (const offer of outgoing) {
        const to = state.players.get(offer.toId);
        html.push(`<div class="list-row">
          <div class="grow">
            <div class="name">To ${escapeHtml(to?.name ?? '?')}</div>
            <div class="sub">giving ${escapeHtml(deltaLine(offer.give))} for ${escapeHtml(deltaLine(offer.want))}</div>
          </div>
          <button class="chip" data-action="trade-decline" data-offer="${offer.id}">Withdraw</button>
        </div>`);
      }
    }

    html.push('<div class="section-title">Nations</div>');
    for (const player of others) {
      const allied = myAllies.has(player.id);
      const territories = [...state.territories.values()].filter((t) => t.ownerId === player.id).length;
      const cls = LEADER_CLASSES[player.leaderClass as keyof typeof LEADER_CLASSES];
      html.push(`<div class="list-row">
        <span class="swatch" style="background:${player.colour}"></span>
        <div class="grow">
          <div class="name">${escapeHtml(player.name)}${player.eliminated ? ' — eliminated' : ''}${player.ai ? ' (AI)' : ''}</div>
          <div class="sub">${escapeHtml(cls?.name ?? player.leaderClass)} · Lv ${player.leaderLevel} · ${territories} territories${player.betrayals ? ` · ${player.betrayals} betrayal(s)` : ''}</div>
        </div>
        ${allied
          ? `<button class="chip" data-action="ally-break" data-player="${player.id}">Break</button>`
          : `<button data-action="ally-propose" data-player="${player.id}" ${offersToMe.has(player.id) ? '' : ''}>Ally</button>`}
        <button class="chip" data-action="trade-open" data-player="${player.id}">Trade</button>
      </div>`);
    }

    if (this.tradeTargetId) {
      const target = state.players.get(this.tradeTargetId);
      html.push(`<div class="section-title">Offer to ${escapeHtml(target?.name ?? '?')}</div>
        <div class="trade-grid">
          <div class="trade-col"><h4>You give</h4>${this.tradeInputs('give', me)}</div>
          <div class="trade-col"><h4>You want</h4>${this.tradeInputs('want', me)}</div>
        </div>
        <div class="chip-row">
          <button class="chip" data-action="trade-send" data-player="${this.tradeTargetId}">Send offer</button>
          <button class="chip" data-action="trade-cancel">Cancel</button>
        </div>`);
    }

    html.push('<div class="section-title">Chat</div>');
    html.push(`<div class="chat-log">${this.chatLog.map((line) => `
      <div><span class="who" style="color:${line.colour}">${escapeHtml(line.who)}</span>: ${escapeHtml(line.text)}</div>`).join('')
      || '<div class="sub">No messages yet.</div>'}</div>`);
    html.push(`<div class="chat-row">
      <input id="chat-input" type="text" maxlength="200" placeholder="Message everyone…" />
      <button data-action="chat-send">Send</button>
    </div>`);

    this.el.panelBody.innerHTML = html.join('');
  }

  private tradeInputs(side: 'give' | 'want', me: PlayerView): string {
    const store = side === 'give' ? this.tradeGive : this.tradeWant;
    return RESOURCE_KEYS.map((key) => `
      <div class="trade-line">
        <span>${RESOURCE_ICONS[key]}</span>
        <input type="number" min="0" step="10" value="${store[key] ?? 0}" data-${side}="${key}"
               ${side === 'give' ? `max="${Math.floor(me.resources[key] ?? 0)}"` : ''} />
      </div>`).join('');
  }

  // ── leader (M9) ──────────────────────────────────────────────────────────

  private renderLeaderPanel(state: MatchView, me: PlayerView): void {
    this.el.panelTitle.textContent = 'Leader';
    const cls = LEADER_CLASSES[me.leaderClass as keyof typeof LEADER_CLASSES];
    const xpPercent = me.leaderXpNeeded > 0
      ? Math.min(100, Math.round((me.leaderXp / me.leaderXpNeeded) * 100))
      : 0;

    const skills: Array<{ branch: SkillBranch; label: string; value: number; effect: string }> = [
      { branch: 'warfare', label: 'Warfare', value: me.skillWarfare, effect: '+2% attack, +1.5% defence per point' },
      { branch: 'economy', label: 'Economy', value: me.skillEconomy, effect: '+2% income, +1.5% food & materials per point' },
      { branch: 'intelligence', label: 'Intelligence', value: me.skillIntelligence, effect: '+2.5% research, +1% build speed per point' },
    ];

    const skillRows = skills.map((skill) => {
      const maxed = skill.value >= MAX_SKILL_POINTS_PER_BRANCH;
      const canSpend = me.skillPoints > 0 && !maxed;
      const pips = Array.from({ length: MAX_SKILL_POINTS_PER_BRANCH }, (_, i) =>
        `<i class="pip ${i < skill.value ? 'filled' : ''}"></i>`).join('');
      return `<div class="branch">
        <div class="branch-head">
          <span class="name">${skill.label}</span>
          <span class="level">${skill.value}/${MAX_SKILL_POINTS_PER_BRANCH}</span>
        </div>
        <div class="pips">${pips}</div>
        <div class="list-row ${canSpend ? '' : 'disabled'}" style="margin-top:6px">
          <div class="grow"><div class="sub">${skill.effect}</div></div>
          <button data-action="skill" data-branch="${skill.branch}" ${canSpend ? '' : 'disabled'}>+1</button>
        </div>
      </div>`;
    }).join('');

    const bonuses = cls
      ? Object.entries(cls.base).map(([key, value]) => `
          <div class="stat"><div class="k">${key.replace('Mul', '')}</div>
          <div class="v">${(value as number) > 0 ? '+' : ''}${Math.round((value as number) * 100)}%</div></div>`).join('')
      : '';

    this.el.panelBody.innerHTML = `${this.panelBanner()}
      <div class="list-row">
        <span class="swatch" style="background:${me.appearance.colour || me.colour}"></span>
        <div class="grow">
          <div class="name">${escapeHtml(me.leaderName || me.name)} — Level ${me.leaderLevel}</div>
          <div class="sub">${escapeHtml(cls?.name ?? me.leaderClass)} · ${escapeHtml(cls?.blurb ?? '')}</div>
          <div class="xp-bar"><i style="width:${xpPercent}%"></i></div>
          <div class="sub">${compact(me.leaderXp)} / ${compact(me.leaderXpNeeded)} XP · ${compact(me.matchXp)} earned this match</div>
        </div>
      </div>

      <div class="section-title">Skill tree${me.skillPoints > 0 ? ` — ${me.skillPoints} point(s) to spend` : ''}</div>
      ${skillRows}

      <div class="section-title">Class bonuses</div>
      <div class="stat-grid">${bonuses}</div>

      <p class="hint" style="text-align:left">Pick your cartoon leader style in the lobby before the war begins.</p>`;
  }

  // ── actions ──────────────────────────────────────────────────────────────

  private handleAction(button: HTMLButtonElement): void {
    const action = button.getAttribute('data-action');
    const attr = (name: string) => button.getAttribute(name) ?? '';

    switch (action) {
      case 'build':
        this.net.send({
          t: 'BUILD', territoryId: attr('data-territory'),
          building: attr('data-building') as BuildingType,
        });
        button.disabled = true;
        this.toast(`${BUILDINGS[attr('data-building') as BuildingType].name} ordered`);
        this.audio.effect('build');
        break;

      case 'train':
        this.net.send({
          t: 'TRAIN', territoryId: attr('data-territory'),
          unit: attr('data-unit') as UnitType, count: 3,
        });
        this.toast(`Training ${UNITS[attr('data-unit') as UnitType].name}`);
        this.audio.effect('train');
        break;

      case 'research':
        this.net.send({ t: 'START_RESEARCH', techId: attr('data-tech') });
        this.audio.effect('research');
        break;

      case 'move': {
        const army = this.net.state?.armies.get(attr('data-army'));
        if (!army) return;
        this.movingArmyId = army.id;
        // Highlight only destinations this specific army can legally reach — a fleet
        // and a tank standing in the same port see different options.
        this.map.highlight(this.legalDestinationsFor(army.units, army.at));
        this.el.panel.classList.add('hidden');
        this.toast('Tap a target. Routes can cross your conquered territory.');
        break;
      }

      case 'stance':
        this.net.send({
          t: 'SET_STANCE', armyId: attr('data-army'), stance: attr('data-stance') as Stance,
        });
        break;

      case 'split-open':
        this.splitArmyId = attr('data-army');
        this.splitCounts = {};
        this.render(true);
        break;

      case 'split-cancel':
        this.splitArmyId = null;
        this.render(true);
        break;

      case 'split-confirm': {
        const units: UnitCounts = {};
        for (const [unitId, count] of Object.entries(this.splitCounts)) {
          if (count > 0) units[unitId as UnitType] = count;
        }
        if (!Object.keys(units).length) {
          this.toast('Choose some units first', true);
          return;
        }
        this.net.send({ t: 'SPLIT_ARMY', armyId: attr('data-army'), units });
        this.splitArmyId = null;
        this.splitCounts = {};
        this.toast('Force detached');
        this.render(true);
        break;
      }

      case 'ping':
        this.net.send({
          t: 'PING_MAP', territoryId: attr('data-territory'),
          kind: attr('data-kind') as 'attack' | 'defend' | 'help',
        });
        this.toast('Allies notified');
        break;

      case 'ally-propose':
        this.net.send({ t: 'PROPOSE_ALLY', targetPlayerId: attr('data-player') });
        this.toast('Alliance proposed');
        break;

      case 'ally-accept':
        this.net.send({ t: 'ACCEPT_ALLY', targetPlayerId: attr('data-player') });
        break;

      case 'ally-decline':
        this.net.send({ t: 'DECLINE_ALLY', targetPlayerId: attr('data-player') });
        break;

      case 'ally-break':
        this.net.send({ t: 'BREAK_ALLY', targetPlayerId: attr('data-player') });
        this.toast('Alliance broken — your people are uneasy', true);
        break;

      case 'trade-open':
        this.tradeTargetId = attr('data-player');
        this.tradeGive = {};
        this.tradeWant = {};
        this.render(true);
        break;

      case 'trade-cancel':
        this.tradeTargetId = null;
        this.render(true);
        break;

      case 'trade-send': {
        const give = pruneDelta(this.tradeGive);
        const want = pruneDelta(this.tradeWant);
        if (!Object.keys(give).length && !Object.keys(want).length) {
          this.toast('Put something in the offer first', true);
          return;
        }
        this.net.send({ t: 'TRADE_OFFER', targetPlayerId: attr('data-player'), give, want });
        this.tradeTargetId = null;
        this.tradeGive = {};
        this.tradeWant = {};
        this.toast('Offer sent');
        this.render(true);
        break;
      }

      case 'trade-accept':
        this.net.send({ t: 'TRADE_ACCEPT', offerId: attr('data-offer') });
        break;

      case 'trade-decline':
        this.net.send({ t: 'TRADE_DECLINE', offerId: attr('data-offer') });
        break;

      case 'chat-send':
        this.sendChat();
        break;

      case 'dismiss-advice':
        this.dismissAdvice(attr('data-key'));
        break;

      case 'skill':
        this.net.send({ t: 'SPEND_SKILL', branch: attr('data-branch') as SkillBranch });
        break;


      case 'focus':
        this.map.focus(attr('data-territory'));
        this.selectTerritory(attr('data-territory'));
        break;

      case 'advice': {
        const command = this.pendingAdvice[Number(attr('data-index'))]?.command;
        if (command) {
          this.net.send(command);
          this.toast('Order issued');
        }
        break;
      }
    }
  }

  private sendChat(): void {
    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    const text = input?.value.trim();
    if (!text) return;
    this.net.send({ t: 'CHAT', channel: 'all', text });
    input!.value = '';
  }

  /**
   * Mirrors the server's traversal rules so the map only highlights reachable ground.
   * The server still validates — this exists so the player is never invited to make an
   * illegal move, not as a substitute for authority.
   */
  private legalDestinationsFor(encodedUnits: string, from: string): string[] {
    const units = decodeUnits(encodedUnits);
    const domains = new Set(
      Object.entries(units)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([unitId]) => UNITS[unitId as UnitType]?.domain),
    );
    const hasShip = domains.has('sea');
    const landUnits = Object.entries(units).filter(
      ([unitId, n]) => (n ?? 0) > 0 && UNITS[unitId as UnitType]?.domain === 'land',
    );
    const allAmphibious = landUnits.every(([unitId]) => unitId === 'marine');

    return (ADJACENCY[from] ?? []).filter((link) => {
      const coastal = TERRITORY_DEFS[link.to]?.coastal ?? false;
      if (hasShip && (link.kind !== 'sea' || !coastal)) return false;
      if (link.kind === 'sea' && landUnits.length > 0 && !allAmphibious) return false;
      return true;
    }).map((link) => link.to);
  }
}

function adviceKey(suggestion: Suggestion): string {
  return `${suggestion.kind}:${suggestion.territoryId ?? ''}:${suggestion.title}`;
}

function buildingDescription(type: BuildingType, level: number): string {
  const building = BUILDINGS[type];
  const yields = Object.entries(building.yieldPerMinute ?? {})
    .map(([resource, value]) => `+${Math.round((value as number) * level * 10) / 10} ${resource}/min`).join(', ');
  const defence = building.defenceBonus ? `+${Math.round(building.defenceBonus * level * 100)}% territory defence` : '';
  const growth = building.popGrowth ? `+${Math.round(building.popGrowth * level * 10) / 10} population growth` : '';
  return [level > 1 ? `Upgrade to level ${level} (${tierName(type, level)}).` : `Build ${tierName(type, 1)}.`, yields, defence, growth]
    .filter(Boolean).join(' ');
}

function unitDescription(type: UnitType): string {
  const unit = UNITS[type];
  const role = unit.domain === 'air' ? 'Fast strike unit that ignores borders.'
    : unit.domain === 'sea' ? 'Naval unit for coastal sea routes.'
      : type === 'marine' ? 'Land unit that can cross sea links.' : 'Ground unit that captures and holds territory.';
  return `${role} Attack ${unit.attack}, defence ${unit.defence}, speed ${unit.speed}.`;
}

// ── helpers ────────────────────────────────────────────────────────────────

function researchPercent(tick: number, endTick: number, totalTicks: number): number {
  const remaining = Math.max(0, endTick - tick);
  return Math.max(4, Math.min(100, ((totalTicks - remaining) / Math.max(1, totalTicks)) * 100));
}

function deltaLine(encoded: string): string {
  const delta = decodeDelta(encoded);
  const parts = Object.entries(delta).map(([key, value]) => `${RESOURCE_ICONS[key] ?? key} ${compact(value)}`);
  return parts.length ? parts.join(' ') : 'nothing';
}

function pruneDelta(input: Record<string, number>): ResourceDelta {
  const out: ResourceDelta = {};
  for (const key of RESOURCE_KEYS) {
    const value = input[key];
    if (value && value > 0) out[key as ResourceKey] = Math.floor(value);
  }
  return out;
}

function humanReason(reason?: string): string {
  const table: Record<string, string> = {
    insufficient_resources: 'Not enough resources',
    not_owner: 'That territory is not yours',
    no_free_slot: 'No free building slot there',
    already_building: 'Something is already under construction there',
    max_level: 'Already fully upgraded',
    missing_building: 'You need the right building first',
    no_manpower: 'Not enough population to recruit',
    not_adjacent: 'You can only move to neighbouring territories',
    cannot_cross_sea: 'Only marines, aircraft and ships can cross open water',
    ships_need_water: 'Ships can only move along sea routes',
    ships_need_coast: 'Ships can only dock at coastal territories',
    already_moving: 'That army is already on the move',
    not_host: 'Only the host can do that',
    rate_limited: 'Slow down',
    already_researching: 'You are already researching something',
    missing_prerequisite: 'Research the previous level first',
    wrong_terrain: 'That terrain does not support this building',
    not_coastal: 'This building needs a coastal territory',
    no_points: 'No skill points to spend',
    branch_maxed: 'That branch is already maxed',
    already_allied: 'You are already allied',
    not_allied: 'You are not allied with them',
    no_such_offer: 'That offer is gone',
    not_recipient: 'That offer is not for you',
    too_many_offers: 'You have too many open offers',
    empty_offer: 'Put something in the offer first',
    cannot_afford: 'They cannot afford that',
    empty_split: 'Choose some units to detach',
    not_enough_units: 'That army does not have that many units',
  };
  return table[reason ?? ''] ?? 'That is not possible right now';
}
