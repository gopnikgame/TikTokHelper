import { LIVE_ACTIVITY_RECENT_LIMIT } from '@tiktok-helper/contracts';
import { describe, expect, it } from 'vitest';
import { LiveActivity, normalizeLiveActivity } from '../src/tiktok/live-activity.js';
import type { LiveActivityEvent } from '../src/tiktok/types.js';

function accept(activity: LiveActivity, kind: LiveActivityEvent, raw: unknown, historical = false): boolean {
  const sample = normalizeLiveActivity(kind, raw, historical);
  return sample ? activity.apply(sample) : false;
}

describe('TikTok live activity', () => {
  it.each([true, null, '', ' ', [], '19.1', -1, '5e1', Infinity, NaN, '9007199254740992'])('rejects malformed counter %j', (total) => {
    expect(normalizeLiveActivity('like', { total, count: 25 }, false)).toBeUndefined();
    expect(normalizeLiveActivity('roomUser', { total, totalUser: '341', popularity: '999' }, false)).toBeUndefined();
  });

  it('measures a like goal from the first reliable room total and retains the high-water mark', () => {
    const activity = new LiveActivity({ targetCount: 100, revision: 1 });
    expect(accept(activity, 'like', { total: '8000' }, true)).toBe(false);
    expect(accept(activity, 'like', { total: '0', count: 20 })).toBe(false);
    expect(activity.snapshot('primary', 1, null).likeGoal.baselineLikes).toBeNull();
    expect(accept(activity, 'like', { total: '1000', count: 20 })).toBe(true);
    expect(accept(activity, 'like', { total: '1125', count: 20 })).toBe(true);
    const steady = activity.snapshot('primary', 1, null);
    expect(accept(activity, 'like', { total: '1125' })).toBe(false);
    expect(accept(activity, 'like', { total: '1100' })).toBe(false);
    expect(activity.snapshot('primary', 1, null)).toEqual(steady);
    expect(steady).toMatchObject({ totalLikes: 1125, likeGoal: { targetCount: 100, baselineLikes: 1000, revision: 1 } });

    activity.configure({ targetCount: 600, revision: 2 });
    expect(activity.snapshot('primary', 1, null).likeGoal).toEqual({ targetCount: 600, baselineLikes: 1125, revision: 2 });
    activity.configure({ targetCount: null, revision: 3 });
    expect(activity.snapshot('primary', 1, null).likeGoal).toEqual({ targetCount: null, baselineLikes: null, revision: 3 });
  });

  it('keeps the latest viewers, including zero, and marks them unknown while offline', () => {
    const activity = new LiveActivity();
    expect(accept(activity, 'roomUser', { viewerCount: 8 })).toBe(true);
    expect(accept(activity, 'roomUser', { total: '12' })).toBe(true);
    expect(accept(activity, 'roomUser', { total: '0' })).toBe(false);
    expect(accept(activity, 'roomUser', { total: '0', common: { roomId: '11' } })).toBe(true);
    expect(accept(activity, 'roomUser', { total: '49' }, true)).toBe(false);
    expect(activity.snapshot('primary', 1, null).viewers).toBe(0);
    activity.connectionChanged(false);
    expect(activity.snapshot('primary', 1, null).viewers).toBeNull();
  });

  it('deduplicates historical and current social events before projecting safe names', () => {
    const activity = new LiveActivity();
    const common = { msgId: '31', createTime: '1710000000', roomId: '41' };
    const user = { id: '32', displayId: 'fixture_private_username', nickname: `\u202e\u0000${'🧪'.repeat(70)}\t ` };
    const historical = normalizeLiveActivity('follow', { common, user }, true);
    expect(historical).toMatchObject({ roomId: '41', event: { displayName: null } });
    expect(accept(activity, 'follow', { common, user }, true)).toBe(false);
    expect(accept(activity, 'follow', { common, user })).toBe(false);
    expect(accept(activity, 'share', { common, user })).toBe(true);
    const fallback = { common: { createTime: '1710000000' }, user: { ...user, nickname: 777 } };
    expect(accept(activity, 'share', fallback)).toBe(true);
    expect(accept(activity, 'share', { ...fallback, user: { ...user, nickname: 'Another name' } })).toBe(false);
    expect(accept(activity, 'share', { user })).toBe(false);
    expect(accept(activity, 'follow', { common: { msgId: '33' } })).toBe(true);
    expect(activity.snapshot('primary', 1, null).recentActions).toEqual([
      { kind: 'follow', displayName: null }, { kind: 'share', displayName: null }, { kind: 'share', displayName: '🧪'.repeat(60) },
    ]);
  });

  it('keeps the newest actions and returns a copy of each projection', () => {
    const activity = new LiveActivity();
    for (let index = 1; index <= LIVE_ACTIVITY_RECENT_LIMIT + 6; index++) {
      accept(activity, 'follow', { common: { msgId: String(index) }, user: { nickname: `Зритель ${index}` } });
    }
    const first = activity.snapshot('primary', 1, null);
    expect(first.recentActions).toHaveLength(LIVE_ACTIVITY_RECENT_LIMIT);
    expect(first.recentActions[0]?.displayName).toBe(`Зритель ${LIVE_ACTIVITY_RECENT_LIMIT + 6}`);
    first.recentActions[0]!.displayName = 'Edited copy';
    first.likeGoal.targetCount = 123;
    const second = activity.snapshot('primary', 1, null);
    expect(second.recentActions[0]?.displayName).toBe(`Зритель ${LIVE_ACTIVITY_RECENT_LIMIT + 6}`);
    expect(second.likeGoal.targetCount).toBeNull();
  });
});
