import type { ConnectionStateEvent, GiftEvent } from '@tiktok-helper/contracts';
import { normalizeChat, normalizeGift } from './normalizer.js';
import type {
  LiveConnector, LiveConnectorFactory, LiveConnectionState, LiveSessionSnapshot, RealtimeEventSink,
} from './types.js';

export interface Scheduler {
  set(delayMs: number, callback: () => void): unknown;
  clear(handle: unknown): void;
}

const systemScheduler: Scheduler = {
  set: (delayMs, callback) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Session {
  connector: LiveConnector | null;
  generation: number;
  sequence: number;
  state: LiveConnectionState;
  stopped: boolean;
  reconnectAttempt: number;
  reconnectTimer?: unknown;
  tiktokUsername: string;
  seenEventIds: Set<string>;
  giftStreakCounts: Map<string, number>;
}

export class TikTokSessionManager {
  readonly #sessions = new Map<string, Session>();

  constructor(
    private readonly connectorFactory: LiveConnectorFactory,
    private readonly sink: RealtimeEventSink = () => undefined,
    private readonly scheduler: Scheduler = systemScheduler,
  ) {}

  async start(workspaceId: string, username: string): Promise<LiveSessionSnapshot> {
    await this.stop(workspaceId);
    const session: Session = {
      connector: null, generation: (this.#sessions.get(workspaceId)?.generation ?? 0) + 1,
      sequence: 0, state: 'stopped', stopped: false, reconnectAttempt: 0,
      tiktokUsername: username.replace(/^@/, ''), seenEventIds: new Set(), giftStreakCounts: new Map(),
    };
    this.#sessions.set(workspaceId, session);
    await this.#connect(workspaceId, session, false);
    return this.status(workspaceId);
  }

  async stop(workspaceId: string): Promise<LiveSessionSnapshot> {
    const session = this.#sessions.get(workspaceId);
    if (!session) return this.#emptySnapshot(workspaceId);
    session.stopped = true;
    if (session.reconnectTimer !== undefined) this.scheduler.clear(session.reconnectTimer);
    session.reconnectTimer = undefined;
    const connector = session.connector;
    session.connector = null;
    connector?.removeAllListeners();
    if (connector) await connector.disconnect().catch(() => undefined);
    this.#transition(workspaceId, session, 'stopped');
    return this.status(workspaceId);
  }

  status(workspaceId: string): LiveSessionSnapshot {
    const session = this.#sessions.get(workspaceId);
    return session ? {
      workspaceId, tiktokUsername: session.tiktokUsername, generation: session.generation,
      lastSequence: session.sequence, state: session.state,
    } : this.#emptySnapshot(workspaceId);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map(async (workspaceId) => this.stop(workspaceId)));
  }

  async #connect(workspaceId: string, session: Session, reconnecting: boolean): Promise<void> {
    if (session.stopped) return;
    this.#transition(workspaceId, session, reconnecting ? 'reconnecting' : 'connecting');
    const connector = this.connectorFactory(session.tiktokUsername);
    session.connector = connector;
    connector.on('chat', (raw) => this.#onChat(workspaceId, session, raw));
    connector.on('gift', (raw) => this.#onGift(workspaceId, session, raw));
    connector.on('streamEnd', () => { void this.#goOffline(workspaceId, session); });
    connector.on('disconnected', () => this.#scheduleReconnect(workspaceId, session));
    connector.on('error', () => this.#scheduleReconnect(workspaceId, session));
    try {
      await connector.connect();
      if (session.stopped || session.connector !== connector) return;
      session.reconnectAttempt = 0;
      this.#transition(workspaceId, session, 'live');
    } catch (error) {
      connector.removeAllListeners();
      await connector.disconnect().catch(() => undefined);
      session.connector = null;
      if (error instanceof Error && error.message === 'TIKTOK_USER_OFFLINE') {
        this.#transition(workspaceId, session, 'offline');
      } else {
        this.#transition(workspaceId, session, 'failed');
      }
      this.#scheduleReconnect(workspaceId, session);
    }
  }

  async #goOffline(workspaceId: string, session: Session): Promise<void> {
    if (session.stopped) return;
    session.connector?.removeAllListeners();
    await session.connector?.disconnect().catch(() => undefined);
    session.connector = null;
    this.#transition(workspaceId, session, 'offline');
  }

  #scheduleReconnect(workspaceId: string, session: Session): void {
    if (session.stopped || session.reconnectTimer !== undefined) return;
    session.connector?.removeAllListeners();
    session.connector = null;
    if (session.state !== 'offline') this.#transition(workspaceId, session, 'reconnecting');
    const delay = Math.min(30_000, 1_000 * 2 ** session.reconnectAttempt++);
    session.reconnectTimer = this.scheduler.set(delay, () => {
      session.reconnectTimer = undefined;
      void this.#connect(workspaceId, session, true);
    });
  }

  #onChat(workspaceId: string, session: Session, raw: unknown): void {
    const event = normalizeChat(raw, session.generation, session.sequence + 1);
    if (!event || !this.#accept(session, event.eventId)) return;
    session.sequence = event.sequence;
    this.sink(workspaceId, event);
  }

  #onGift(workspaceId: string, session: Session, raw: unknown): void {
    const event = normalizeGift(raw, session.generation, session.sequence + 1);
    if (!event || !this.#accept(session, event.eventId)) return;
    const streakKey = `${event.senderDisplayName}\u001f${event.giftId}`;
    const previousCount = session.giftStreakCounts.get(streakKey) ?? 0;
    const increment = event.streakable ? Math.max(0, event.repeatCount - previousCount) : event.repeatCount;
    if (event.streakable && !event.repeatEnd) session.giftStreakCounts.set(streakKey, event.repeatCount);
    else session.giftStreakCounts.delete(streakKey);
    if (increment === 0) return;
    session.sequence = event.sequence;
    const projectEvent: GiftEvent = { ...event, repeatCount: increment };
    delete (projectEvent as Partial<typeof event>).repeatEnd;
    delete (projectEvent as Partial<typeof event>).streakable;
    this.sink(workspaceId, projectEvent);
  }

  #accept(session: Session, eventId: string): boolean {
    if (session.seenEventIds.has(eventId)) return false;
    session.seenEventIds.add(eventId);
    if (session.seenEventIds.size > 10_000) {
      const oldest = session.seenEventIds.values().next().value as string | undefined;
      if (oldest) session.seenEventIds.delete(oldest);
    }
    return true;
  }

  #transition(workspaceId: string, session: Session, state: LiveConnectionState): void {
    if (session.state === state) return;
    session.state = state;
    const event: ConnectionStateEvent = {
      type: 'connection.state', generation: session.generation, sequence: ++session.sequence, state,
    };
    this.sink(workspaceId, event);
  }

  #emptySnapshot(workspaceId: string): LiveSessionSnapshot {
    return { workspaceId, tiktokUsername: null, generation: 0, lastSequence: 0, state: 'stopped' };
  }
}
