import Phaser from 'phaser';
import { ADJACENCY, EARTH_MODERN, TERRITORY_DEFS } from '@warfront/shared';
import type { TerritoryDef } from '@warfront/shared';
import type { MatchView, PingView } from '../net/view.js';
import worldGeo from '../data/world.json';
import EARTH_SATELLITE from '../assets/earth-satellite.jpg';

const PING_COLOURS: Record<string, number> = {
  attack: 0xe8493f,
  defend: 0x3f7fe8,
  help: 0xe8c53f,
};

const WORLD_W = 2400;
const WORLD_H = 1200;
const NEUTRAL = 0x39404a;
const SEA_LINK = 0x2b4a63;
const LAND_LINK = 0x39404a;

// The backdrop is a real satellite image of Earth (NASA Blue Marble, public domain,
// equirectangular 2048×1024) — the same lon/lat projection the territory nodes use, so
// no territory positions need adjusting. Country borders are stroked on top for
// readability, and a dim pass keeps the bright imagery from drowning out the game.
const EARTH_SATELLITE_DIM = 0x0b1016;
const BORDER_OUTLINE = 0x0b1016;
const BORDER_CORE = 0xd7e3f0;

// Loose shapes for the bundled GeoJSON geometry. tsc types the JSON import as plain
// nested arrays, so we cast once at the call site instead of fighting the union.
type GeoRing = number[][];
type GeoPolygonCoords = GeoRing[];
type GeoMultiPolygonCoords = GeoPolygonCoords[];

/**
 * The world map.
 *
 * Territories are drawn as nodes on a projected globe rather than as country
 * polygons. That is a deliberate MVP choice:
 *  - it reads clearly on a 5-inch screen, where real borders become mush
 *  - it costs ~50 draw calls instead of thousands of polygon vertices
 *  - swapping in real GeoJSON borders later changes only this file, because every
 *    other system addresses territories by id
 */
export class MapScene extends Phaser.Scene {
  private linkGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private nodes = new Map<string, {
    def: TerritoryDef;
    x: number;
    y: number;
    disc: Phaser.GameObjects.Arc;
    label: Phaser.GameObjects.Text;
    count: Phaser.GameObjects.Text;
  }>();

  private getState: () => MatchView | null = () => null;
  private getSessionId: () => string = () => '';
  private onSelect: (territoryId: string) => void = () => undefined;

  private selectedId: string | null = null;
  private highlighted = new Set<string>();
  private pings: PingView[] = [];
  private dragging = false;
  private dragMoved = 0;
  private pinchDistance = 0;

  constructor() {
    super('map');
  }

  // Phaser does not declare preload on its Scene typings, so no `override` here.
  preload(): void {
    this.load.image('earth-sat', EARTH_SATELLITE);
  }

  bind(
    getState: () => MatchView | null,
    getSessionId: () => string,
    onSelect: (territoryId: string) => void,
  ): void {
    this.getState = getState;
    this.getSessionId = getSessionId;
    this.onSelect = onSelect;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0b1016');
    // Bounds flush to the world rectangle — panning/zooming out can never reveal
    // the void outside the map.
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    // Draw the real countries first so every later object sits on top of them.
    this.drawWorldBackground();

    this.linkGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();

    this.drawLinks();
    this.createNodes();
    this.setupInput();

    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
    this.cameras.main.setZoom(this.fitZoom());
    this.scale.on('resize', () => this.cameras.main.setZoom(Math.max(this.fitZoom(), this.cameras.main.zoom)));
  }

  private fitZoom(): number {
    return Math.min(this.scale.width / WORLD_W, this.scale.height / WORLD_H) * 1.6;
  }

  private static projectLon(lon: number): number {
    return ((lon + 180) / 360) * WORLD_W;
  }

  private static projectLat(lat: number): number {
    return ((90 - lat) / 180) * WORLD_H;
  }

  private static project(def: TerritoryDef): { x: number; y: number } {
    return { x: MapScene.projectLon(def.lon), y: MapScene.projectLat(def.lat) };
  }

