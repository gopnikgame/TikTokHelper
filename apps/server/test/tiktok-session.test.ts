import { describe, expect, it, vi } from 'vitest';
import { isGiftCompletedEvent, type RealtimeEvent } from '@tiktok-helper/contracts';
import { TikTokSessionManager, type Scheduler } from '../src/tiktok/session-manager.js';
import type { ConnectorEventMap, LiveConnector } from '../src/tiktok/types.js';

class FakeConnector implements LiveConnector {
  readonly handlers = new Map<keyof ConnectorEventMap, Array<(event: never, historical?: boolean) => void>>();
  connect = vi.fn<() => Promise<string | undefined>>(async () => undefined);
  disconnect = vi.fn(async () => undefined);
  on<EventName extends keyof ConnectorEventMap>(eventName: EventName, handler: (event: ConnectorEventMap[EventName], historical?: boolean) => void): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler as (event: never, historical?: boolean) => void);
    this.handlers.set(eventName, handlers);
  }
  emit<EventName extends keyof ConnectorEventMap>(eventName: EventName, event: ConnectorEventMap[EventName], historical?: boolean): void {
    for (const handler of this.handlers.get(eventName) ?? []) handler(event as never, historical);
  }
  removeAllListeners(): void { this.handlers.clear(); }
}

class FakeScheduler implements Scheduler {
  callbacks: Array<() => void> = [];
  set(_delayMs: number, callback: () => void): unknown { this.callbacks.push(callback); return callback; }
  clear(handle: unknown): void { this.callbacks = this.callbacks.filter((callback) => callback !== handle); }
  runNext(): void { this.callbacks.shift()?.(); }
}

const chat = { common: { msgId: 'chat-1' }, user: { uniqueId: 'viewer', nickname: 'Зритель' }, comment: 'Привет!' };
const gift = (repeatCount: number, repeatEnd: boolean, msgId: string) => ({
  common: { msgId }, user: { uniqueId: 'viewer', nickname: 'Зритель' }, giftId: 'rose', repeatCount,
  repeatEnd, giftDetails: { giftType: 1, giftName: 'Rose' },
});

