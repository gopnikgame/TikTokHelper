import { createHash } from 'node:crypto';
import { LIVE_ACTIVITY_RECENT_LIMIT, type LikeGoalConfiguration, type LiveActivityState, type LiveSocialAction } from '@tiktok-helper/contracts';
import { messageRoomId, tiktokRoomId } from './normalizer.js';
import type { LiveActivityEvent } from './types.js';

type Activity =
  | { kind: 'roomUser'; count: number }
  | { kind: 'like'; count: number }
  | (LiveSocialAction & { key: string });

export interface ActivitySample { event: Activity; roomId: string | undefined; historical: boolean }

const SEEN_ACTION_LIMIT = 500;
const PENDING_ROOM_LIMIT = 4;
const PENDING_ACTION_LIMIT = 128;
const DEFAULT_GOAL: LikeGoalConfiguration = { targetCount: null, revision: 0 };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function count(value: unknown, minimum: number): number | undefined {
  const parsed = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

function actionIdentity(user: Record<string, unknown> | undefined): string | undefined {
  if (!user) return undefined;
  const id = tiktokRoomId(user.id) ?? tiktokRoomId(user.idStr);
  if (id) return `id:${id}`;
  if (typeof user.secUid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(user.secUid)) return `sec:${user.secUid}`;
  return undefined;
}

function actionKey(kind: LiveSocialAction['kind'], raw: Record<string, unknown>, user: Record<string, unknown> | undefined): string | undefined {
  const common = record(raw.common);
  const msgId = tiktokRoomId(common?.msgId) ?? tiktokRoomId(raw.msgId);
  if (msgId) return `${kind}:message:${msgId}`;
  const createdAt = tiktokRoomId(common?.createTime);
  const identity = actionIdentity(user);
  if (!createdAt || !identity) return undefined;
  return `${kind}:time:${createHash('sha256').update(JSON.stringify([identity, createdAt])).digest('hex')}`;
}

function nickname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.slice(0, 512).replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim().slice(0, 120).toWellFormed().trim() || null;
}

export function normalizeLiveActivity(kind: LiveActivityEvent, value: unknown, historical: boolean): ActivitySample | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  if (kind === 'roomUser' || kind === 'like') {
    if (historical) return undefined;
    const viewers = kind === 'roomUser';
    // v3 exposes the room counters as `total`. The two explicit names belong to older projections.
    // The decoder defaults totals to zero. For likes, wait for a positive baseline.
    const minimum = viewers ? 0 : 1;
    const roomId = messageRoomId(raw);
    const total = count(raw.total, minimum);
    const common = record(raw.common);
    // An empty room packet provides no evidence that the viewer count went to zero.
    const missingViewerTotal = viewers && total === 0 && !roomId && !tiktokRoomId(common?.msgId) && !tiktokRoomId(common?.createTime);
    const quantity = (missingViewerTotal ? undefined : total) ?? count(viewers ? raw.viewerCount : raw.totalLikeCount, minimum);
    return quantity === undefined ? undefined : { event: { kind, count: quantity }, roomId, historical };
  }

  const user = record(raw.user);
  const key = actionKey(kind, raw, user);
  if (!key) return undefined;
  return { event: { kind, key, displayName: historical ? null : nickname(user?.nickname) }, roomId: messageRoomId(raw), historical };
}

interface BufferedSample { index: number; sample: ActivitySample }

interface BufferedRoom {
  viewers?: BufferedSample;
  firstLike?: BufferedSample;
  highestLike?: BufferedSample & { count: number };
  actions: Map<string, BufferedSample>;
}

/** Retains the first and highest likes and latest viewers while the connector is being prepared. */
export class PendingLiveActivity {
  readonly #rooms = new Map<string | undefined, BufferedRoom>();
  #index = 0;
  #roomId?: string;
  #firstRoomId?: string;