  /**
   * Real-world country borders as the map backdrop. The whole globe is drawn once
   * into a static texture, so it costs a single draw call per frame even on a
   * low-end phone; the temporary Graphics is then thrown away.
   */
  private drawWorldBackground(): void {
    // 1) Real satellite imagery, aligned to the same equirectangular projection as
    //    the territory nodes — no territory moves needed. The source is 2048×1024
    //    (same 2:1 aspect as the world), so stretching it to 2400×1200 keeps every
    //    pixel on its exact lon/lat. This is a display-list object, so it is added
    //    on every create() (a scene restart would otherwise leave it missing).
    this.add.image(WORLD_W / 2, WORLD_H / 2, 'earth-sat').setDisplaySize(WORLD_W, WORLD_H);

    // 2) A dim pass plus thin country borders, baked into a static overlay texture.
    //    The texture lives on the TextureManager for the lifetime of the game, so
    //    only the bake needs guarding against key collisions on a scene restart.
    if (this.textures.exists('world-bg')) return;

    const g = this.add.graphics();
    g.fillStyle(EARTH_SATELLITE_DIM, 0.45);
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    // Dark outline underneath so the border reads on bright land and dark sea alike.
    g.lineStyle(3, BORDER_OUTLINE, 0.5);
    this.strokeCountries(g);
    g.lineStyle(1.2, BORDER_CORE, 0.55);
    this.strokeCountries(g);
    g.generateTexture('world-bg', WORLD_W, WORLD_H);
    this.add.image(WORLD_W / 2, WORLD_H / 2, 'world-bg');
    g.destroy();
  }