describe('TikTok session manager', () => {
  it('keeps live activity out of the chat and gift cursor, and isolates rooms, workspaces and reconnects', async () => {
    const connectors = ['11', '22', '11', '33'].map((roomId) => {
      const connector = new FakeConnector();
      connector.connect.mockResolvedValue(roomId);
      return connector;
    });
    const [first, other, resumed, changed] = connectors as [FakeConnector, FakeConnector, FakeConnector, FakeConnector];
    const scheduler = new FakeScheduler();
    const sink = vi.fn();
    const diagnostics = vi.fn();
    const activity = vi.fn().mockImplementationOnce(() => { throw new Error('Fixture activity observer failure'); });
    const manager = new TikTokSessionManager(() => connectors.shift()!, sink, scheduler, diagnostics,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, activity);
    expect(manager.getLiveActivity('family')).toMatchObject({
      generation: 0, connectionId: null, likeGoal: { targetCount: null, baselineLikes: null, revision: 0 },
    });
    manager.setLikeGoal('family', { targetCount: 100, revision: 1 });
    const initial = await manager.start('family', 'streamer');
    await manager.start('other', 'another_streamer');
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith({ event: 'live_activity_observer_failed', errorName: 'Error' });
    first.emit('roomUser', { total: '12', common: { roomId: '11' } });
    first.emit('like', { total: '500' });
    first.emit('like', { total: '635' });
    first.emit('share', { common: { msgId: '31' }, user: { nickname: 'Зритель' } });
    first.emit('roomUser', { total: '550', common: { roomId: '22' } });
    first.emit('like', { total: '1000' }, true);
    other.emit('roomUser', { total: '88' });
    expect(manager.status('family').lastSequence).toBe(initial.lastSequence);
    expect(manager.getLiveActivity('family')).toMatchObject({ viewers: 12, totalLikes: 635,
      likeGoal: { baselineLikes: 500 }, recentActions: [{ kind: 'share', displayName: 'Зритель' }] });
    expect(manager.getLiveActivity('other')).toMatchObject({ viewers: 88, totalLikes: null, recentActions: [] });
    expect(sink.mock.calls.every(([, event]) => event.type === 'connection.state')).toBe(true);

    const beforeNoop = manager.getLiveActivity('family');
    manager.setLikeGoal('family', { targetCount: 100, revision: 1 });
    manager.setLikeGoal('family', { targetCount: null, revision: 0 });
    expect(manager.getLiveActivity('family')).toEqual(beforeNoop);

    first.emit('disconnected', {});
    expect(manager.getLiveActivity('family')).toMatchObject({ viewers: null, totalLikes: 635, likeGoal: { baselineLikes: 500 } });
    scheduler.runNext();
    await vi.waitFor(() => expect(manager.status('family').state).toBe('live'));
    resumed.emit('share', { common: { msgId: '31' }, user: { nickname: 'Зритель' } });
    resumed.emit('follow', { common: { msgId: '30' } }, true);
    resumed.emit('follow', { common: { msgId: '30' } });
    resumed.emit('like', { total: '620' });
    resumed.emit('roomUser', { total: '0', common: { roomId: '11' } });
    expect(manager.getLiveActivity('family')).toMatchObject({ connectionId: initial.connectionId, viewers: 0, totalLikes: 635,
      likeGoal: { baselineLikes: 500 }, recentActions: [{ kind: 'share', displayName: 'Зритель' }] });

    resumed.emit('disconnected', {});
    scheduler.runNext();
    await vi.waitFor(() => expect(manager.status('family').state).toBe('live'));
    expect(manager.getLiveActivity('family')).toMatchObject({ generation: initial.generation + 1, viewers: null, totalLikes: null,
      likeGoal: { targetCount: 100, baselineLikes: null }, recentActions: [] });
    expect(manager.getLiveActivity('family').connectionId).not.toBe(initial.connectionId);
    changed.emit('like', { total: '25' });
    manager.setLikeGoal('family', { targetCount: 500, revision: 2 });
    expect(manager.getLiveActivity('family').likeGoal).toEqual({ targetCount: 500, baselineLikes: 25, revision: 2 });
    await manager.stop('family');
    expect(manager.getLiveActivity('family')).toMatchObject({ viewers: null, totalLikes: 25 });
    expect(manager.getLiveActivity('other').viewers).toBe(88);
    await manager.close();
  });

  it('retains the first like total and the latest viewer count through a busy preparation', async () => {
    const connector = new FakeConnector();
    const finishConnect = Promise.withResolvers<string>();
    const finishPrepare = Promise.withResolvers<void>();
    const prepare = vi.fn(() => finishPrepare.promise);
    connector.connect.mockReturnValue(finishConnect.promise);
    const manager = new TikTokSessionManager(() => connector, undefined, new FakeScheduler(), undefined, undefined, undefined, prepare);
    manager.setLikeGoal('family', { targetCount: 100, revision: 1 });
    const session = manager.start('family', 'streamer');
    await vi.waitFor(() => expect(connector.connect).toHaveBeenCalledOnce());
    connector.emit('like', { total: '1111', common: { roomId: '22' } });
    connector.emit('like', { total: '1000', common: { roomId: '11' } });
    connector.emit('roomUser', { total: '17', common: { roomId: '11' } });
    finishConnect.resolve('11');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    for (let total = 1001; total <= 1130; total++) {
      connector.emit('like', { total: String(total), common: { roomId: '11' } });
      connector.emit('like', { total: '2500', common: { roomId: '22' } });
      connector.emit('roomUser', { total: '22', common: { roomId: '22' } });
    }
    connector.emit('like', { total: '1120' });
    connector.emit('share', { common: { msgId: '45', roomId: '11' }, user: { nickname: 'Даритель' } }, true);
    connector.emit('share', { common: { msgId: '45', roomId: '11' }, user: { nickname: 'Дубликат' } });
    connector.emit('share', { common: { msgId: '46', roomId: '11' }, user: { nickname: 'Свежее событие' } });
    finishPrepare.resolve();
    await session;
    expect(manager.getLiveActivity('family')).toMatchObject({ viewers: 17, totalLikes: 1130,
      likeGoal: { baselineLikes: 1000 }, recentActions: [{ kind: 'share', displayName: 'Свежее событие' }] });
    await manager.close();
  });

  it('records each normalized channel selected for a connection attempt', async () => {
    const connector = new FakeConnector();
    const requested: Array<[string, string]> = [];
    const manager = new TikTokSessionManager(
      () => connector,
      () => undefined,
      new FakeScheduler(),
      () => undefined,
      (workspaceId, username) => requested.push([workspaceId, username]),
    );
    await manager.start('family', '@Streamer.Name');
    expect(requested).toEqual([['family', 'Streamer.Name']]);
  });

  it('normalizes valid events and rejects malformed and duplicate input', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event));
    await manager.start('family', '@streamer');
    connector.emit('chat', chat);
    connector.emit('chat', chat);
    connector.emit('chat', { comment: 'missing user' });
    expect(events.filter((event) => event.type === 'chat.message')).toEqual([
      expect.objectContaining({ senderUsername: 'viewer', text: 'Привет!' }),
    ]);
    expect(manager.status('family')).toMatchObject({ state: 'live', tiktokUsername: 'streamer' });
  });

  it('normalizes the current connector chat shape', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event));
    await manager.start('family', 'streamer');
    connector.emit('chat', {
      common: { msgId: 'chat-current-1' },
      user: {
        id: '42', secUid: 'must-not-leave-the-adapter', displayId: 'current_viewer', nickname: 'Current Viewer',
        avatarThumb: { urlList: ['https://cdn.example/avatar.png'] }, verified: true,
        followInfo: { followerCount: '123', followingCount: '45' },
        payGrade: { level: 17 }, fansClub: { data: { clubName: 'Stream Team', level: 8 } },
      },
      userIdentity: {
        isFollowerOfAnchor: true, isMutualFollowingWithAnchor: false, isModeratorOfAnchor: true,
        isSubscriberOfAnchor: true, isAnchor: false, isGiftGiverOfAnchor: true,
      },
      content: 'Current message', contentLanguage: 'ru',
      mentionUsers: [{ displayId: 'streamer' }],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat.message', senderUsername: 'current_viewer', text: 'Current message', language: 'ru',
      mentionedUsernames: ['streamer'],
      participant: {
        userId: '42', avatarUrl: 'https://cdn.example/avatar.png', secUidAvailable: true, verified: true,
        follower: true, mutualFollow: false, moderator: true, subscriber: true, anchor: false, giftGiver: true,
        followerCount: 123, followingCount: 45, gifterLevel: 17, fanClubName: 'Stream Team', fanClubLevel: 8,
      },
    }));
    expect(JSON.stringify(events)).not.toContain('must-not-leave-the-adapter');
  });

  it('prepares entitlements once and attaches safe speaker context without exposing identity keys', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const prepared: Array<[string, string]> = [];
    const manager = new TikTokSessionManager(
      () => connector, (_workspace, event) => events.push(event), undefined, undefined, undefined, undefined,
      async (workspaceId, streamId) => { prepared.push([workspaceId, streamId]); },
      (_workspaceId, identityKey, roles) => ({
        ...roles,
        speechLevels: [{
          levelId: '123e4567-e89b-42d3-a456-426614174000', levelName: 'Голос эфира',
          cooldownSeconds: 30, expiresAt: null,
        }],
      }),
    );
    await manager.start('family', 'streamer');
    connector.emit('chat', {
      common: { msgId: 'entitled-chat' },
      user: { displayId: 'viewer', nickname: 'Viewer', secUid: 'private-speaker-identity' },
      userIdentity: { isModeratorOfAnchor: true, isGiftGiverOfAnchor: true }, content: 'Read me',
    });
    expect(prepared).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat.message',
      speakerContext: {
        isModerator: true, isGiftGiver: true,
        speechLevels: [expect.objectContaining({ levelName: 'Голос эфира' })],
      },
    }));
    expect(JSON.stringify(events)).not.toContain('private-speaker-identity');
    expect(JSON.stringify(events)).not.toContain('senderIdentityKey');
  });

  it('keeps current connector emote images in the project chat contract', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event));
    await manager.start('family', 'streamer');
    connector.emit('chat', {
      common: { msgId: 'chat-emote-1' }, user: { displayId: 'viewer' }, content: '[thanks]',
      emotes: [{ index: 0, emote: { emoteId: 'thanks', image: { urlList: ['https://cdn.example/thanks.png'] } } }],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat.message', emotes: [{ emoteId: 'thanks', imageUrl: 'https://cdn.example/thanks.png', position: 0 }],
    }));
  });

  it.each([
    { format: 'giftDetails.giftType', metadata: { giftDetails: { giftType: 1 } } },
    { format: 'gift.type', metadata: { giftDetails: undefined, gift: { type: 1 } } },
  ])('counts each gift in a streak once with $format', async ({ metadata }) => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event));
    await manager.start('family', 'streamer');
    const sendGift = (count: number, end: boolean, id: string) => {
      connector.emit('gift', { ...gift(count, end, id), ...metadata });
    };
    sendGift(1, false, 'gift-1');
    sendGift(3, false, 'gift-2');
    sendGift(3, true, 'gift-3');
    sendGift(3, true, 'gift-3');
    expect(events.filter((event) => event.type === 'gift.received').map((event) => event.repeatCount)).toEqual([1, 2]);
  });

  it('uses a private stable sender key for incremental support accounting', async () => {
    const connector = new FakeConnector();
    const observed: Array<{ count: number; key: string; username: string }> = [];
    const manager = new TikTokSessionManager(
      () => connector, () => undefined, undefined, undefined, undefined,
      (_workspaceId, _streamId, event, key) => { observed.push({ count: event.repeatCount, key, username: event.senderUsername }); },
    );
    await manager.start('family', 'streamer');
    const securedGift = (repeatCount: number, repeatEnd: boolean, msgId: string) => ({
      ...gift(repeatCount, repeatEnd, msgId), diamondCount: 5,
      user: { uniqueId: 'viewer', nickname: 'Зритель', secUid: 'private-sec-uid' },
    });
    connector.emit('gift', securedGift(1, false, 'secure-1'));
    connector.emit('gift', {
      ...securedGift(3, false, 'secure-2'),
      user: { uniqueId: 'viewer_renamed', nickname: 'Новое имя', secUid: 'private-sec-uid' },
    });
    connector.emit('gift', securedGift(3, true, 'secure-3'));
    expect(observed.map(({ count }) => count)).toEqual([1, 2]);
    expect(observed[0]?.username).toBe('viewer');
    expect(observed[0]?.key).toMatch(/^[0-9a-f]{64}$/);
    expect(observed[1]?.username).toBe('viewer_renamed');
    expect(observed[1]?.key).toBe(observed[0]?.key);
    expect(JSON.stringify(observed)).not.toContain('private-sec-uid');
  });

  it('extracts current connector gift metadata without the optional catalogue request', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event));
    await manager.start('family', 'streamer');
    connector.emit('gift', {
      common: { msgId: 'gift-current-1' }, user: { displayId: 'viewer', nickname: 'Viewer' },
      giftId: '5655', repeatCount: 1, repeatEnd: 1,
      gift: { name: 'Rose', diamondCount: 1, image: { urlList: ['https://cdn.example/rose.png'] } },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'gift.received', giftId: '5655', giftName: 'Rose', diamondCount: 1,
      imageUrl: 'https://cdn.example/rose.png',
    }));
  });

  it('shows initial chat without reactions and uses historical gifts as a baseline for the first live increment', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const observed = vi.fn();
    const roomId = '7484000000000000001';
    const groupId = '7484000000000000002';
    connector.connect.mockImplementationOnce(async () => {
      connector.emit('chat', chat, true);
      connector.emit('gift', { ...gift(3, false, 'start-3'), groupId }, true);
      connector.emit('gift', { ...gift(1, true, 'initial-single'), giftDetails: { giftType: 2 } }, true);
      connector.emit('gift', { ...gift(4, false, 'live-4'), groupId });
      return roomId;
    });
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event), undefined, undefined, undefined, observed);
    const status = await manager.start('family', 'streamer');
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events[2]).toMatchObject({ type: 'chat.message', historical: true });
    expect(events.filter((event) => event.type === 'gift.received')).toEqual([expect.objectContaining({ repeatCount: 1 })]);
    expect(status.connectionId).toBeDefined();
    expect(observed).toHaveBeenCalledExactlyOnceWith('family', expect.any(String), expect.objectContaining({ repeatCount: 1 }), expect.any(String), {
      streak: { key: expect.stringMatching(/^[a-f0-9]{64}$/), historicalCount: 3, totalCount: 4 }, upstreamEventId: 'live-4',
    });
    expect(JSON.stringify(events)).not.toMatch(/groupId|senderIdentityKey|748400000000000000/);
  });

  it('keeps series and totals in the same room across reconnect, then starts a fresh generation for a new room', async () => {
    const roomA = '7484000000000000001';
    const roomB = '7484000000000000002';
    const groupId = '7410000000000000001';
    const connectors = [new FakeConnector(), new FakeConnector(), new FakeConnector()];
    connectors[0]!.connect.mockResolvedValueOnce(roomA);
    connectors[1]!.connect.mockResolvedValueOnce(roomA);
    connectors[2]!.connect.mockResolvedValueOnce(roomB);
    const [first, second, third] = connectors as [FakeConnector, FakeConnector, FakeConnector];
    const scheduler = new FakeScheduler();
    const events: RealtimeEvent[] = [];
    const prepare = vi.fn<(_workspaceId: string, _streamId: string) => Promise<void>>(async () => undefined);
    const completed = vi.fn();
    const manager = new TikTokSessionManager(() => connectors.shift()!, (_workspace, event) => events.push(event), scheduler,
      undefined, undefined, undefined, prepare, undefined, undefined, completed);
    const a = await manager.start('family', 'streamer');
    const streamA = prepare.mock.calls[0]?.[1];
    expect(streamA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    first.emit('gift', { ...gift(1, false, 'same-packet-id'), groupId });
    first.emit('disconnected', {});
    scheduler.runNext();
    await vi.waitFor(() => expect(manager.status('family')).toMatchObject({ state: 'live', connectionId: a.connectionId, generation: 1 }));
    second.emit('gift', { ...gift(3, false, 'same-packet-id'), groupId });
    second.emit('gift', { ...gift(3, true, 'repeated-final'), groupId });
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ generation: 1, repeatCount: 3, connectionId: a.connectionId }), true);
    second.emit('disconnected', {});
    scheduler.runNext();
    await vi.waitFor(() => expect(manager.status('family')).toMatchObject({ state: 'live', generation: 2 }));
    const b = manager.status('family');
    expect(b.connectionId).not.toBe(a.connectionId);
    third.emit('gift', { ...gift(100, true, 'stale-room'), groupId, common: { msgId: 'stale-room', roomId: roomA } });
    third.emit('gift', { ...gift(1, false, 'same-packet-id'), groupId, common: { msgId: 'same-packet-id', roomId: roomB } });
    third.emit('gift', { ...gift(1, true, 'new-room-final'), groupId, common: { msgId: 'new-room-final', roomId: roomB } });
    const accepted = events.filter((event) => event.type === 'gift.received');
    expect(accepted.map(({ generation, repeatCount }) => [generation, repeatCount])).toEqual([[1, 1], [1, 2], [2, 1]]);
    expect(new Set(accepted.map(({ eventId }) => eventId)).size).toBe(3);
    const streamB = prepare.mock.calls[2]?.[1];
    expect(streamA).not.toBe(streamB);
    expect(prepare.mock.calls).toEqual([['family', streamA], ['family', streamA], ['family', streamB]]);
    expect(completed).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 2, repeatCount: 1, connectionId: b.connectionId }), true);
    expect(completed.mock.calls[0]![0].eventId).not.toBe(completed.mock.calls[1]![0].eventId);
    await manager.close();

    const reopened = new FakeConnector();
    reopened.connect.mockResolvedValueOnce(roomA);
    prepare.mockClear();
    const reopenedCompletion = vi.fn();
    const restarted = new TikTokSessionManager(() => reopened, undefined, undefined, undefined, undefined, undefined,
      prepare, undefined, undefined, reopenedCompletion);
    const restartedStatus = await restarted.start('family', 'streamer');
    expect(restartedStatus.connectionId).not.toBe(a.connectionId);
    expect(prepare).toHaveBeenCalledExactlyOnceWith('family', streamA);
    reopened.emit('gift', { ...gift(3, true, 'another-final-id'), groupId });
    expect(reopenedCompletion).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventId: completed.mock.calls[0]![0].eventId, connectionId: restartedStatus.connectionId,
    }), true);
    await restarted.close();
  });

  it('publishes a zero-increment final once, after the prior gift write and without replaying history', async () => {
    const connector = new FakeConnector();
    const accepted = vi.fn();
    const completed = vi.fn();
    const accounting = Promise.withResolvers<{ repeatCount: number }>();
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => {
      if (event.type === 'gift.received') accepted(event);
    }, undefined, undefined, undefined, () => accounting.promise, undefined, undefined, undefined, completed);
    const status = await manager.start('family', 'streamer');
    connector.emit('gift', { ...gift(2, true, 'history-final'), groupId: '1' }, true);
    connector.emit('gift', { ...gift(2, true, 'history-replayed'), groupId: '1' });
    connector.emit('gift', { ...gift(3, false, 'update'), groupId: '2', diamondCount: 5 });
    connector.emit('gift', { ...gift(3, true, 'new-final'), groupId: '2' });
    connector.emit('gift', { ...gift(3, true, 'repeated-final'), groupId: '2' });
    expect(completed).not.toHaveBeenCalled();
    accounting.resolve({ repeatCount: 3 });
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(accepted.mock.invocationCallOrder[0]).toBeLessThan(completed.mock.invocationCallOrder[0]!);
    expect(accepted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ repeatCount: 3 }));
    expect(completed).toHaveBeenCalledExactlyOnceWith({
      eventId: expect.stringMatching(/^gift-complete:[a-f0-9]{64}$/), workspaceId: 'family',
      connectionId: status.connectionId, generation: status.generation, giftId: 'rose', giftName: 'Rose',
      senderDisplayName: 'Зритель', senderUsername: 'viewer', repeatCount: 3, diamondCount: 5,
    }, true);
    expect(isGiftCompletedEvent(completed.mock.calls[0]![0])).toBe(true);
    await manager.close();
  });

  it('emits a completion only for an accepted live single and isolates a callback failure', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const diagnostics = vi.fn();
    const persisted = vi.fn().mockResolvedValueOnce({ repeatCount: 0 }).mockResolvedValue({ repeatCount: 1 });
    const completed = vi.fn().mockRejectedValueOnce(new Error('Fixture completion failure'));
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event), undefined,
      diagnostics, undefined, persisted, undefined, undefined, undefined, completed);
    const single = (id: string) => ({ ...gift(1, true, id), giftDetails: { giftType: 2, giftName: 'Rose' } });
    await manager.start('family', 'streamer');
    connector.emit('gift', single('history'), true);
    connector.emit('gift', single('history'));
    connector.emit('gift', single('rejected-duplicate'));
    connector.emit('gift', single('new-one'));
    connector.emit('gift', single('new-one'));
    connector.emit('gift', single('new-two'));
    await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
    expect(persisted).toHaveBeenCalledTimes(3);
    expect(events.filter((event) => event.type === 'gift.received').map(({ eventId }) => eventId)).toEqual(['new-one', 'new-two']);
    expect(completed.mock.calls).toEqual([
      [expect.objectContaining({ repeatCount: 1 }), false], [expect.objectContaining({ repeatCount: 1 }), false],
    ]);
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith({ event: 'gift_completion_failed', errorName: 'Error' });
    await manager.close();
  });

  it('publishes only gifts accepted by accounting and drops late feedback after a session stops', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const persisted = vi.fn();
    const feedback = vi.fn();
    const completed = vi.fn();
    const accepted = vi.fn();
    const late = Promise.withResolvers<{ repeatCount: number; announce: () => void }>();
    persisted.mockResolvedValueOnce({ repeatCount: 0 }).mockResolvedValueOnce({ repeatCount: 2, announce: feedback })
      .mockReturnValueOnce(late.promise);
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event), undefined, undefined, undefined, persisted,
      undefined, undefined, undefined, completed, accepted);
    const status = await manager.start('family', 'streamer');
    connector.emit('gift', { ...gift(1, false, 'already-counted'), groupId: '1' });
    connector.emit('gift', { ...gift(6, false, 'new-increment'), groupId: '1' });
    await vi.waitFor(() => expect(feedback).toHaveBeenCalledOnce());
    expect(events.filter((event) => event.type === 'gift.received')).toEqual([expect.objectContaining({ repeatCount: 2, sequence: 3 })]);
    connector.emit('gift', { ...gift(100, false, 'late-increment'), groupId: '1' });
    connector.emit('gift', { ...gift(100, true, 'late-final'), groupId: '1' });
    await vi.waitFor(() => expect(persisted).toHaveBeenCalledTimes(3));
    await manager.stop('family');
    late.resolve({ repeatCount: 1, announce: feedback });
    await manager.close();
    expect(feedback).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'gift.received')).toHaveLength(1);
    expect(accepted).toHaveBeenCalledExactlyOnceWith('family', status.connectionId,
      expect.objectContaining({ type: 'gift.received', repeatCount: 2, sequence: 3 }), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(accepted.mock.invocationCallOrder[0]).toBeLessThan(feedback.mock.invocationCallOrder[0]!);
  });

  it('observes a delayed increment during reconnect while skipping historical packets and isolating callback failure', async () => {
    const first = new FakeConnector();
    const second = new FakeConnector();
    first.connect.mockResolvedValue('8');
    second.connect.mockResolvedValue('8');
    const connectors = [first, second];
    const scheduler = new FakeScheduler();
    const diagnostics = vi.fn();
    const deferred = Promise.withResolvers<{ repeatCount: number }>();
    const persisted = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue({ repeatCount: 1 });
    const accepted = vi.fn().mockImplementationOnce(() => { throw new Error('Fixture observer failure'); });
    const manager = new TikTokSessionManager(() => connectors.shift()!, undefined, scheduler, diagnostics, undefined, persisted,
      undefined, undefined, undefined, undefined, accepted);
    const status = await manager.start('family', 'streamer');
    first.emit('gift', { ...gift(4, false, 'history'), groupId: '1' }, true);
    first.emit('gift', { ...gift(5, false, 'accepted-late'), groupId: '1' });
    first.emit('disconnected', {});
    deferred.resolve({ repeatCount: 1 });
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
    expect(accepted).toHaveBeenCalledWith('family', status.connectionId,
      expect.objectContaining({ repeatCount: 1, historical: true }), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(diagnostics).toHaveBeenCalledWith({ event: 'gift_observer_failed', errorName: 'Error' });

    scheduler.runNext();
    await vi.waitFor(() => expect(manager.status('family').state).toBe('live'));
    second.emit('gift', { ...gift(5, false, 'history-duplicate'), groupId: '1' }, true);
    second.emit('gift', { ...gift(6, false, 'accepted-fresh'), groupId: '1' });
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(2));
    expect(accepted.mock.calls[1]![2]).not.toHaveProperty('historical');
    expect(persisted).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it('retries a failed gift write with the same stage identity before publishing the accepted increment', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const persisted = vi.fn().mockRejectedValueOnce(new Error('Fixture transaction failure')).mockResolvedValueOnce({ repeatCount: 1 });
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event), undefined, undefined, undefined, persisted);
    await manager.start('family', 'streamer');
    connector.emit('gift', { ...gift(1, false, 'retry-packet'), groupId: '1' });
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'gift.received')).toHaveLength(1));
    expect(persisted).toHaveBeenCalledTimes(2);
    expect(persisted.mock.calls[0]).toEqual(persisted.mock.calls[1]);
    await manager.close();
  });

  it('reconnects after disconnect and manual stop cancels a pending reconnect', async () => {
    const first = new FakeConnector();
    const second = new FakeConnector();
    const scheduler = new FakeScheduler();
    const connectors = [first, second];
    const manager = new TikTokSessionManager(() => connectors.shift()!, () => undefined, scheduler);
    await manager.start('family', 'streamer');
    first.emit('disconnected', { code: 1006 });
    expect(manager.status('family').state).toBe('reconnecting');
    scheduler.runNext();
    await vi.waitFor(() => expect(manager.status('family').state).toBe('live'));
    second.emit('disconnected', { code: 1006 });
    expect(scheduler.callbacks).toHaveLength(1);
    await manager.stop('family');
    expect(scheduler.callbacks).toHaveLength(0);
    expect(manager.status('family').state).toBe('stopped');
  });

  it('marks an offline stream and cleans every connector up on shutdown', async () => {
    const connector = new FakeConnector();
    connector.connect.mockRejectedValueOnce(new Error('TIKTOK_USER_OFFLINE'));
    const scheduler = new FakeScheduler();
    const manager = new TikTokSessionManager(() => connector, () => undefined, scheduler);
    await manager.start('family', 'streamer');
    expect(manager.status('family').state).toBe('offline');
    await manager.close();
    expect(connector.disconnect).toHaveBeenCalled();
    expect(scheduler.callbacks).toHaveLength(0);
  });

  it('reports only bounded technical error metadata to diagnostics', async () => {
    const connector = new FakeConnector();
    const diagnostics: unknown[] = [];
    const error = Object.assign(new Error('secret response body'), { code: 'ECONNRESET', statusCode: 502 });
    connector.connect.mockRejectedValueOnce(error);
    const manager = new TikTokSessionManager(() => connector, () => undefined, new FakeScheduler(), (entry) => diagnostics.push(entry));
    await manager.start('family', 'streamer');
    expect(diagnostics).toEqual([{ event: 'connect_failed', errorName: 'Error', code: 'ECONNRESET', statusCode: 502 }]);
    expect(JSON.stringify(diagnostics)).not.toContain('secret response body');
  });
});
