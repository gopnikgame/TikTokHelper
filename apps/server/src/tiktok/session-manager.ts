import { createHash, randomUUID } from 'node:crypto';
import type {
  ChatSpeakerContext, ConnectionStateEvent, GiftCompletedEvent, GiftEvent, LikeGoalConfiguration, LiveActivityState,
  LivePollState, StartLivePoll,
} from '@tiktok-helper/contracts';
import { GiftStreakTracker } from './gift-streaks.js';
import { LiveActivity, normalizeLiveActivity, PendingLiveActivity, type ActivitySample } from './live-activity.js';
import { LivePollTracker } from './live-poll.js';
import { messageRoomId, normalizeChat, normalizeGift, tiktokRoomId } from './normalizer.js';
import {
  LIVE_ACTIVITY_EVENTS, type GiftAccounting, type LiveConnector, type LiveConnectorFactory, type LiveConnectionState,
  type LiveSessionSnapshot, type RealtimeEventSink,
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
  disconnecting?: Promise<void>;
  tiktokUsername: string;
  seenChatIds: Set<string>;
  gifts: GiftStreakTracker;
  activity: LiveActivity;
  poll: LivePollTracker;
  roomId?: string;
  connectionId: string;
  streamId: string;
  prepared: boolean;
  giftOverflow: boolean;
}

interface GiftAcceptance {
  repeatCount: number;
  applyEntitlements?: () => void;
  announce?: () => void;
}

interface PendingMessage {
  kind: 'chat' | 'gift';
  raw: unknown;
  historical: boolean;
}

const MAX_PENDING_MESSAGES = 500;
const MAX_PENDING_GIFTS = 1_000;
const MAX_GIFT_COMPLETION_VALUE = 2_147_483_647;

