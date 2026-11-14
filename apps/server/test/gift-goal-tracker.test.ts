import { describe, expect, it } from 'vitest';
import type { ConnectionStateEvent, GiftEvent, GiftGoalConfiguration } from '@tiktok-helper/contracts';
import { GiftGoalTracker } from '../src/gift-goals/tracker.js';

const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextConnectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const at = '2026-11-14T19:30:00.000Z';
const goal: GiftGoalConfiguration = {
  giftId: 'rose', targetCount: 3, soundAssetId: '11111111-1111-4111-8111-111111111111', isEnabled: true, revision: 1,
};

function connection(state: ConnectionStateEvent['state'], options: Partial<ConnectionStateEvent> = {}): ConnectionStateEvent {
  return { type: 'connection.state', generation: 1, sequence: 2, connectionId, state, ...options };
}

function gift(sequence: number, options: Partial<GiftEvent> = {}): GiftEvent {
  return {
    type: 'gift.received', generation: 1, sequence, eventId: `gift-${sequence}`,
    giftId: 'rose', giftName: 'Rose', senderDisplayName: 'Зритель', senderUsername: 'viewer', repeatCount: 1,
    diamondCount: 10, ...options,
  };
}

describe('gift goal tracker', () => {
  it('starts on the first live connection and crosses the target once using accepted quantities', () => {
    const tracker = new GiftGoalTracker(() => Date.parse(at));
    expect(tracker.snapshot('family')).toMatchObject({ connectionId: null, configuration: null, progress: 0, startedAt: null });
    expect(tracker.hasWorkspace('family')).toBe(false);
    expect(tracker.trackConnection('family', connection('stopped', { connectionId: undefined, generation: 0, sequence: 0 }))).toBe(false);
    expect(tracker.hasWorkspace('family')).toBe(true);
    expect(tracker.setConfiguration('family', goal)).toBe(true);
    tracker.trackConnection('family', connection('connecting', { sequence: 1 }));
    expect(tracker.observe('family', connectionId, gift(2), 'private-donor').changed).toBe(false);
    expect(tracker.snapshot('family')).toMatchObject({ startedAt: null, goalStartedAt: null });

    tracker.trackConnection('family', connection('live'));
    expect(tracker.observe('family', connectionId, gift(3), 'private-donor')).toEqual({ changed: true, reached: false });
    const jump = gift(4, { repeatCount: 4, diamondCount: undefined });
    expect(tracker.observe('family', connectionId, jump, 'private-donor')).toEqual({ changed: true, reached: true });
    expect(tracker.observe('family', connectionId, jump, 'private-donor')).toEqual({ changed: false, reached: false });
    expect(tracker.observe('family', connectionId, gift(5), 'private-donor').reached).toBe(false);
    const snapshot = tracker.snapshot('family');
    expect(snapshot).toMatchObject({ startedAt: at, goalStartedAt: at, progress: 6, topDonors: [{ displayName: 'Зритель', points: 20 }] });
    expect(JSON.stringify(snapshot)).not.toContain('private-donor');
  });

  it('preserves statistics across reconnects and counts a delayed acceptance silently before reconnect completes', () => {
    const tracker = new GiftGoalTracker(() => Date.parse(at));
    tracker.setConfiguration('family', goal);
    tracker.trackConnection('family', connection('live'));
    tracker.observe('family', connectionId, gift(3), 'one');
    tracker.trackConnection('family', connection('reconnecting', { sequence: 4 }));
    expect(tracker.observe('family', connectionId, gift(5, { historical: true, repeatCount: 2 }), 'one'))
      .toEqual({ changed: true, reached: false });
    tracker.trackConnection('family', connection('live', { sequence: 6 }));
    expect(tracker.observe('family', connectionId, gift(7), 'one').reached).toBe(false);
    tracker.trackConnection('family', connection('stopped', { sequence: 8 }));
    expect(tracker.observe('family', connectionId, gift(9), 'one').changed).toBe(false);
    expect(tracker.snapshot('family')).toMatchObject({ progress: 4, connectionId, startedAt: at });
  });

  it('retains configuration across a room change and isolates stale events and different workspaces', () => {
    const tracker = new GiftGoalTracker();
    tracker.setConfiguration('family', goal);
    tracker.trackConnection('family', connection('live'));
    tracker.trackConnection('another', connection('live'));
    tracker.observe('family', connectionId, gift(3, { repeatCount: 4 }), 'one');
    tracker.observe('another', connectionId, gift(3, { giftId: 'car', repeatCount: 3 }), 'one');
    tracker.trackConnection('family', connection('connecting', { generation: 2, connectionId: nextConnectionId, sequence: 1 }));
    tracker.trackConnection('family', connection('live', { generation: 2, connectionId: nextConnectionId }));
    expect(tracker.trackConnection('family', connection('live', { sequence: 8 }))).toBe(false);
    expect(tracker.observe('family', connectionId, gift(3, { generation: 2 }), 'one').changed).toBe(false);
    expect(tracker.snapshot('family')).toMatchObject({
      generation: 2, connectionId: nextConnectionId, configuration: goal, progress: 0, lastDonor: null, topDonors: [],
    });
    expect(tracker.snapshot('another')).toMatchObject({ connectionId, progress: 0, lastDonor: { giftId: 'car' }, topDonors: [{ points: 30 }] });
  });

  it('pauses and resumes the count, handles sound-only updates and restarts the changed target', () => {
    let time = Date.parse(at);
    const tracker = new GiftGoalTracker(() => time);
    tracker.setConfiguration('family', goal);
    tracker.trackConnection('family', connection('live'));
    tracker.observe('family', connectionId, gift(3), 'one');
    tracker.setConfiguration('family', { ...goal, isEnabled: false, revision: 2 });
    tracker.observe('family', connectionId, gift(4, { repeatCount: 5 }), 'one');
    expect(tracker.snapshot('family')).toMatchObject({ progress: 1, lastDonor: { quantity: 5 }, topDonors: [{ points: 60 }] });
    tracker.setConfiguration('family', { ...goal, revision: 3 });
    tracker.setConfiguration('family', { ...goal, revision: 3, soundAssetId: null });
    expect(tracker.setConfiguration('family', { ...goal, revision: 3 })).toBe(false);
    expect(tracker.setConfiguration('family', { ...goal, revision: 2 })).toBe(false);
    expect(tracker.setConfiguration('family', null)).toBe(false);
    expect(tracker.snapshot('family')).toMatchObject({ progress: 1, goalStartedAt: at, configuration: { soundAssetId: null } });
    time += 1_000;
    tracker.setConfiguration('family', { ...goal, revision: 4, targetCount: 2 });
    expect(tracker.snapshot('family')).toMatchObject({
      progress: 0, startedAt: at, goalStartedAt: '2026-11-14T19:30:01.000Z', topDonors: [{ points: 60 }],
    });
    expect(tracker.observe('family', connectionId, gift(5, { repeatCount: 2 }), 'one').reached).toBe(true);
  });

  it('shows a bounded top five across all gifts and merges one donor by the private identity', () => {
    const tracker = new GiftGoalTracker(undefined, 6);
    tracker.trackConnection('family', connection('live'));
    for (let i = 1; i <= 6; i++) {
      tracker.observe('family', connectionId, gift(2 + i, { giftId: 'car', senderDisplayName: `Даритель ${i}`, diamondCount: i }), `donor-${i}`);
    }
    expect(tracker.snapshot('family').topDonors.map(({ points }) => points)).toEqual([6, 5, 4, 3, 2]);
    tracker.observe('family', connectionId, gift(9, { diamondCount: 10, senderDisplayName: 'Новое имя' }), 'donor-1');
    tracker.observe('family', connectionId, gift(10, { diamondCount: 20, senderDisplayName: 'Последний даритель' }), 'new-donor');
    expect(tracker.snapshot('family')).toMatchObject({
      rankingLimited: true, lastDonor: { displayName: 'Последний даритель' },
      topDonors: [{ displayName: 'Новое имя', points: 11 }, { points: 6 }, { points: 5 }, { points: 4 }, { points: 3 }],
    });
  });
});
