import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ClientToServerEvents, CommandAcknowledgement, GiftEvent, GiftGoalState, LiveActivityState, LivePollState, RealtimeSnapshot, ServerToClientEvents, SupportLevelGrantedEvent } from '@tiktok-helper/contracts';
import type { Socket } from 'socket.io-client';
import { createRealtimeClient, RealtimeStateModel } from './client.js';

const snapshot = (overrides: Partial<RealtimeSnapshot> = {}): RealtimeSnapshot => ({
  workspaceId: 'primary', generation: 2, lastSequence: 3, connectionState: 'live',
  replay: [], requiresFullRefresh: false, ...overrides,
});

const gift = (sequence: number, generation = 2): GiftEvent => ({
  type: 'gift.received', generation, sequence, eventId: `gift-${generation}-${sequence}`,
  giftId: 'sample-rose', giftName: 'Rose', senderUsername: 'sample_viewer', senderDisplayName: 'Зритель', repeatCount: 1,
});

const goalConnection = '123e4567-e89b-42d3-a456-426614174000';
const goal = (revision: number, progress: number): GiftGoalState => ({
  workspaceId: 'primary', generation: 2, connectionId: goalConnection, revision, progress,
  startedAt: '2026-09-17T12:00:00.000Z', goalStartedAt: '2026-09-17T12:00:00.000Z',
  configuration: { giftId: 'rose', targetCount: 2, soundAssetId: null, isEnabled: true, revision: 1 },
  lastDonor: null, topDonors: [],
});

const activity = (revision: number, totalLikes: number): LiveActivityState => ({
  workspaceId: 'primary', generation: 2, connectionId: goalConnection, revision, viewers: 81, totalLikes,
  likeGoal: { targetCount: 25, revision: 1, baselineLikes: 120 }, recentActions: [],
});

const livePoll = (revision: number, votes: number): LivePollState => ({
  workspaceId: 'primary', generation: 2, connectionId: goalConnection, revision,
  poll: {
    id: 'abcdef01-abcd-4abc-8abc-abcdef012345', question: 'Что включить?',
    options: [{ label: 'Музыку', votes }, { label: 'Игру', votes: 0 }], status: 'open',
  },
});

function fakeSocket() {
  type Events = ServerToClientEvents & {
    connect: () => void;
    disconnect: (reason: string) => void;
  };
  const handlers = new Map<keyof Events, (...args: never[]) => void>();
  const subscriptions: Array<Parameters<ClientToServerEvents['workspace:subscribe']>[0]> = [];
  const subscriptionAcks: Array<(result: CommandAcknowledgement) => void> = [];
  let beforeLiveConnectAck: (() => void) | undefined;
  const socket = {
    on(eventName: keyof Events, handler: (...args: never[]) => void) { handlers.set(eventName, handler); return this; },
    emit(eventName: keyof ClientToServerEvents, payload: (typeof subscriptions)[number], acknowledge: (result: CommandAcknowledgement) => void) {
      if (eventName === 'workspace:subscribe') {
        subscriptions.push(payload);
        subscriptionAcks.push(acknowledge);
      } else {
        if (eventName === 'live:connect') beforeLiveConnectAck?.();
        acknowledge({ ok: true });
      }
      return this;
    },
    close: vi.fn(),
  } as unknown as Socket<ServerToClientEvents, ClientToServerEvents>;
  return {
    socket, subscriptions,
    receive<Key extends keyof Events>(name: Key, ...args: Parameters<Events[Key]>) {
      handlers.get(name)?.(...args as never[]);
    },
    beforeLiveConnectAck(callback: () => void) { beforeLiveConnectAck = callback; },
    acknowledgeSubscription() { subscriptionAcks.shift()?.({ ok: true }); },
  };
}