  get firstRoomId(): string | undefined { return this.#firstRoomId; }

  selectRoom(roomId: string | undefined): void {
    this.#roomId = roomId;
    if (!roomId) return;
    for (const id of this.#rooms.keys()) {
      if (id && id !== roomId) this.#rooms.delete(id);
    }
  }

  add(sample: ActivitySample): void {
    const { roomId, event } = sample;
    if (this.#roomId && roomId && roomId !== this.#roomId) return;
    if (!sample.historical && roomId) this.#firstRoomId ??= roomId;
    let room = this.#rooms.get(roomId);
    if (!room) {
      const knownRoomCount = this.#rooms.size - Number(this.#rooms.has(undefined));
      if (roomId && knownRoomCount >= PENDING_ROOM_LIMIT) return;
      room = { actions: new Map() };
      this.#rooms.set(roomId, room);
    }

    const buffered = { index: this.#index++, sample };
    if (event.kind === 'roomUser') {
      room.viewers = buffered;
    } else if (event.kind === 'like') {
      const highest = { ...buffered, count: event.count };
      room.firstLike ??= highest;
      if (!room.highestLike || event.count > room.highestLike.count) room.highestLike = highest;
    } else if (!room.actions.has(event.key)) {
      room.actions.set(event.key, buffered);
      if (room.actions.size > PENDING_ACTION_LIMIT) {
        const oldest = room.actions.keys().next().value;
        if (oldest !== undefined) room.actions.delete(oldest);
      }
    }
  }

  drain(): ActivitySample[] {
    const sorted = [...this.#rooms.values()].flatMap(({ viewers, firstLike, highestLike, actions }) =>
      [viewers, firstLike, highestLike === firstLike ? undefined : highestLike, ...actions.values()]
        .filter((entry) => entry !== undefined)).sort((a, b) => a.index - b.index);
    this.#rooms.clear();
    return sorted.map(({ sample }) => sample);
  }
}

/** State for one connection generation. Upstream identifiers stay inside the deduplication set. */
export class LiveActivity {
  #revision: number;
  #viewers: number | null = null;
  #totalLikes: number | null = null;
  #baselineLikes: number | null = null;
  #goal: LikeGoalConfiguration;
  readonly #recentActions: LiveSocialAction[] = [];
  readonly #seenActions = new Set<string>();

  constructor(configuration = DEFAULT_GOAL) {
    this.#goal = { ...configuration };
    this.#revision = configuration.revision;
  }

  snapshot(workspaceId: string, generation: number, connectionId: string | null): LiveActivityState {
    return {
      workspaceId, generation, connectionId, revision: this.#revision, viewers: this.#viewers, totalLikes: this.#totalLikes,
      likeGoal: { ...this.#goal, baselineLikes: this.#baselineLikes },
      recentActions: this.#recentActions.map((action) => ({ ...action })),
    };
  }

  configure(configuration: LikeGoalConfiguration): void {
    this.#goal = { ...configuration };
    this.#baselineLikes = configuration.targetCount === null ? null : this.#totalLikes;
    this.#revision += 1;
  }

  connectionChanged(live: boolean): void {
    if (!live) this.#viewers = null;
    this.#revision += 1;
  }

  apply({ event, historical }: ActivitySample): boolean {
    if (event.kind === 'roomUser') {
      if (this.#viewers === event.count) return false;
      this.#viewers = event.count;
    } else if (event.kind === 'like') {
      if (this.#totalLikes !== null && event.count <= this.#totalLikes) return false;
      this.#totalLikes = event.count;
      if (this.#goal.targetCount !== null) this.#baselineLikes ??= event.count;
    } else {
      if (this.#seenActions.has(event.key)) return false;
      this.#seenActions.add(event.key);
      if (this.#seenActions.size > SEEN_ACTION_LIMIT) {
        const oldest = this.#seenActions.values().next().value;
        if (oldest !== undefined) this.#seenActions.delete(oldest);
      }
      if (historical) return false;
      this.#recentActions.unshift({ kind: event.kind, displayName: event.displayName });
      if (this.#recentActions.length > LIVE_ACTIVITY_RECENT_LIMIT) this.#recentActions.pop();
    }
    this.#revision += 1;
    return true;
  }
}
