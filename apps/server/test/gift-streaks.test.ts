import { describe, expect, it } from 'vitest';
import { GiftStreakTracker } from '../src/tiktok/gift-streaks.js';
import type { NormalizedGift } from '../src/tiktok/normalizer.js';

const gift = (eventId: string, repeatCount: number, overrides: Partial<NormalizedGift> = {}): NormalizedGift => ({
  type: 'gift.received', generation: 1, sequence: 1, eventId,
  senderUsername: 'fixture_viewer', senderDisplayName: 'Fixture viewer', senderIdentityKey: 'fixture-sender',
  giftId: 'rose', giftName: 'Rose', repeatCount, repeatEnd: false, streakable: true,
  ...overrides,
});
const groupId = '7410000000000000001';

describe('gift streak tracker', () => {
  it('uses the maximum count across out-of-order updates and retains it after completion', () => {
    const tracker = new GiftStreakTracker();
    const updates = [
      gift('first', 1, { groupId, diamondCount: 5 }),
      gift('first', 3, { groupId }),
      gift('late', 2, { groupId }),
      gift('higher', 4, { groupId }),
      gift('end', 4, { groupId, repeatEnd: true }),
      gift('end-resent', 4, { groupId, repeatEnd: true }),
      gift('another-late', 3, { groupId }),
    ].map((event) => tracker.apply(event, false));

    expect(updates.map(({ increment }) => increment)).toEqual([1, 2, 0, 1, 0, 0, 0]);
    expect(updates.map(({ completion }) => completion)).toEqual([
      undefined, undefined, undefined, undefined, { repeatCount: 4, diamondCount: 5 }, undefined, undefined,
    ]);
  });

  it('keeps parallel streaks independent and preserves distinct 19-digit group IDs', () => {
    const tracker = new GiftStreakTracker();
    const otherGroup = '7410000000000000002';
    const updates = [
      gift('a1', 1, { groupId }),
      gift('b1', 2, { groupId: otherGroup }),
      gift('c1', 2, { groupId, senderIdentityKey: 'another-sender' }),
      gift('d1', 2, { groupId, giftId: 'star' }),
      gift('a2', 3, { groupId }),
      gift('b2', 3, { groupId: otherGroup, repeatEnd: true }),
      gift('a3', 3, { groupId, repeatEnd: true }),
    ].map((event) => tracker.apply(event, false));

    expect(updates.map(({ increment }) => increment)).toEqual([1, 2, 2, 2, 2, 1, 0]);
    expect(updates.map(({ completion }) => completion?.repeatCount)).toEqual([
      undefined, undefined, undefined, undefined, undefined, 3, 3,
    ]);
  });

  it('does not recount lower packets after a final packet arrives first', () => {
    const tracker = new GiftStreakTracker();
    const updates = [
      gift('end-first', 3, { groupId, repeatEnd: true }),
      gift('late-lower', 1, { groupId }),
      gift('late-higher', 4, { groupId }),
      gift('end-again', 4, { groupId, repeatEnd: true }),
    ].map((event) => tracker.apply(event, false));

    expect(updates.map(({ increment }) => increment)).toEqual([3, 0, 1, 0]);
    expect(updates.map(({ completion }) => completion?.repeatCount)).toEqual([3, undefined, undefined, undefined]);
  });

  it('uses historical counts only as a baseline and remembers historical single gifts', () => {
    const tracker = new GiftStreakTracker();
    const oldSingle = gift('old-single', 1, { streakable: false });

    expect(tracker.apply(oldSingle, true)).toEqual({ increment: 0 });
    expect(tracker.apply(oldSingle, false)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('new-single', 1, { streakable: false }), false)).toEqual({
      increment: 1, completion: { repeatCount: 1, diamondCount: undefined },
    });
    expect(tracker.apply(gift('history', 4, { groupId, diamondCount: 2 }), true)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('resend', 4, { groupId }), false)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('live', 5, { groupId, repeatEnd: true }), false)).toEqual({
      increment: 1, completion: { repeatCount: 5, diamondCount: 2 },
    });
  });

  it('latches historical finals and skips contradictory metadata on a final without its own price', () => {
    const tracker = new GiftStreakTracker();

    expect(tracker.apply(gift('old-final', 3, { groupId, repeatEnd: true }), true)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('old-final-resent', 3, { groupId, repeatEnd: true }), false)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('old-final-higher', 4, { groupId, repeatEnd: true }), false)).toEqual({ increment: 1 });
    tracker.apply(gift('first-price', 1, { groupId: '2', diamondCount: 5 }), false);
    tracker.apply(gift('other-price', 2, { groupId: '2', diamondCount: 7 }), false);
    expect(tracker.apply(gift('unknown-price', 2, { groupId: '2', repeatEnd: true }), false)).toEqual({
      increment: 0, completion: { repeatCount: 2, diamondCount: undefined },
    });
  });

  it('keeps the maximum fallback count and accepts another series after a fresh opening', () => {
    const tracker = new GiftStreakTracker();
    const first = gift('first', 1, { occurredAt: 10 });
    const counts = [
      first,
      gift('higher', 3, { occurredAt: 11 }),
      gift('out-of-order', 2, { occurredAt: 12 }),
      gift('higher-still', 4, { occurredAt: 13 }),
      gift('finish', 4, { occurredAt: 14, repeatEnd: true }),
      gift('finish-resent', 4, { occurredAt: 14, repeatEnd: true }),
      gift('late-higher-final', 5, { occurredAt: 15, repeatEnd: true }),
      gift('stale-open', 1, { occurredAt: 12 }),
      gift('new-open', 1, { occurredAt: 16 }),
      first,
      gift('new-next', 2, { occurredAt: 17 }),
    ].map((event) => tracker.apply(event, false).increment);

    expect(counts).toEqual([1, 2, 0, 1, 0, 0, 1, 0, 1, 0, 1]);
  });

  it('treats an ambiguous ungrouped final as a resend until a new opening arrives', () => {
    const tracker = new GiftStreakTracker();
    const updates = [
      gift('final-first', 1, { repeatEnd: true }),
      gift('same-final-new-id', 1, { repeatEnd: true }),
      gift('new-open', 1),
      gift('final-first', 1, { repeatEnd: true }),
      gift('new-count', 2),
    ].map((event) => tracker.apply(event, false));

    expect(updates.map(({ increment }) => increment)).toEqual([1, 0, 1, 0, 1]);
    expect(updates.map(({ completion }) => completion?.repeatCount)).toEqual([1, undefined, undefined, undefined, undefined]);
  });

  it('keeps historical fallback packets outside the current live series when ordering is unreliable', () => {
    const tracker = new GiftStreakTracker();

    expect(tracker.apply(gift('old-series', 3, { occurredAt: 10, repeatEnd: true }), true)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('new-series', 1, { occurredAt: 12 }), false)).toEqual({ increment: 1 });
    expect(tracker.apply(gift('late-old-series', 8, { occurredAt: 11, repeatEnd: true }), true)).toEqual({ increment: 0 });
    const unknownAge = gift('unknown-age', 9, { repeatEnd: true });
    expect(tracker.apply(unknownAge, true)).toEqual({ increment: 0 });
    expect(tracker.apply(unknownAge, false)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('recovery-current-series', 3, { occurredAt: 13 }), true)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('current-series-live', 4, { occurredAt: 14 }), false)).toEqual({ increment: 1 });
  });

  it('uses a later final timestamp to close a fallback streak without lowering its count', () => {
    const tracker = new GiftStreakTracker();
    expect(tracker.apply(gift('open', 1, { occurredAt: 10 }), false)).toEqual({ increment: 1 });
    expect(tracker.apply(gift('advance', 5, { occurredAt: 12 }), false)).toEqual({ increment: 4 });
    expect(tracker.apply(gift('old-finish', 3, { occurredAt: 11, repeatEnd: true }), false)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('not-a-new-streak', 1, { occurredAt: 13 }), false)).toEqual({ increment: 0 });
    expect(tracker.apply(gift('finish', 4, { occurredAt: 14, repeatEnd: true }), false)).toEqual({
      increment: 0, completion: { repeatCount: 5, diamondCount: undefined },
    });
    expect(tracker.apply(gift('new-streak', 1, { occurredAt: 15 }), false)).toEqual({ increment: 1 });
  });

  it('bounds each room tracker by evicting the oldest retained identities', () => {
    const tracker = new GiftStreakTracker(2);
    const single = gift('one', 1, { streakable: false });
    expect(tracker.apply(single, false).increment).toBe(1);
    expect(tracker.apply(gift('two', 1, { streakable: false }), false).increment).toBe(1);
    expect(tracker.apply(gift('three', 1, { streakable: false }), false).increment).toBe(1);
    expect(tracker.apply(single, false).increment).toBe(1);

    expect(tracker.apply(gift('group-one', 2, { groupId: '1' }), false).increment).toBe(2);
    expect(tracker.apply(gift('group-two', 2, { groupId: '2' }), false).increment).toBe(2);
    expect(tracker.apply(gift('group-three', 2, { groupId: '3' }), false).increment).toBe(2);
    expect(tracker.apply(gift('new-amount', 3, { groupId: '2' }), false).increment).toBe(1);
    expect(tracker.apply(gift('evicted-group', 3, { groupId: '1' }), false).increment).toBe(3);
  });
});