describe('RealtimeStateModel', () => {
  it('tracks authenticated presence and clears a stale count on disconnect', () => {
    const model = new RealtimeStateModel();
    model.setTransportConnected(true);
    model.setOnlineUsers(3);
    expect(model.state.onlineUsers).toBe(3);
    model.setTransportConnected(false);
    expect(model.state.onlineUsers).toBeNull();
  });

  it('waits for a new connection state after a transport reconnect or gap', () => {
    const model = new RealtimeStateModel();
    model.setTransportConnected(true);
    expect(model.state.hasCurrentSnapshot).toBe(false);
    model.applySnapshot(snapshot());
    expect(model.state.hasCurrentSnapshot).toBe(true);
    model.setTransportConnected(false);
    model.setTransportConnected(true);
    expect(model.state.hasCurrentSnapshot).toBe(false);
    model.applySnapshot(snapshot());
    model.applyEvent({ type: 'connection.state', generation: 2, sequence: 5, state: 'connecting' });
    expect(model.state.hasCurrentSnapshot).toBe(false);
  });

  it('requires a snapshot before applying deltas and then accepts the next sequence', () => {
    const model = new RealtimeStateModel();
    expect(model.applyEvent({ type: 'connection.state', generation: 2, sequence: 4, state: 'live' })).toBe('ignored');
    model.applySnapshot(snapshot());
    expect(model.state.lastSequence).toBe(4);
  });

  it('rejects stale generations and requests resync for gaps', () => {
    const model = new RealtimeStateModel();
    model.applySnapshot(snapshot());
    expect(model.applyEvent({ type: 'connection.state', generation: 1, sequence: 4, state: 'failed' })).toBe('ignored');
    expect(model.applyEvent({ type: 'connection.state', generation: 2, sequence: 5, state: 'failed' })).toBe('resync');
  });

  it('starts a new generation from the first delta instead of comparing it to the previous sequence', () => {
    const model = new RealtimeStateModel();
    model.applySnapshot(snapshot({ generation: 5, lastSequence: 400, connectionState: 'stopped' }));
    const first = { type: 'connection.state', generation: 6, sequence: 1, state: 'connecting' } as const;
    expect(model.applyEvent(first)).toBe('applied');
    expect(model.state).toMatchObject({ generation: 6, lastSequence: 1, hasCurrentSnapshot: true, events: [first] });
  });

  it('requests a snapshot when the beginning of a new generation is missing', () => {
    const model = new RealtimeStateModel();
    model.applySnapshot(snapshot({ generation: 5, lastSequence: 400, connectionState: 'stopped' }));
    expect(model.applyEvent(gift(2, 6))).toBe('resync');
    expect(model.state.hasCurrentSnapshot).toBe(false);
  });

  it('bounds the visible event history', () => {
    const model = new RealtimeStateModel(2);
    model.applySnapshot(snapshot({ lastSequence: 0 }));
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      model.applyEvent({ type: 'connection.state', generation: 2, sequence, state: 'live' });
    }
    expect(model.state.events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it('drops retained history when the server cannot fill the gap', () => {
    const model = new RealtimeStateModel();
    model.applySnapshot(snapshot({ lastSequence: 0 }));
    model.applyEvent({ type: 'connection.state', generation: 2, sequence: 1, state: 'live' });
    model.applySnapshot(snapshot({ generation: 3, lastSequence: 9, requiresFullRefresh: true }));
    expect(model.state.events).toEqual([]);
  });

  it('deduplicates overlapping snapshots and ignores stale state on the same transport', () => {
    const model = new RealtimeStateModel();
    model.applySnapshot(snapshot({ replay: [gift(3)] }));
    model.applyEvent(gift(4));
    expect(model.applySnapshot(snapshot({ lastSequence: 5, replay: [gift(3), gift(4), gift(5)] }))).toBe('applied');
    expect(model.applySnapshot(snapshot({ lastSequence: 5, connectionState: 'stopped' }))).toBe('ignored');
    expect(model.applySnapshot(snapshot({ lastSequence: 4, connectionState: 'stopped' }))).toBe('ignored');
    expect(model.applySnapshot(snapshot({ generation: 1, lastSequence: 8 }))).toBe('ignored');
    expect(model.state).toMatchObject({ lastSequence: 5, connectionState: 'live', events: [gift(3), gift(4), gift(5)] });
  });

  it.each([
    { generation: 0, latest: 0, replay: [] },
    { generation: 2, latest: 1, replay: [gift(1)] },
  ])('accepts a reset cursor on a new transport ($generation, $latest)', ({ generation, latest, replay }) => {
    const model = new RealtimeStateModel();
    model.setTransportConnected(true);
    model.applySnapshot(snapshot({ replay: [gift(3)] }));
    model.setTransportConnected(false);
    model.setTransportConnected(true);
    expect(model.applySnapshot(snapshot({ generation, lastSequence: latest, replay, requiresFullRefresh: true }))).toBe('applied');
    expect(model.state).toMatchObject({ generation, lastSequence: latest, events: replay, hasCurrentSnapshot: true });
  });

  it('replaces old history on reconnect when the stream changes even at the same cursor', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    const onLiveEvent = vi.fn();
    createRealtimeClient('primary', onState, transport.socket, undefined, undefined, undefined, onLiveEvent);
    const firstConnectionId = '123e4567-e89b-42d3-a456-426614174000';
    const secondConnectionId = '123e4567-e89b-42d3-a456-426614174001';
    const receivedAfterRestart = { ...gift(3), eventId: 'gift-from-restarted-server' };
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ generation: 0, lastSequence: 0 }));
    transport.acknowledgeSubscription();
    transport.receive('event', { type: 'connection.state', generation: 2, sequence: 1, state: 'connecting', connectionId: firstConnectionId });
    transport.receive('event', gift(2));
    transport.receive('event', gift(3));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: firstConnectionId }));
    onLiveEvent.mockClear();
    transport.receive('disconnect', 'transport close');
    transport.receive('connect');
    expect(transport.subscriptions[1]).toMatchObject({ generation: 0, lastSequence: 0 });
    transport.receive('snapshot', { ...snapshot({ replay: [receivedAfterRestart] }), connectionId: secondConnectionId });
    transport.acknowledgeSubscription();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: secondConnectionId, events: [receivedAfterRestart] }));
    expect(onLiveEvent).not.toHaveBeenCalled();
  });
});