  private strokeCountries(g: Phaser.GameObjects.Graphics): void {
    for (const feature of worldGeo.features) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      if (geometry.type === 'Polygon') {
        this.drawPolygon(g, geometry.coordinates as GeoPolygonCoords);
      } else {
        for (const polygon of geometry.coordinates as GeoMultiPolygonCoords) {
          this.drawPolygon(g, polygon);
        }
      }
    }
  }

  /**
   * Outlines one polygon. The satellite image already shows land, sea and terrain, so
   * borders are stroked only. Inner rings (lakes/enclaves) are outlined too — Natural
   * Earth ships most large water bodies as separate features, so artefacts are
   * invisible at 110 m resolution.
   */
  private drawPolygon(g: Phaser.GameObjects.Graphics, rings: GeoRing[]): void {
    for (const ring of rings) {
      const points = ring.map(([lon = 0, lat = 0]) => (
        new Phaser.Geom.Point(MapScene.projectLon(lon), MapScene.projectLat(lat))
      ));
      g.strokePoints(points, true, true);
    }
  }

  private drawLinks(): void {
    this.linkGfx.clear();
    for (const [a, b, kind] of EARTH_MODERN.edges) {
      const da = TERRITORY_DEFS[a];
      const db = TERRITORY_DEFS[b];
      if (!da || !db) continue;
      const pa = MapScene.project(da);
      const pb = MapScene.project(db);
      const style = () => this.linkGfx.lineStyle(
        kind === 'sea' ? 1.5 : 2.5, kind === 'sea' ? SEA_LINK : LAND_LINK, 0.8,
      );
      // Links crossing the antimeridian wrap around the seam: draw them as two
      // segments that leave one edge and re-enter at the same height on the other.
      if (Math.abs(pa.x - pb.x) > WORLD_W / 2) {
        const p2 = { x: pb.x < pa.x ? pb.x + WORLD_W : pb.x - WORLD_W, y: pb.y };
        const denom = p2.x - pa.x;
        const yCross = denom === 0
          ? (pa.y + pb.y) / 2
          : pa.y + ((0 - pa.x) / denom) * (p2.y - pa.y);
        style();
        this.linkGfx.beginPath();
        this.linkGfx.moveTo(pa.x, pa.y);
        this.linkGfx.lineTo(0, yCross);
        this.linkGfx.moveTo(WORLD_W, yCross);
        this.linkGfx.lineTo(pb.x, pb.y);
        this.linkGfx.strokePath();
        continue;
      }
      style();
      this.linkGfx.beginPath();
      this.linkGfx.moveTo(pa.x, pa.y);
      this.linkGfx.lineTo(pb.x, pb.y);
      this.linkGfx.strokePath();
    }
  }

  private createNodes(): void {
    for (const def of EARTH_MODERN.territories) {
      const { x, y } = MapScene.project(def);
      const radius = 10 + def.slots * 1.6;

      const disc = this.add.circle(x, y, radius, NEUTRAL);
      disc.setStrokeStyle(2, 0x0b1016, 1);

      const label = this.add.text(x, y + radius + 3, def.name, {
        fontSize: '11px',
        color: '#0b1016',
        stroke: '#0b1016',
        strokeThickness: 1.5,
        fontFamily: 'system-ui, sans-serif',
      }).setOrigin(0.5, 0);

      const count = this.add.text(x, y, '', {
        fontSize: '12px',
        color: '#ffffff',
        fontStyle: 'bold',
        fontFamily: 'system-ui, sans-serif',
      }).setOrigin(0.5);

      this.nodes.set(def.id, { def, x, y, disc, label, count });
    }
  }

  // ── input: pan, pinch, tap ───────────────────────────────────────────────

  private setupInput(): void {
    this.input.addPointer(2); // two-finger pinch

    this.input.on('pointerdown', () => {
      this.dragging = true;
      this.dragMoved = 0;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const camera = this.cameras.main;
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      if (p1.isDown && p2.isDown) {
        const distance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDistance > 0) {
          const scale = distance / this.pinchDistance;
          camera.setZoom(Phaser.Math.Clamp(camera.zoom * scale, this.fitZoom() * 0.8, 4));
        }
        this.pinchDistance = distance;
        this.dragMoved = 999; // a pinch is never a tap
        return;
      }
      this.pinchDistance = 0;

      if (!this.dragging || !pointer.isDown) return;
      const dx = pointer.x - pointer.prevPosition.x;
      const dy = pointer.y - pointer.prevPosition.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      camera.scrollX -= dx / camera.zoom;
      camera.scrollY -= dy / camera.zoom;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.dragging = false;
      this.pinchDistance = 0;
      // A short press that barely moved is a tap, not a drag.
      if (this.dragMoved < 12) this.handleTap(pointer);
    });

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.9 : 1.1), this.fitZoom() * 0.8, 4));
    });
  }

  private handleTap(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    let best: string | null = null;
    let bestDistance = Infinity;

    for (const [id, node] of this.nodes) {
      const distance = Phaser.Math.Distance.Between(world.x, world.y, node.x, node.y);
      const hitRadius = node.disc.radius + 14; // generous — fingers are not mice
      if (distance < hitRadius && distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    if (best) this.onSelect(best);
  }

  // ── external control ─────────────────────────────────────────────────────

  select(territoryId: string | null): void {
    this.selectedId = territoryId;
  }

  /** Territories to outline — used to show legal move destinations. */
  highlight(ids: string[]): void {
    this.highlighted = new Set(ids);
  }

  /** Ally map pings, rendered as expanding rings so they read at a glance. */
  setPings(pings: PingView[]): void {
    this.pings = pings;
  }

  focus(territoryId: string): void {
    const node = this.nodes.get(territoryId);
    if (!node) return;
    this.cameras.main.pan(node.x, node.y, 350, 'Sine.easeInOut');
  }

  // ── render ───────────────────────────────────────────────────────────────

  override update(): void {
    const state = this.getState();
    if (!state) return;

    const me = this.getSessionId();
    const garrisons = new Map<string, { total: number; ownerId: string }>();
    const moving: Array<{ from: string; to: string; progress: number; colour: number; total: number }> = [];

    state.armies.forEach((army) => {
      const colour = this.colourOf(state, army.ownerId);
      if (army.movingTo) {
        moving.push({ from: army.at, to: army.movingTo, progress: army.progress, colour, total: army.total });
      } else {
        const current = garrisons.get(army.at);
        // The largest force present is the one whose strength gets shown on the node.
        if (!current || army.total > current.total) {
          garrisons.set(army.at, { total: army.total, ownerId: army.ownerId });
        }
      }
    });

    for (const [id, node] of this.nodes) {
      const territory = state.territories.get(id);
      const ownerColour = territory?.ownerId ? this.colourOf(state, territory.ownerId) : NEUTRAL;
      node.disc.setFillStyle(ownerColour, territory?.ownerId ? 0.92 : 0.55);

      const garrison = garrisons.get(id);
      node.count.setText(garrison ? String(Math.round(garrison.total)) : '');
      node.count.setColor(garrison && garrison.ownerId === me ? '#ffffff' : '#0b1016');

      const isSelected = this.selectedId === id;
      const isHighlighted = this.highlighted.has(id);
      if (isSelected) node.disc.setStrokeStyle(3, 0xffffff, 1);
      else if (isHighlighted) node.disc.setStrokeStyle(3, 0xe8c53f, 0.95);
      else node.disc.setStrokeStyle(2, 0x0b1016, 1);

      node.label.setColor('#0b1016');
    }

    this.drawOverlay(state, moving);
  }

  private drawOverlay(
    state: MatchView,
    moving: Array<{ from: string; to: string; progress: number; colour: number; total: number }>,
  ): void {
    const g = this.overlayGfx;
    g.clear();

    // Battles: a pulsing ring so fighting is visible without opening a panel.
    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 180);
    for (const battle of state.battles) {
      const node = this.nodes.get(battle.territoryId);
      if (!node) continue;
      g.lineStyle(3, 0xff5533, 0.35 + pulse * 0.5);
      g.strokeCircle(node.x, node.y, node.disc.radius + 6 + pulse * 4);
    }

    // Capture timers.
    state.territories.forEach((territory, id) => {
      if (!territory.captureProgress) return;
      const node = this.nodes.get(id);
      if (!node) return;
      const fraction = Math.min(1, territory.captureProgress / 25);
      g.lineStyle(3, 0xe8c53f, 0.9);
      g.beginPath();
      g.arc(node.x, node.y, node.disc.radius + 5, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
      g.strokePath();
    });

    // Ally pings — an expanding ring that is impossible to miss mid-battle.
    for (const ping of this.pings) {
      const node = this.nodes.get(ping.territoryId);
      if (!node) continue;
      const remaining = Math.max(0, ping.expiresAtTick - state.tick);
      const phase = (this.time.now / 700) % 1;
      const colour = PING_COLOURS[ping.kind] ?? 0xffffff;
      g.lineStyle(2.5, colour, (1 - phase) * Math.min(1, remaining / 10));
      g.strokeCircle(node.x, node.y, node.disc.radius + 4 + phase * 22);
    }

    // Armies in transit, interpolated along their link (wrapping at the seam).
    for (const army of moving) {
      const from = this.nodes.get(army.from);
      const to = this.nodes.get(army.to);
      if (!from || !to) continue;
      const wraps = Math.abs(from.x - to.x) > WORLD_W / 2;
      const destX = wraps ? (to.x < from.x ? to.x + WORLD_W : to.x - WORLD_W) : to.x;
      let x = Phaser.Math.Linear(from.x, destX, army.progress);
      if (wraps) x = ((x % WORLD_W) + WORLD_W) % WORLD_W;
      const y = Phaser.Math.Linear(from.y, to.y, army.progress);
      g.fillStyle(army.colour, 1);
      g.fillCircle(x, y, 5);
      g.lineStyle(1.5, 0x0b1016, 1);
      g.strokeCircle(x, y, 5);
      if (!wraps) {
        g.lineStyle(1.5, army.colour, 0.5);
        g.lineBetween(from.x, from.y, x, y);
      }
    }
  }

  private colourOf(state: MatchView, playerId: string): number {
    const player = state.players.get(playerId);
    if (!player?.colour) return NEUTRAL;
    return Number.parseInt(player.colour.replace('#', ''), 16);
  }
}

/** Adjacent territory ids — used by the UI to highlight legal move targets. */
export function neighboursOf(territoryId: string): string[] {
  return (ADJACENCY[territoryId] ?? []).map((link) => link.to);
}
