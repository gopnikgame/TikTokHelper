import type { GiftCompletedEvent, LiveActivityState, LivePollState } from '@tiktok-helper/contracts';
import { describe, expect, it } from 'vitest';
import { StreamOverlayRuntime } from '../src/overlays/live-snapshots.js';
import type { LiveSessionSnapshot } from '../src/tiktok/types.js';

const workspaceId = 'primary';
const connectionId = '11111111-1111-4111-8111-111111111111';
const nextConnectionId = '22222222-2222-4222-8222-222222222222';
const liveStatus: LiveSessionSnapshot = {
  workspaceId, connectionId, generation: 2, state: 'live', lastSequence: 3, tiktokUsername: 'fixture',
};

describe('live overlay snapshots', () => {
  it('shows a completed gift once and expires it without extending the window for a duplicate', () => {
    let now = 0;
    let status = liveStatus;
    const runtime = new StreamOverlayRuntime({
      status: () => status,
      getLiveActivity: () => { throw new Error('not used'); },
      getLivePoll: () => { throw new Error('not used'); },
    }, () => now);
    const gift: GiftCompletedEvent = {
      workspaceId, connectionId, generation: 2, eventId: 'fixture-gift', giftId: 'rose', giftName: 'Rose',
      senderUsername: 'fixture-viewer', senderDisplayName: 'Fixture viewer', repeatCount: 3,
    };

    runtime.observeCompletedGift({ ...gift, generation: 1 });
    expect(runtime.lastGiftSnapshot(workspaceId)).toBeNull();
    runtime.observeCompletedGift(gift);
    expect(runtime.lastGiftSnapshot(workspaceId)).toEqual({ giftName: 'Rose', quantity: 3, remainingMs: 8_000 });
    expect(runtime.lastGiftSnapshot('secondary')).toBeNull();

    now = 4_000;
    runtime.observeCompletedGift(gift);
    expect(runtime.lastGiftSnapshot(workspaceId)?.remainingMs).toBe(4_000);
    now = 8_000;
    runtime.observeCompletedGift(gift);
    expect(runtime.lastGiftSnapshot(workspaceId)).toBeNull();

    runtime.observeCompletedGift({ ...gift, eventId: 'second-gift', repeatCount: 1 });
    expect(runtime.lastGiftSnapshot(workspaceId)?.quantity).toBe(1);
    status = { ...status, generation: 3, connectionId: nextConnectionId };
    expect(runtime.lastGiftSnapshot(workspaceId)).toBeNull();
  });

  it('projects only current-room like progress and poll results', () => {
    let status = liveStatus;
    let activity: LiveActivityState = {
      workspaceId, connectionId, generation: 2, revision: 1, viewers: 5, totalLikes: null,
      likeGoal: { revision: 1, targetCount: 100, baselineLikes: null }, recentActions: [],
    };
    let poll: LivePollState = { workspaceId, connectionId, generation: 2, revision: 1, poll: null };
    const runtime = new StreamOverlayRuntime({
      status: () => status, getLiveActivity: () => activity, getLivePoll: () => poll,
    });

    expect(runtime.likeGoalSnapshot(workspaceId)).toBeNull();
    expect(runtime.pollSnapshot(workspaceId)).toBeNull();
    activity = { ...activity, totalLikes: 180, likeGoal: { ...activity.likeGoal, baselineLikes: 120 } };
    expect(runtime.likeGoalSnapshot(workspaceId)).toEqual({ progress: 60, targetCount: 100 });

    const options = [{ label: 'Rose', votes: 1 }, { label: 'Coffee', votes: 2 }];
    poll = { ...poll, poll: { id: 'fixture-poll', question: 'Which gift?', status: 'closed', options } };
    expect(runtime.pollSnapshot(workspaceId)).toEqual({ question: 'Which gift?', status: 'closed', options });

    status = { ...status, state: 'reconnecting' };
    expect(runtime.likeGoalSnapshot(workspaceId)).toBeNull();
    expect(runtime.pollSnapshot(workspaceId)).toBeNull();
    status = { ...status, state: 'live', connectionId: nextConnectionId };
    expect(runtime.likeGoalSnapshot(workspaceId)).toBeNull();
    expect(runtime.pollSnapshot(workspaceId)).toBeNull();
  });
});
