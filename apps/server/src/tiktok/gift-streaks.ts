import type { NormalizedGift } from './normalizer.js';

interface StreakProgress {
  highestCount: number;
  completed: boolean;
}

interface GroupedStreak extends StreakProgress {
  // Null records conflicting prices. Only use an unambiguous price when the final packet omits it.
  diamondCount?: number | null;
}

interface UngroupedStreak extends StreakProgress {
  hasLivePacket: boolean;
  beganAt?: number;
  latestAt?: number;
}

interface GiftStreakUpdate {
  increment: number;
  completion?: Pick<NormalizedGift, 'repeatCount' | 'diamondCount'>;
}

/** Tracks gift increments and first completions for one TikTok room. */
export class GiftStreakTracker {
  readonly #groups = new Map<string, GroupedStreak>();
  readonly #historicalCounts = new Map<string, number>();
  readonly #ungrouped = new Map<string, UngroupedStreak>();
  readonly #seenPackets = new Map<string, UngroupedStreak | null>();

  constructor(private readonly capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer');
  }

  apply(gift: NormalizedGift, historical: boolean): GiftStreakUpdate {
    if (!gift.streakable) {
      const packetKey = `gift:${gift.eventId}`;
      if (this.#seenPackets.has(packetKey)) return { increment: 0 };
      this.#remember(this.#seenPackets, packetKey, null);
      return historical ? { increment: 0 } : {
        increment: gift.repeatCount,
        completion: { repeatCount: gift.repeatCount, diamondCount: gift.diamondCount },
      };
    }

    const participantGift = [gift.senderIdentityKey, gift.giftId];
    if (!gift.groupId) return this.#applyUngrouped(gift, historical, JSON.stringify(participantGift));

    const groupKey = this.#groupKey(gift);
    if (historical && gift.repeatCount > (this.#historicalCounts.get(groupKey) ?? 0)) {
      this.#remember(this.#historicalCounts, groupKey, gift.repeatCount);
    }
    const streak = this.#groups.get(groupKey) ?? { highestCount: 0, completed: false };
    const increment = Math.max(0, gift.repeatCount - streak.highestCount);
    const finishes = !streak.completed && gift.repeatEnd;
    // Retain the high-water mark after repeatEnd. A resend can carry a different msgId.
    const observedPrice = gift.diamondCount;
    const previousPrice = streak.diamondCount;
    if (observedPrice !== undefined && observedPrice !== previousPrice) {
      streak.diamondCount = previousPrice === undefined ? observedPrice : null;
    }
    if (increment > 0 || finishes || streak.diamondCount !== previousPrice) {
      streak.highestCount += increment;
      streak.completed ||= finishes;
      this.#remember(this.#groups, groupKey, streak);
    }
    if (historical) return { increment: 0 };
    return finishes ? {
      increment,
      completion: { repeatCount: streak.highestCount, diamondCount: gift.diamondCount ?? streak.diamondCount ?? undefined },
    } : { increment };
  }

  historicalCount(gift: NormalizedGift): number {
    return this.#historicalCounts.get(this.#groupKey(gift)) ?? 0;
  }

  #groupKey(gift: NormalizedGift): string {
    return JSON.stringify([gift.senderIdentityKey, gift.giftId, gift.groupId]);
  }

  #applyUngrouped(gift: NormalizedGift, historical: boolean, participantGift: string): GiftStreakUpdate {
    const packetKey = `streak:${JSON.stringify([participantGift, gift.eventId])}`;
    const tracked = this.#ungrouped.get(participantGift);
    const seenIn = this.#seenPackets.get(packetKey);
    if (seenIn !== undefined && seenIn !== tracked) return { increment: 0 };

    const timestamp = gift.occurredAt;
    if (timestamp !== undefined && tracked?.beganAt !== undefined && timestamp < tracked.beganAt) {
      if (!seenIn) this.#remember(this.#seenPackets, packetKey, null);
      return { increment: 0 };
    }
    if (historical && tracked?.hasLivePacket && !seenIn && (timestamp === undefined || tracked.beganAt === undefined)) {
      // An unidentifiable recovery packet could belong to a previous streak.
      this.#remember(this.#seenPackets, packetKey, null);
      return { increment: 0 };
    }

    const orderedAfterLast = timestamp !== undefined && tracked?.latestAt !== undefined
      ? timestamp - tracked.latestAt : undefined;
    const startsNext = tracked?.completed && !seenIn && !gift.repeatEnd && gift.repeatCount === 1
      && (historical ? (orderedAfterLast ?? 0) > 0 : (orderedAfterLast ?? 0) >= 0);
    const streak: UngroupedStreak = !tracked || startsNext
      ? { highestCount: 0, completed: false, hasLivePacket: false, beganAt: timestamp }
      : tracked;
    if (!seenIn) this.#remember(this.#seenPackets, packetKey, streak);
    streak.hasLivePacket ||= !historical;

    const increment = Math.max(0, gift.repeatCount - streak.highestCount);
    const finishes = !streak.completed && gift.repeatEnd
      && (gift.repeatCount >= streak.highestCount || (orderedAfterLast ?? 0) > 0);
    if (increment > 0 || finishes) {
      streak.highestCount += increment;
      streak.completed ||= finishes;
      if (timestamp !== undefined) streak.latestAt = Math.max(streak.latestAt ?? timestamp, timestamp);
      this.#remember(this.#ungrouped, participantGift, streak);
    }
    if (historical) return { increment: 0 };
    return finishes ? {
      increment, completion: { repeatCount: streak.highestCount, diamondCount: gift.diamondCount },
    } : { increment };
  }

  #remember<Value>(items: Map<string, Value>, key: string, value: Value): void {
    items.delete(key);
    items.set(key, value);
    if (items.size > this.capacity) {
      const oldest = items.keys().next().value;
      if (oldest !== undefined) items.delete(oldest);
    }
  }
}
