import { Client, Room } from 'colyseus.js';
import type { Command, GameEvent, LeaderAppearance, LeaderClass } from '@warfront/shared';
import type { MatchView } from './view.js';

export interface Suggestion {
  kind: string;
  priority: number;
  title: string;
  detail: string;
  territoryId?: string;
  command?: Command;
}

type Handler<T> = (payload: T) => void;

/**
 * The single point of contact with the server.
 *
 * Everything the client wants to change goes out as a Command and comes back as
 * authoritative state — there is deliberately no method here that mutates the world
 * locally, because that is what makes desync and client-side cheating impossible.
 */
export class NetClient {
  room: Room<MatchView> | null = null;
  endpoint = '';

  private stateHandlers: Handler<MatchView>[] = [];
  private eventHandlers: Handler<GameEvent[]>[] = [];
  private rejectHandlers: Handler<{ reason?: string; message?: string; command?: string }>[] = [];
  private adviceHandlers: Handler<Suggestion[]>[] = [];
  private overHandlers: Handler<{ winnerTeam: number }>[] = [];
  private leaveHandlers: Handler<number>[] = [];

  /**
   * Default endpoint. In a browser we assume the server sits on the same host as the
   * page (true for `npm run dev` over LAN); in a packaged app the player types it once
   * and we remember it.
   */
  /**
   * A stable anonymous id for this install. It is the key the player's persistent
   * leader is stored under, so progression survives across matches with no signup,
   * no password and no personal data leaving the device.
   */
  static deviceId(): string {
    let id = localStorage.getItem('warfront.device');
    if (!id) {
      id = `d${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem('warfront.device', id);
    }
    return id;
  }

  static defaultEndpoint(): string {
    const stored = localStorage.getItem('warfront.server');
    if (stored) return stored;
    const { protocol, hostname } = window.location;
    if (protocol === 'file:' || hostname === '' || hostname === 'localhost') {
      // Running as an APK: connect to the cloud server with zero config.
      // Local dev (localhost): still default to the cloud so one build works for
      // everything — override the Server field if you want to run locally.
      return 'wss://warfrontclient-production.up.railway.app';
    }
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${hostname}:2567`;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get state(): MatchView | null {
    return this.room?.state ?? null;
  }

  get isHost(): boolean {
    return !!this.state && this.state.hostId === this.sessionId;
  }

  httpEndpoint(): string {
    return this.endpoint.replace(/^ws/, 'http');
  }

  async requestCode(endpoint: string): Promise<string> {
    const response = await fetch(`${endpoint.replace(/^ws/, 'http')}/api/code`);
    if (!response.ok) throw new Error('server_unreachable');
    const body = (await response.json()) as { code: string };
    return body.code;
  }

  async listLobbies(endpoint: string): Promise<Array<{ code: string; players: number; maxPlayers: number }>> {
    const response = await fetch(`${endpoint.replace(/^ws/, 'http')}/api/lobbies`);
    if (!response.ok) throw new Error('server_unreachable');
    const body = await response.json();
    return body.lobbies ?? [];
  }

  async create(endpoint: string, name: string, leaderClass: LeaderClass): Promise<string> {
    this.endpoint = endpoint;
    localStorage.setItem('warfront.server', endpoint);
    const code = await this.requestCode(endpoint);
    const client = new Client(endpoint);
    this.attach(await client.create<MatchView>('war', {
      code, name, leaderClass, host: true, deviceId: NetClient.deviceId(),
    }));
    return code;
  }

  async join(endpoint: string, code: string, name: string, leaderClass: LeaderClass): Promise<void> {
    this.endpoint = endpoint;
    localStorage.setItem('warfront.server', endpoint);
    const client = new Client(endpoint);
    this.attach(await client.join<MatchView>('war', {
      code: code.toUpperCase(), name, leaderClass, deviceId: NetClient.deviceId(),
    }));
  }

  private attach(room: Room<MatchView>): void {
    this.room = room;
    // Colyseus delivers a binary patch; onStateChange fires once per patch (5 Hz).
    room.onStateChange((state) => this.stateHandlers.forEach((h) => h(state)));
    room.onMessage('events', (events: GameEvent[]) => this.eventHandlers.forEach((h) => h(events)));
    room.onMessage('event', (event: GameEvent) => this.eventHandlers.forEach((h) => h([event])));
    room.onMessage('reject', (payload) => this.rejectHandlers.forEach((h) => h(payload)));
    room.onMessage('advice', (payload: Suggestion[]) => this.adviceHandlers.forEach((h) => h(payload)));
    room.onMessage('match_over', (payload) => this.overHandlers.forEach((h) => h(payload)));
    room.onLeave((code) => this.leaveHandlers.forEach((h) => h(code)));

    // Remember the reconnection token so a reload or a dropped WiFi rejoins the same seat.
    localStorage.setItem('warfront.session', JSON.stringify({
      roomId: room.id,
      sessionId: room.sessionId,
      token: room.reconnectionToken,
    }));
  }

  /** Reconnect after the app was backgrounded or the network dropped. */
  async tryReconnect(): Promise<boolean> {
    const raw = localStorage.getItem('warfront.session');
    if (!raw || !this.endpoint) return false;
    try {
      // Colyseus 0.15 reconnects with a single opaque token, not roomId + sessionId.
      const { token } = JSON.parse(raw) as { token: string };
      if (!token) return false;
      const client = new Client(this.endpoint);
      this.attach(await client.reconnect<MatchView>(token));
      return true;
    } catch {
      return false;
    }
  }

  send(command: Command): void {
    this.room?.send('cmd', command);
  }

  setReady(ready: boolean): void {
    this.room?.send('ready', ready);
  }

  startMatch(): void {
    this.room?.send('start');
  }

  requestAdvice(): void {
    this.room?.send('advice');
  }

  updateLeader(name: string, leaderClass: LeaderClass): void {
    this.room?.send('leader', { name, leaderClass });
  }

  setAppearance(appearance: Partial<LeaderAppearance>): void {
    this.send({ t: 'SET_APPEARANCE', appearance });
  }

  async leave(): Promise<void> {
    await this.room?.leave(true);
    this.room = null;
    localStorage.removeItem('warfront.session');
  }

  onState(handler: Handler<MatchView>): void { this.stateHandlers.push(handler); }
  onEvents(handler: Handler<GameEvent[]>): void { this.eventHandlers.push(handler); }
  onReject(handler: Handler<{ reason?: string; message?: string }>): void { this.rejectHandlers.push(handler); }
  onAdvice(handler: Handler<Suggestion[]>): void { this.adviceHandlers.push(handler); }
  onMatchOver(handler: Handler<{ winnerTeam: number }>): void { this.overHandlers.push(handler); }
  onLeave(handler: Handler<number>): void { this.leaveHandlers.push(handler); }
}
