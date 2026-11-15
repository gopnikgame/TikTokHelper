import {
  LAST_GIFT_OVERLAY_DURATION_MS,
  type GiftCompletedEvent, type LastGiftOverlaySnapshot, type LikeGoalOverlaySnapshot, type LivePollOverlaySnapshot,
} from '@tiktok-helper/contracts';
import type { TikTokSessionManager } from '../tiktok/session-manager.js';

interface LatestGift {
  eventId: string;
  connectionId: string;
  generation: number;
  giftName: string;
  quantity: number;
  expiresAt: number;
}

type LiveSessions = Pick<TikTokSessionManager, 'status' | 'getLiveActivity' | 'getLivePoll'>;

export class StreamOverlayRuntime {
  readonly #latestGifts = new Map<string, LatestGift>();

  constructor(private readonly sessions: LiveSessions, private readonly now = () => performance.now()) {}

  observeCompletedGift(event: GiftCompletedEvent): void {
    const { workspaceId, generation, connectionId, eventId, repeatCount } = event;
    if (!this.#isCurrentLive(workspaceId, generation, connectionId)) return;
    const previous = this.#latestGifts.get(workspaceId);
    if (previous?.connectionId === connectionId && previous.eventId === eventId) return;
    const giftName = event.giftName.trim();
    if (!giftName) return;
    this.#latestGifts.set(workspaceId, {
      eventId, connectionId, generation, giftName, quantity: repeatCount,
      expiresAt: this.now() + LAST_GIFT_OVERLAY_DURATION_MS,
    });
  }

  clearLastGift(workspaceId: string): void {
    this.#latestGifts.delete(workspaceId);
  }

  lastGiftSnapshot(workspaceId: string): LastGiftOverlaySnapshot | null {
    const gift = this.#latestGifts.get(workspaceId);
    if (!gift || !this.#isCurrentLive(workspaceId, gift.generation, gift.connectionId)) return null;
    const remainingMs = Math.ceil(gift.expiresAt - this.now());
    return remainingMs > 0 ? { giftName: gift.giftName, quantity: gift.quantity, remainingMs } : null;
  }

  likeGoalSnapshot(workspaceId: string): LikeGoalOverlaySnapshot | null {
    const activity = this.sessions.getLiveActivity(workspaceId);
    const { targetCount, baselineLikes } = activity.likeGoal;
    if (targetCount === null || baselineLikes === null || activity.totalLikes === null
      || !this.#isCurrentLive(workspaceId, activity.generation, activity.connectionId)) return null;
    return { progress: Math.max(0, activity.totalLikes - baselineLikes), targetCount };
  }

  pollSnapshot(workspaceId: string): LivePollOverlaySnapshot | null {
    const state = this.sessions.getLivePoll(workspaceId);
    if (!state.poll || !this.#isCurrentLive(workspaceId, state.generation, state.connectionId)) return null;
    const { question, status, options } = state.poll;
    return { question, status, options: options.map(({ label, votes }) => ({ label, votes })) };
  }

  #isCurrentLive(workspaceId: string, generation: number, connectionId: string | null): boolean {
    const current = this.sessions.status(workspaceId);
    return current.state === 'live' && Boolean(connectionId)
      && current.generation === generation && current.connectionId === connectionId;
  }
}