describe('realtime client commands', () => {
  it('resubscribes after a successful command when no new generation was received', async () => {
    const transport = fakeSocket();
    const client = createRealtimeClient('primary', () => undefined, transport.socket);
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ generation: 5, lastSequence: 400 }));
    transport.acknowledgeSubscription();
    await client.connectLive('streamer');
    expect(transport.subscriptions).toHaveLength(2);
    expect(transport.subscriptions[1]).toMatchObject({ generation: 5, lastSequence: 400 });
  });

  it('delivers the first live gift of the next generation without resubscribing', async () => {
    const transport = fakeSocket();
    const first = { type: 'connection.state', generation: 6, sequence: 1, state: 'connecting' } as const;
    const onState = vi.fn();
    const onLiveEvent = vi.fn();
    const client = createRealtimeClient('primary', onState, transport.socket, undefined, undefined, undefined, onLiveEvent);
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ generation: 5, lastSequence: 400 }));
    transport.acknowledgeSubscription();
    transport.beforeLiveConnectAck(() => {
      transport.receive('event', first);
      transport.receive('event', gift(2, 6));
      transport.receive('event', gift(2, 6));
    });
    await client.connectLive('streamer');
    expect(transport.subscriptions).toHaveLength(1);
    expect(onLiveEvent.mock.calls).toEqual([[first], [gift(2, 6)]]);
    expect(onState.mock.invocationCallOrder.at(-1)).toBeLessThan(onLiveEvent.mock.invocationCallOrder[1]!);
  });

  it('shows the initial and recovered packets while delivering effects only for accepted live deltas', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    const onLiveEvent = vi.fn();
    createRealtimeClient('primary', onState, transport.socket, undefined, undefined, undefined, onLiveEvent);
    const historical = {
      type: 'chat.message', generation: 2, sequence: 6, eventId: 'historical-chat', historical: true,
      senderDisplayName: 'Зритель', senderUsername: 'sample_viewer', text: 'Старая реплика',
    } satisfies ChatEvent;
    const delayedGift = { ...gift(5), historical: true } as const;
    transport.receive('connect');
    transport.receive('event', gift(4));
    transport.receive('snapshot', snapshot({ replay: [gift(3)] }));
    transport.receive('event', delayedGift);
    transport.receive('event', historical);
    transport.acknowledgeSubscription();
    expect(onLiveEvent).not.toHaveBeenCalled();
    transport.receive('event', gift(7));

    transport.receive('disconnect', 'transport close');
    transport.receive('connect');
    transport.receive('event', gift(9));
    transport.receive('snapshot', snapshot({ lastSequence: 8, replay: [gift(7), gift(8)] }));
    transport.acknowledgeSubscription();
    transport.receive('event', gift(10));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({
      events: [gift(3), gift(4), delayedGift, historical, gift(7), gift(8), gift(9), gift(10)],
    }));
    expect(onLiveEvent.mock.calls).toEqual([[gift(7)], [gift(10)]]);
  });

  it('uses one active subscription at a time and resumes effects after recovering a gap', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    const onLiveEvent = vi.fn();
    createRealtimeClient('primary', onState, transport.socket, undefined, undefined, undefined, onLiveEvent);
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ replay: [gift(3)] }));
    transport.receive('event', gift(7));
    transport.receive('event', gift(6));
    expect(transport.subscriptions).toHaveLength(1);
    transport.acknowledgeSubscription();
    expect(transport.subscriptions).toHaveLength(2);
    expect(transport.subscriptions[1]).toMatchObject({ generation: 2, lastSequence: 3 });
    transport.receive('snapshot', snapshot({ lastSequence: 5, replay: [gift(4), gift(5)] }));
    transport.acknowledgeSubscription();
    expect(onLiveEvent).not.toHaveBeenCalled();
    transport.receive('event', gift(8));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({
      lastSequence: 8, hasCurrentSnapshot: true, events: [3, 4, 5, 6, 7, 8].map((number) => gift(number)),
    }));
    expect(onLiveEvent).toHaveBeenCalledExactlyOnceWith(gift(8));
  });

  it('delivers support-level grants for the current workspace only after the snapshot', () => {
    const transport = fakeSocket();
    const onGrant = vi.fn();
    createRealtimeClient('primary', () => undefined, transport.socket, undefined, onGrant);
    const grant: SupportLevelGrantedEvent = {
      eventId: 'grant-1', workspaceId: 'primary', senderDisplayName: 'Viewer', senderUsername: 'viewer',
      levelId: '123e4567-e89b-42d3-a456-426614174000', levelName: 'Голос', thresholdPoints: 100,
      pointsAdded: 10, streamTotal: 100, lifetimeTotal: 100, expiresAt: null,
    };
    transport.receive('connect');
    transport.receive('support:level-granted', grant);
    transport.receive('snapshot', snapshot({ workspaceId: 'elsewhere' }));
    transport.receive('support:level-granted', grant);
    transport.receive('snapshot', snapshot());
    transport.acknowledgeSubscription();
    transport.receive('support:level-granted', { ...grant, workspaceId: 'elsewhere' });
    transport.receive('support:level-granted', grant);
    transport.receive('disconnect', 'transport close');
    transport.receive('support:level-granted', grant);
    expect(onGrant).toHaveBeenCalledExactlyOnceWith(grant);
  });

  it('forwards completion only for a valid event belonging to the current LIVE snapshot', () => {
    const transport = fakeSocket();
    const completed = vi.fn();
    const connectionId = '123e4567-e89b-42d3-a456-426614174000';
    const event = {
      eventId: 'gift-complete:one', workspaceId: 'primary', generation: 2, connectionId,
      giftId: '5655', giftName: 'Rose', repeatCount: 3, diamondCount: 100,
      senderDisplayName: 'Viewer', senderUsername: 'viewer',
    };
    createRealtimeClient('primary', () => undefined, transport.socket, undefined, undefined, undefined, undefined, completed);
    transport.receive('connect');
    transport.receive('gift:completed', event);
    transport.receive('snapshot', snapshot({ connectionId }));
    transport.acknowledgeSubscription();
    transport.receive('gift:completed', { ...event, workspaceId: 'another' });
    transport.receive('gift:completed', { ...event, generation: 1 });
    transport.receive('gift:completed', { ...event, connectionId: '123e4567-e89b-42d3-a456-426614174001' });
    transport.receive('gift:completed', { ...event, repeatCount: 0 });
    transport.receive('gift:completed', event);
    transport.receive('event', { type: 'connection.state', state: 'reconnecting', generation: 2, sequence: 4 });
    transport.receive('gift:completed', event);
    transport.receive('disconnect', 'transport close');
    transport.receive('gift:completed', event);
    expect(completed).toHaveBeenCalledExactlyOnceWith(event);
  });

  it('restores a goal silently and plays only an accepted live milestone edge', () => {
    const transport = fakeSocket();
    const reached = vi.fn();
    const onState = vi.fn();
    createRealtimeClient('primary', onState, transport.socket, undefined, undefined, undefined, undefined, undefined, reached);
    transport.receive('connect');
    transport.receive('gift-goal:update', { state: goal(2, 3), reached: true });
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, giftGoal: goal(1, 1) }));
    transport.acknowledgeSubscription();
    transport.receive('gift-goal:update', { state: { ...goal(9, 9), workspaceId: 'elsewhere' }, reached: true });
    transport.receive('gift-goal:update', { state: { ...goal(9, 9), connectionId: null }, reached: true });
    transport.receive('gift-goal:update', { state: { ...goal(9, 9), progress: -1 }, reached: true });
    expect(reached).not.toHaveBeenCalled();

    const crossing = { state: goal(2, 3), reached: true } as const;
    transport.receive('gift-goal:update', crossing);
    transport.receive('gift-goal:update', crossing);
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, giftGoal: goal(1, 1) }));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ giftGoal: goal(2, 3) }));
    expect(reached).toHaveBeenCalledExactlyOnceWith(crossing.state);

    transport.receive('disconnect', 'transport close');
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, giftGoal: goal(4, 5) }));
    transport.acknowledgeSubscription();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ giftGoal: goal(4, 5) }));
    expect(reached).toHaveBeenCalledTimes(1);

    transport.receive('event', { type: 'connection.state', generation: 3, sequence: 1, state: 'connecting', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ giftGoal: null }));
    transport.receive('gift-goal:update', crossing);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('accepts a newer goal snapshot independently of the feed cursor', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    const reached = vi.fn();
    const client = createRealtimeClient('primary', onState, transport.socket, undefined, undefined, undefined, undefined, undefined, reached);
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ connectionId: goalConnection }));
    transport.acknowledgeSubscription();
    client.refreshSnapshot();
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, giftGoal: goal(1, 1) }));
    transport.acknowledgeSubscription();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ giftGoal: goal(1, 1), lastSequence: 3 }));
    expect(reached).not.toHaveBeenCalled();
  });

  it('keeps the current activity snapshot across duplicate updates and transport recovery', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    createRealtimeClient('primary', onState, transport.socket);
    transport.receive('connect');
    transport.receive('live-activity:update', activity(5, 157));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ liveActivity: null }));
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, liveActivity: activity(1, 120) }));
    transport.acknowledgeSubscription();
    transport.receive('live-activity:update', { ...activity(9, 180), workspaceId: 'other' });
    transport.receive('live-activity:update', { ...activity(9, 180), connectionId: null });
    transport.receive('live-activity:update', { ...activity(9, 180), viewers: -1 });
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ liveActivity: activity(1, 120) }));
    transport.receive('live-activity:update', activity(5, 157));
    transport.receive('live-activity:update', activity(5, 156));
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, liveActivity: activity(2, 130) }));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ liveActivity: activity(5, 157) }));
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, liveActivity: activity(6, 166) }));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ liveActivity: activity(6, 166) }));

    transport.receive('disconnect', 'transport close');
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, liveActivity: activity(7, 176) }));
    transport.acknowledgeSubscription();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ liveActivity: activity(7, 176) }));
    transport.receive('event', { type: 'connection.state', generation: 3, sequence: 1, state: 'connecting', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    transport.receive('live-activity:update', activity(8, 200));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ liveActivity: null }));
  });

  it('keeps the latest poll through HTTP, realtime updates and a fresh snapshot', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    const client = createRealtimeClient('primary', onState, transport.socket);
    transport.receive('connect');
    transport.receive('live-poll:update', livePoll(1, 0));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ livePoll: null }));
    transport.receive('snapshot', snapshot({ connectionId: goalConnection }));
    transport.acknowledgeSubscription();
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, livePoll: livePoll(1, 0) }));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ livePoll: livePoll(1, 0), lastSequence: 3 }));

    transport.receive('live-poll:update', livePoll(3, 2));
    client.applyLivePoll(livePoll(2, 1));
    transport.receive('live-poll:update', { ...livePoll(4, 3), workspaceId: 'another' });
    transport.receive('live-poll:update', livePoll(5, 50_001));
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, livePoll: livePoll(2, 1) }));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ livePoll: livePoll(3, 2) }));

    transport.receive('disconnect', 'transport close');
    transport.receive('connect');
    transport.receive('snapshot', snapshot({ connectionId: goalConnection, livePoll: livePoll(6, 4) }));
    transport.acknowledgeSubscription();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ livePoll: livePoll(6, 4) }));

    transport.receive('event', { type: 'connection.state', generation: 3, sequence: 1, state: 'connecting', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    client.applyLivePoll(livePoll(7, 5));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ livePoll: null }));
  });

  it('accepts goals, activity and polls without a reaction callback', () => {
    const transport = fakeSocket();
    const onState = vi.fn();
    createRealtimeClient('primary', onState, transport.socket);
    transport.receive('connect');
    transport.receive('snapshot', snapshot({
      connectionId: goalConnection, giftGoal: goal(1, 1), liveActivity: activity(2, 120), livePoll: livePoll(1, 0),
    }));
    transport.acknowledgeSubscription();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({
      giftGoal: goal(1, 1), liveActivity: activity(2, 120), livePoll: livePoll(1, 0),
    }));
    transport.receive('gift-goal:update', { state: goal(2, 2), reached: true });
    transport.receive('live-activity:update', activity(3, 150));
    transport.receive('live-poll:update', livePoll(2, 1));
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({
      giftGoal: goal(2, 2), liveActivity: activity(3, 150), livePoll: livePoll(2, 1),
    }));
  });
});