function createStreamId(roomId: string | undefined): string {
  if (!roomId) return randomUUID();
  const hash = createHash('sha256').update('tiktok-helper:room:').update(roomId).digest();
  // RFC 9562 name-based UUIDv8, so the existing PostgreSQL UUID columns can identify a room.
  hash[6] = (hash[6]! & 0x0f) | 0x80;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface TikTokDiagnostic {
  event: 'connect_failed' | 'connector_error' | 'disconnected' | 'gift_intake_full' | 'gift_accounting_failed' | 'gift_completion_failed'
    | 'gift_observer_failed' | 'live_activity_observer_failed' | 'live_poll_observer_failed';
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
  readonly #pendingGifts = new Map<string, { done: Promise<void>; count: number }>();
  readonly #likeGoals = new Map<string, LikeGoalConfiguration>();

  constructor(
    private readonly connectorFactory: LiveConnectorFactory,
    private readonly sink: RealtimeEventSink = () => undefined,
    private readonly scheduler: Scheduler = systemScheduler,
    private readonly diagnostics: (entry: TikTokDiagnostic) => void = () => undefined,
    private readonly connectionRequested: (workspaceId: string, username: string) => void = () => undefined,
    private readonly giftObserved: (
      workspaceId: string, streamId: string, gift: GiftEvent, senderIdentityKey: string, accounting: GiftAccounting,
    ) => void | Promise<GiftAcceptance> = () => undefined,
    private readonly sessionPrepared: (workspaceId: string, streamId: string) => Promise<void> = async () => undefined,
    private readonly resolveSpeakerContext: (
      workspaceId: string, senderIdentityKey: string,
      roles: { isModerator: boolean; isGiftGiver: boolean },
    ) => ChatSpeakerContext = (_workspaceId, _identityKey, roles) => ({ ...roles, speechLevels: [] }),
    private readonly rememberHistoricalStreak?: (workspaceId: string, key: string, count: number) => Promise<void>,
    private readonly giftCompleted?: (event: GiftCompletedEvent, streakable: boolean) => void | Promise<void>,
    private readonly giftAccepted?: (workspaceId: string, connectionId: string, gift: GiftEvent, identityKey: string) => void,
    private readonly liveActivityChanged?: (workspaceId: string) => void,
    private readonly livePollChanged?: (workspaceId: string) => void,
  ) {}

  async start(workspaceId: string, username: string): Promise<LiveSessionSnapshot> {
    const normalizedUsername = username.replace(/^@/, '');
    this.connectionRequested(workspaceId, normalizedUsername);
    const current = this.#sessions.get(workspaceId);
    if (current && !current.stopped && current.tiktokUsername === normalizedUsername) {
      return this.status(workspaceId);
    }
    const generation = (current?.generation ?? 0) + 1;
    const previousStop = this.stop(workspaceId);
    const session: Session = {
      connector: null, generation,
      sequence: 0, state: 'stopped', stopped: false, reconnectAttempt: 0,
      tiktokUsername: normalizedUsername, seenChatIds: new Set(), gifts: new GiftStreakTracker(),
      activity: new LiveActivity(this.#likeGoals.get(workspaceId)),
      poll: new LivePollTracker(),
      connectionId: randomUUID(), streamId: randomUUID(), prepared: false, giftOverflow: false,
      disconnecting: previousStop.then(() => undefined),
    };
    this.#sessions.set(workspaceId, session);
    await previousStop;
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
    this.#transition(workspaceId, session, 'stopped');
    if (connector) this.#disconnectConnector(session, connector);
    await session.disconnecting;
    return this.status(workspaceId);
  }

  status(workspaceId: string): LiveSessionSnapshot {
    const session = this.#sessions.get(workspaceId);
    return session ? {
      workspaceId, tiktokUsername: session.tiktokUsername, generation: session.generation,
      lastSequence: session.sequence, state: session.state, connectionId: session.connectionId,
    } : this.#emptySnapshot(workspaceId);
  }

  getLiveActivity(workspaceId: string): LiveActivityState {
    const session = this.#sessions.get(workspaceId);
    const activity = session?.activity ?? new LiveActivity(this.#likeGoals.get(workspaceId));
    return activity.snapshot(workspaceId, session?.generation ?? 0, session?.connectionId ?? null);
  }

  getLivePoll(workspaceId: string): LivePollState {
    const session = this.#sessions.get(workspaceId);
    return session ? session.poll.snapshot(workspaceId, session.generation, session.connectionId)
      : { workspaceId, generation: 0, connectionId: null, revision: 0, poll: null };
  }

  startLivePoll(workspaceId: string, input: StartLivePoll): LivePollState | undefined {
    const session = this.#sessions.get(workspaceId);
    if (session?.state !== 'live' || session.connectionId !== input.connectionId || !session.poll.start(input)) return undefined;
    this.#notifyLivePoll(workspaceId);
    return this.getLivePoll(workspaceId);
  }

  closeLivePoll(workspaceId: string, pollId: string): LivePollState | undefined {
    const result = this.#sessions.get(workspaceId)?.poll.close(pollId);
    if (!result) return undefined;
    if (result === 'updated') this.#notifyLivePoll(workspaceId);
    return this.getLivePoll(workspaceId);
  }

  setLikeGoal(workspaceId: string, configuration: LikeGoalConfiguration): void {
    if (configuration.revision <= (this.#likeGoals.get(workspaceId)?.revision ?? 0)) return;
    this.#likeGoals.set(workspaceId, { ...configuration });
    this.#sessions.get(workspaceId)?.activity.configure(configuration);
    this.#notifyLiveActivity(workspaceId);
  }

  #isActiveStream(workspaceId: string, streamId: string, generation: number): boolean {
    const session = this.#sessions.get(workspaceId);
    return !!session && !session.stopped && session.state !== 'offline'
      && session.streamId === streamId && session.generation === generation;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map(async (workspaceId) => this.stop(workspaceId)));
    await Promise.all([...this.#pendingGifts.values()].map(({ done }) => done));
  }

  async #connect(workspaceId: string, session: Session, reconnecting: boolean): Promise<void> {
    if (session.stopped || this.#sessions.get(workspaceId) !== session) return;
    this.#transition(workspaceId, session, reconnecting ? 'reconnecting' : 'connecting');
    let connector: LiveConnector;
    try { connector = this.connectorFactory(session.tiktokUsername); }
    catch (error) {
      this.diagnostics(diagnostic(error, 'connect_failed'));
      this.#transition(workspaceId, session, 'failed');
      this.#scheduleReconnect(workspaceId, session);
      return;
    }
    session.connector = connector;
    const isCurrent = () => !session.stopped && session.connector === connector && this.#sessions.get(workspaceId) === session;
    const pending: PendingMessage[] = [];
    const pendingActivity = new PendingLiveActivity();
    let ready = false;
    const deliver = ({ kind, raw, historical }: PendingMessage) => {
      const roomId = messageRoomId(raw);
      if (roomId && session.roomId && roomId !== session.roomId) return;
      if (kind === 'chat') this.#onChat(workspaceId, session, raw, historical);
      else this.#onGift(workspaceId, session, raw, historical);
    };
    const receive = (kind: PendingMessage['kind'], raw: unknown, historical = false) => {
      if (!isCurrent()) return;
      if (ready) { deliver({ kind, raw, historical }); return; }
      if (pending.length >= MAX_PENDING_MESSAGES) {
        const chat = pending.findIndex((message) => message.kind === 'chat');
        if (chat < 0 && kind === 'chat') return;
        pending.splice(Math.max(0, chat), 1);
      }
      pending.push({ kind, raw, historical });
    };
    connector.on('chat', (raw, historical) => receive('chat', raw, historical));
    connector.on('gift', (raw, historical) => receive('gift', raw, historical));
    const deliverActivity = (sample: ActivitySample) => {
      if (sample.roomId && session.roomId && sample.roomId !== session.roomId) return;
      if (session.activity.apply(sample)) this.#notifyLiveActivity(workspaceId);
    };
    for (const kind of LIVE_ACTIVITY_EVENTS) connector.on(kind, (raw, historical = false) => {
      if (!isCurrent()) return;
      const sample = normalizeLiveActivity(kind, raw, historical);
      if (!sample) return;
      if (ready) { deliverActivity(sample); return; }
      pendingActivity.add(sample);
    });
    connector.on('streamEnd', () => { if (isCurrent()) void this.#goOffline(workspaceId, session); });
    connector.on('disconnected', (event) => {
      if (!isCurrent()) return;
      this.diagnostics(diagnostic(event, 'disconnected'));
      this.#scheduleReconnect(workspaceId, session);
    });
    connector.on('error', (error) => {
      if (!isCurrent()) return;
      this.diagnostics(diagnostic(error, 'connector_error'));
      if (ready) this.#scheduleReconnect(workspaceId, session);
    });
    try {
      const connectedRoom = tiktokRoomId(await connector.connect());
      if (!isCurrent()) {
        await connector.disconnect().catch(() => undefined);
        return;
      }
      const firstKnownRoom = pending.find((message) => !message.historical && messageRoomId(message.raw));
      const observedRoom = connectedRoom ?? messageRoomId(firstKnownRoom?.raw) ?? pendingActivity.firstRoomId;
      pendingActivity.selectRoom(observedRoom ?? session.roomId);
      if (observedRoom && observedRoom !== session.roomId) {
        const wasPrepared = session.prepared;
        session.roomId = observedRoom;
        session.streamId = createStreamId(observedRoom);
        if (wasPrepared) {
          session.generation += 1;
          session.sequence = 0;
          session.state = 'stopped';
          session.seenChatIds.clear();
          session.gifts = new GiftStreakTracker();
          session.activity = new LiveActivity(this.#likeGoals.get(workspaceId));
          session.poll = new LivePollTracker();
          session.connectionId = randomUUID();
          session.prepared = false;
          this.#transition(workspaceId, session, 'connecting');
        }
      }
      if (!session.prepared || reconnecting) {
        // Take a fresh entitlement snapshot after gifts from the previous connection commit.
        await this.#pendingGifts.get(workspaceId)?.done;
        if (!isCurrent()) return;
        await this.sessionPrepared(workspaceId, session.streamId);
        if (!isCurrent()) return;
        session.prepared = true;
      }
      session.reconnectAttempt = 0;
      this.#transition(workspaceId, session, 'live');
      ready = true;
      for (const message of pending) deliver(message);
      pending.length = 0;
      for (const sample of pendingActivity.drain()) {
        if (!isCurrent()) break;
        deliverActivity(sample);
      }
    } catch (error) {
      if (!isCurrent()) return;
      this.diagnostics(diagnostic(error, 'connect_failed'));
      connector.removeAllListeners();
      session.connector = null;
      this.#disconnectConnector(session, connector);
      await session.disconnecting;
      if (session.stopped || this.#sessions.get(workspaceId) !== session) return;
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
    const connector = session.connector;
    session.connector = null;
    connector?.removeAllListeners();
    this.#transition(workspaceId, session, 'offline');
    if (connector) this.#disconnectConnector(session, connector);
    await session.disconnecting;
  }

  #scheduleReconnect(workspaceId: string, session: Session): void {
    if (session.stopped || session.reconnectTimer !== undefined) return;
    const connector = session.connector;
    session.connector = null;
    connector?.removeAllListeners();
    if (connector) this.#disconnectConnector(session, connector);
    if (session.state !== 'offline') this.#transition(workspaceId, session, 'reconnecting');
    const delay = Math.min(30_000, 1_000 * 2 ** session.reconnectAttempt++);
    session.reconnectTimer = this.scheduler.set(delay, () => {
      session.reconnectTimer = undefined;
      void Promise.resolve(session.disconnecting).then(() => this.#connect(workspaceId, session, true));
    });
  }

  #disconnectConnector(session: Session, connector: LiveConnector): void {
    session.disconnecting = connector.disconnect().catch(() => undefined);
  }

  #onChat(workspaceId: string, session: Session, raw: unknown, historical: boolean): void {
    const event = normalizeChat(raw, session.generation, session.sequence + 1);
    if (!event) return;
    const seen = session.seenChatIds.has(event.eventId);
    // A fallback ID identifies the text and author, which can recur in later polls.
    const pollChanged = !historical && (!seen || !event.upstreamEventId) && session.poll.accept(event);
    if (!seen) {
      session.seenChatIds.add(event.eventId);
      if (session.seenChatIds.size > 10_000) session.seenChatIds.delete(session.seenChatIds.values().next().value!);
      session.sequence = event.sequence;
      const identityKey = this.#workspaceIdentityKey(workspaceId, event.senderIdentityKey);
      const projectEvent = {
        ...event,
        ...(historical ? { historical: true as const } : {}),
        speakerContext: this.resolveSpeakerContext(workspaceId, identityKey, {
          isModerator: event.participant?.moderator === true,
          isGiftGiver: event.participant?.giftGiver === true,
        }),
      };
      delete (projectEvent as Partial<typeof event>).senderIdentityKey;
      delete (projectEvent as Partial<typeof event>).upstreamEventId;
      this.sink(workspaceId, projectEvent);
    }
    if (pollChanged) this.#notifyLivePoll(workspaceId);
  }

  #onGift(workspaceId: string, session: Session, raw: unknown, historical: boolean): void {
    const event = normalizeGift(raw, session.generation, session.sequence + 1);
    if (!event) return;
    const roomKey = session.roomId ?? messageRoomId(raw) ?? session.streamId;
    const streakKey = event.streakable && event.groupId
      ? createHash('sha256').update(JSON.stringify([
        roomKey, event.senderIdentityKey, event.giftId, event.groupId,
      ])).digest('hex') : undefined;
    const pending = this.#pendingGifts.get(workspaceId);
    if (!historical && pending && pending.count >= MAX_PENDING_GIFTS) {
      if (!session.giftOverflow) this.diagnostics({ event: 'gift_intake_full' });
      session.giftOverflow = true;
      return;
    }
    if (!historical) session.giftOverflow = false;
    const advancesHistory = historical && streakKey && event.repeatCount > session.gifts.historicalCount(event);
    const { increment, completion } = session.gifts.apply(event, historical);
    const rememberHistoricalStreak = this.rememberHistoricalStreak;
    if (advancesHistory && rememberHistoricalStreak && (!pending || pending.count < MAX_PENDING_GIFTS)) {
      const remember = () => rememberHistoricalStreak(workspaceId, streakKey, event.repeatCount);
      this.#trackGift(workspaceId, (pending?.done ?? Promise.resolve()).then(remember).catch(remember));
    }
    if (increment === 0 && (!completion || !this.giftCompleted)) return;
    const streamId = session.streamId;
    const connector = session.connector;
    const isFresh = () => session.state === 'live' && session.connector === connector
      && this.#isActiveStream(workspaceId, streamId, event.generation);
    const complete = (repeatCount = completion?.repeatCount) => {
      if (!this.giftCompleted || !completion || !repeatCount || repeatCount > MAX_GIFT_COMPLETION_VALUE || !isFresh()) return;
      const completionKey = streakKey ?? createHash('sha256').update(JSON.stringify([
        roomKey, event.senderIdentityKey, event.giftId, event.eventId,
      ])).digest('hex');
      const diamondCount = completion.diamondCount;
      const completed: GiftCompletedEvent = {
        eventId: `gift-complete:${completionKey}`, workspaceId, connectionId: session.connectionId, generation: event.generation,
        giftId: event.giftId, giftName: event.giftName.slice(0, 160), repeatCount,
        senderDisplayName: event.senderDisplayName.slice(0, 120), senderUsername: event.senderUsername.slice(0, 64),
        ...(diamondCount !== undefined && diamondCount <= MAX_GIFT_COMPLETION_VALUE ? { diamondCount } : {}),
      };
      const failed = (error: unknown) => this.diagnostics(diagnostic(error, 'gift_completion_failed'));
      try { return this.giftCompleted(completed, event.streakable)?.catch(failed); }
      catch (error) { failed(error); }
    };
    if (increment === 0) {
      // A final packet can close the series without adding gifts. Keep it behind the series' last write.
      const result = pending ? pending.done.then(() => complete()) : complete();
      if (result) this.#trackGift(workspaceId, result);
      return;
    }
    const eventId = event.streakable ? `streak:${createHash('sha256').update(JSON.stringify([
      streakKey ?? [session.roomId ?? session.streamId, event.senderIdentityKey, event.giftId, event.eventId], event.repeatCount,
    ])).digest('hex')}` : event.eventId;
    const projectEvent: GiftEvent = {
      type: 'gift.received', generation: event.generation, sequence: event.sequence, eventId,
      giftId: event.giftId, giftName: event.giftName, repeatCount: increment,
      senderDisplayName: event.senderDisplayName, senderUsername: event.senderUsername,
      imageUrl: event.imageUrl, diamondCount: event.diamondCount,
    };
    const workspaceIdentityKey = this.#workspaceIdentityKey(workspaceId, event.senderIdentityKey);
    const accounting: GiftAccounting = {
      streak: streakKey ? { key: streakKey, historicalCount: session.gifts.historicalCount(event), totalCount: event.repeatCount } : undefined,
      upstreamEventId: event.streakable ? event.upstreamEventId : undefined,
    };
    const finish = (result: GiftAcceptance | void) => {
      if (!this.#isActiveStream(workspaceId, streamId, projectEvent.generation)) return;
      result?.applyEntitlements?.();
      const repeatCount = result?.repeatCount ?? increment;
      if (repeatCount > 0) {
        const acceptedGift: GiftEvent = {
          ...projectEvent, sequence: ++session.sequence, repeatCount,
          ...(!isFresh() ? { historical: true } : {}),
        };
        this.sink(workspaceId, acceptedGift);
        try { this.giftAccepted?.(workspaceId, session.connectionId, acceptedGift, workspaceIdentityKey); }
        catch (error) { this.diagnostics(diagnostic(error, 'gift_observer_failed')); }
        if (isFresh()) result?.announce?.();
      }
      if (event.streakable || repeatCount > 0) return complete(event.streakable ? completion?.repeatCount : repeatCount);
    };
    const accept = () => this.giftObserved(workspaceId, streamId, projectEvent, workspaceIdentityKey, accounting);
    const retry = (error: unknown) => {
      // The event/series keys also protect the retry if commit succeeded before its response was lost.
      this.diagnostics(diagnostic(error, 'gift_accounting_failed'));
      return accept();
    };
    if (!pending) {
      try {
        const result = accept();
        const settled = result ? result.catch<GiftAcceptance | void>(retry).then(finish) : finish(result);
        if (settled) this.#trackGift(workspaceId, settled);
      } catch (error) {
        this.#trackGift(workspaceId, Promise.resolve().then<GiftAcceptance | void>(() => retry(error)).then(finish));
      }
      return;
    }
    this.#trackGift(workspaceId, pending.done.then<GiftAcceptance | void>(accept).catch<GiftAcceptance | void>(retry).then(finish));
  }

  #trackGift(workspaceId: string, result: Promise<void>): void {
    const pending = this.#pendingGifts.get(workspaceId) ?? { done: Promise.resolve(), count: 0 };
    pending.count += 1;
    pending.done = result.catch((error: unknown) => {
      this.diagnostics(diagnostic(error, 'gift_accounting_failed'));
    }).finally(() => {
      pending.count -= 1;
      if (!pending.count) this.#pendingGifts.delete(workspaceId);
    });
    this.#pendingGifts.set(workspaceId, pending);
  }

  #workspaceIdentityKey(workspaceId: string, senderIdentityKey: string): string {
    return createHash('sha256').update(workspaceId).update('\0').update(senderIdentityKey).digest('hex');
  }

  #notifyLiveActivity(workspaceId: string): void {
    try { this.liveActivityChanged?.(workspaceId); }
    catch (error: unknown) { this.diagnostics(diagnostic(error, 'live_activity_observer_failed')); }
  }

  #notifyLivePoll(workspaceId: string): void {
    try { this.livePollChanged?.(workspaceId); }
    catch (error: unknown) { this.diagnostics(diagnostic(error, 'live_poll_observer_failed')); }
  }

  #transition(workspaceId: string, session: Session, state: LiveConnectionState): void {
    if (session.state === state) return;
    session.state = state;
    session.activity.connectionChanged(state === 'live');
    if (state === 'stopped' || state === 'offline' || state === 'failed') session.poll.close();
    const event: ConnectionStateEvent = {
      type: 'connection.state', generation: session.generation, sequence: ++session.sequence, state, connectionId: session.connectionId,
    };
    this.sink(workspaceId, event);
    this.#notifyLiveActivity(workspaceId);
    this.#notifyLivePoll(workspaceId);
  }

  #emptySnapshot(workspaceId: string): LiveSessionSnapshot {
    return { workspaceId, tiktokUsername: null, generation: 0, lastSequence: 0, state: 'stopped' };
  }
}
