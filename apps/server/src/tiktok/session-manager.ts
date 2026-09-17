import { createHash, randomUUID } from 'node:crypto';
import type { ChatSpeakerContext, ConnectionStateEvent, GiftEvent } from '@tiktok-helper/contracts';
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
  streamId: string;
}

export interface TikTokDiagnostic {
  event: 'connect_failed' | 'connector_error' | 'disconnected';
  errorName?: string;
  code?: string | number;
  statusCode?: number;
}

function diagnostic(error: unknown, event: TikTokDiagnostic['event']): TikTokDiagnostic {
  if (typeof error !== 'object' || error === null) return { event };
  const value = error as { name?: unknown; code?: unknown; statusCode?: unknown };
  return {
    event,
    ...(typeof value.name === 'string' ? { errorName: value.name.slice(0, 80) } : {}),
    ...(['string', 'number'].includes(typeof value.code) ? { code: value.code as string | number } : {}),
    ...(typeof value.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
  };
}

export class TikTokSessionManager {
  readonly #sessions = new Map<string, Session>();

  constructor(
    private readonly connectorFactory: LiveConnectorFactory,
    private readonly sink: RealtimeEventSink = () => undefined,
    private readonly scheduler: Scheduler = systemScheduler,
    private readonly diagnostics: (entry: TikTokDiagnostic) => void = () => undefined,
    private readonly connectionRequested: (workspaceId: string, username: string) => void = () => undefined,
    private readonly giftObserved: (workspaceId: string, streamId: string, gift: GiftEvent, senderIdentityKey: string) => void = () => undefined,
    private readonly sessionPrepared: (workspaceId: string, streamId: string) => Promise<void> = async () => undefined,
    private readonly resolveSpeakerContext: (
      workspaceId: string, senderIdentityKey: string,
      roles: { isModerator: boolean; isGiftGiver: boolean },
    ) => ChatSpeakerContext = (_workspaceId, _identityKey, roles) => ({ ...roles, speechLevels: [] }),
  ) {}

  async start(workspaceId: string, username: string): Promise<LiveSessionSnapshot> {
    const normalizedUsername = username.replace(/^@/, '');
    this.connectionRequested(workspaceId, normalizedUsername);
    const current = this.#sessions.get(workspaceId);
    if (current && !current.stopped && current.tiktokUsername === normalizedUsername) {
      return this.status(workspaceId);
    }
    await this.stop(workspaceId);
    const session: Session = {
      connector: null, generation: (this.#sessions.get(workspaceId)?.generation ?? 0) + 1,
      sequence: 0, state: 'stopped', stopped: false, reconnectAttempt: 0,
      tiktokUsername: normalizedUsername, seenEventIds: new Set(), giftStreakCounts: new Map(), streamId: randomUUID(),
    };
    this.#sessions.set(workspaceId, session);
    await this.sessionPrepared(workspaceId, session.streamId);
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
    connector.on('disconnected', (event) => { this.diagnostics(diagnostic(event, 'disconnected')); this.#scheduleReconnect(workspaceId, session); });
    connector.on('error', (error) => { this.diagnostics(diagnostic(error, 'connector_error')); this.#scheduleReconnect(workspaceId, session); });
    try {
      await connector.connect();
      if (session.stopped || session.connector !== connector) return;
      session.reconnectAttempt = 0;
      this.#transition(workspaceId, session, 'live');
    } catch (error) {
      this.diagnostics(diagnostic(error, 'connect_failed'));
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
    const identityKey = this.#workspaceIdentityKey(workspaceId, event.senderIdentityKey);
    const projectEvent = {
      ...event,
      speakerContext: this.resolveSpeakerContext(workspaceId, identityKey, {
        isModerator: event.participant?.moderator === true,
        isGiftGiver: event.participant?.giftGiver === true,
      }),
    };
    delete (projectEvent as Partial<typeof event>).senderIdentityKey;
    this.sink(workspaceId, projectEvent);
  }

  #onGift(workspaceId: string, session: Session, raw: unknown): void {
    const event = normalizeGift(raw, session.generation, session.sequence + 1);
    if (!event || !this.#accept(session, event.eventId)) return;
    const streakKey = `${event.senderIdentityKey}\u001f${event.giftId}`;
    const previousCount = session.giftStreakCounts.get(streakKey) ?? 0;
    const increment = event.streakable ? Math.max(0, event.repeatCount - previousCount) : event.repeatCount;
    if (event.streakable && !event.repeatEnd) session.giftStreakCounts.set(streakKey, event.repeatCount);
    else session.giftStreakCounts.delete(streakKey);
    if (increment === 0) return;
    session.sequence = event.sequence;
    const projectEvent: GiftEvent = { ...event, repeatCount: increment };
    delete (projectEvent as Partial<typeof event>).repeatEnd;
    delete (projectEvent as Partial<typeof event>).streakable;
    delete (projectEvent as Partial<typeof event>).senderIdentityKey;
    const workspaceIdentityKey = this.#workspaceIdentityKey(workspaceId, event.senderIdentityKey);
    this.giftObserved(workspaceId, session.streamId, projectEvent, workspaceIdentityKey);
    this.sink(workspaceId, projectEvent);
  }

  #workspaceIdentityKey(workspaceId: string, senderIdentityKey: string): string {
    return createHash('sha256').update(workspaceId).update('\0').update(senderIdentityKey).digest('hex');
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
