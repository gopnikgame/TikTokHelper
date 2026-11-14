import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import type {
  AuthPrincipal, ClientToServerEvents, CommandAcknowledgement, GiftCompletedEvent, ServerToClientEvents,
} from '@tiktok-helper/contracts';
import { buildApp } from '../src/app.js';
import { GiftGoalRuntime } from '../src/gift-goals/runtime.js';
import { RecentEventBuffer } from '../src/realtime/buffer.js';
import { attachRealtimeServer, type RealtimeServerOptions } from '../src/realtime/server.js';
import { TikTokSessionManager } from '../src/tiktok/session-manager.js';
import type { ConnectorEventMap, LiveConnector } from '../src/tiktok/types.js';
import type { LiveConnectorFactory } from '../src/tiktok/types.js';
import { ScriptedConnector } from './helpers/scripted-connector.js';

class FakeConnector implements LiveConnector {
  connect = vi.fn(async () => undefined);
  disconnect = vi.fn(async () => undefined);
  on<EventName extends keyof ConnectorEventMap>(
    _eventName: EventName, _handler: (event: ConnectorEventMap[EventName]) => void,
  ): void { void _eventName; void _handler; }
  removeAllListeners(): void {}
}

const apps = new Set<ReturnType<typeof buildApp>>();
const clients = new Set<Socket<ServerToClientEvents, ClientToServerEvents>>();
afterEach(async () => {
  for (const client of clients) client.close();
  clients.clear();
  await Promise.all([...apps].map(async (app) => app.close()));
  apps.clear();
});

async function setup(
  authorizeWorkspace: (workspaceId: string, principal?: AuthPrincipal) => boolean | Promise<boolean> =
    (workspaceId: string): boolean => workspaceId === 'primary',
  authenticate?: NonNullable<RealtimeServerOptions['authenticate']>,
  cookie?: string,
  extraHeaders?: Record<string, string>,
  connectorFactory?: LiveConnectorFactory,
  authorizeLiveConnect?: NonNullable<RealtimeServerOptions['authorizeLiveConnect']>,
  giftGoals?: RealtimeServerOptions['giftGoals'],
  prepareLiveActivity?: RealtimeServerOptions['prepareLiveActivity'],
) {
  const connector = new FakeConnector();
  const events: Parameters<ReturnType<typeof attachRealtimeServer>['publish']>[] = [];
  let publish: ReturnType<typeof attachRealtimeServer>['publish'] = () => undefined;
  let publishActivity = (_id: string): void => { void _id; };
  const manager = new TikTokSessionManager(connectorFactory ?? (() => connector), (workspaceId, event) => {
    events.push([workspaceId, event]); publish(workspaceId, event);
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  (id) => publishActivity(id));
  const app = buildApp({ logger: false, tiktokManager: manager });
  apps.add(app);
  const realtime = attachRealtimeServer(app, manager, {
    authorizeWorkspace, bufferCapacity: 2, ...(authenticate ? { authenticate } : {}),
    ...(authorizeLiveConnect ? { authorizeLiveConnect } : {}),
    giftGoals, prepareLiveActivity,
  });
  publish = realtime.publish;
  publishActivity = realtime.scheduleLiveActivity;
  app.addHook('preClose', async () => realtime.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client: Socket<ServerToClientEvents, ClientToServerEvents> = createClient(address, {
    transports: ['websocket'], forceNew: true,
    ...((cookie || extraHeaders) ? { extraHeaders: { ...extraHeaders, ...(cookie ? { cookie } : {}) } } : {}),
  });
  clients.add(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve); client.once('connect_error', reject);
  });
  return { address, app, client, connector, manager, realtime, events };
}

function subscribe(
  client: Socket<ServerToClientEvents, ClientToServerEvents>, workspaceId: string,
): Promise<CommandAcknowledgement> {
  return new Promise((resolve) => client.emit('workspace:subscribe', {
    commandId: randomUUID(), workspaceId,
  }, resolve));
}

describe('realtime server', () => {
  it('counts unique authenticated users instead of browser tabs', async () => {
    const users = {
      first: { userId: randomUUID(), displayName: 'First', isAdmin: false, workspaces: [{ id: 'primary', displayName: 'Primary' }] },
      second: { userId: randomUUID(), displayName: 'Second', isAdmin: false, workspaces: [{ id: 'primary', displayName: 'Primary' }] },
    };
    const authenticate: NonNullable<RealtimeServerOptions['authenticate']> = async (headers) => {
      const cookie = headers.cookie;
      return cookie === 'user=first' ? users.first : cookie === 'user=second' ? users.second : null;
    };
    const { address, client } = await setup(() => true, authenticate, 'user=first');
    const nextPresence = (expected: number) => new Promise<number>((resolve) => {
      const listener = ({ onlineUsers }: { onlineUsers: number }) => {
        if (onlineUsers === expected) { client.off('presence:update', listener); resolve(onlineUsers); }
      };
      client.on('presence:update', listener);
    });
    const initial = nextPresence(1);
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });
    await expect(initial).resolves.toBe(1);

    const connectAnother = async (cookie: string) => {
      const another: Socket<ServerToClientEvents, ClientToServerEvents> = createClient(address, {
        transports: ['websocket'], forceNew: true, extraHeaders: { cookie },
      });
      clients.add(another);
      await new Promise<void>((resolve, reject) => {
        another.once('connect', resolve); another.once('connect_error', reject);
      });
      return another;
    };
    const sameUserPresence = nextPresence(1);
    await connectAnother('user=first');
    await expect(sameUserPresence).resolves.toBe(1);

    const secondUserPresence = nextPresence(2);
    const secondUser = await connectAnother('user=second');
    await expect(secondUserPresence).resolves.toBe(2);

    const afterDisconnect = nextPresence(1);
    secondUser.close();
    await expect(afterDisconnect).resolves.toBe(1);
  });

  it('rejects an anonymous Socket.IO handshake', async () => {
    await expect(setup(
      () => true,
      async () => null,
    )).rejects.toBeTruthy();
  });

  it('authenticates the handshake and authorizes rooms for that principal', async () => {
    const principal = { userId: randomUUID(), displayName: null, isAdmin: false, workspaces: [{ id: 'mine', displayName: 'Мой эфир' }] };
    const { client } = await setup(
      (workspaceId, current) => current?.userId === principal.userId && current.workspaces.some((workspace) => workspace.id === workspaceId),
      async (headers) => headers.cookie === 'session=valid' ? principal : null,
      'session=valid',
    );
    expect(await subscribe(client, 'mine')).toEqual({ ok: true });
    expect(await subscribe(client, 'other')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('passes the trusted proxy marker through Socket.IO authentication', async () => {
    const principal = { userId: randomUUID(), displayName: 'Локальный доступ', isAdmin: false, workspaces: [{ id: 'primary', displayName: 'Основной эфир' }] };
    const { client } = await setup(
      (workspaceId, current) => current?.userId === principal.userId
        && current.workspaces.some((workspace) => workspace.id === workspaceId),
      async (headers) => headers['x-tiktok-local-access'] === '1' ? principal : null,
      undefined,
      { 'x-tiktok-local-access': '1' },
    );
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });
    expect(await subscribe(client, 'other')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('sends participant diagnostics to administrators only', async () => {
    const diagnosticEvent = {
      type: 'chat.message' as const, generation: 1, sequence: 1, eventId: 'chat-1',
      senderDisplayName: 'Viewer', senderUsername: 'viewer', text: 'Hello', language: 'ru',
      participant: { userId: '42', secUidAvailable: true, moderator: true },
      speakerContext: { isModerator: true, isGiftGiver: false, speechLevels: [] },
    };
    const memberPrincipal = { userId: randomUUID(), displayName: 'Member', isAdmin: false, workspaces: [{ id: 'mine', displayName: 'Мой эфир' }] };
    const member = await setup(
      (workspaceId, current) => current?.workspaces.some((workspace) => workspace.id === workspaceId) === true,
      async () => memberPrincipal,
    );
    expect(await subscribe(member.client, 'mine')).toEqual({ ok: true });
    const memberEvent = new Promise<unknown>((resolve) => member.client.once('event', resolve));
    member.realtime.publish('mine', diagnosticEvent);
    await expect(memberEvent).resolves.toEqual({
      type: 'chat.message', generation: 1, sequence: 1, eventId: 'chat-1',
      senderDisplayName: 'Viewer', senderUsername: 'viewer', text: 'Hello', language: 'ru',
      speakerContext: { isModerator: true, isGiftGiver: false, speechLevels: [] },
    });

    const adminPrincipal = { userId: randomUUID(), displayName: 'Admin', isAdmin: true, workspaces: [{ id: 'mine', displayName: 'Мой эфир' }] };
    const admin = await setup(
      (workspaceId, current) => current?.workspaces.some((workspace) => workspace.id === workspaceId) === true,
      async () => adminPrincipal,
    );
    expect(await subscribe(admin.client, 'mine')).toEqual({ ok: true });
    const adminEvent = new Promise<unknown>((resolve) => admin.client.once('event', resolve));
    admin.realtime.publish('mine', diagnosticEvent);
    await expect(adminEvent).resolves.toEqual(diagnosticEvent);
  });

  it('publishes declarative level grants only to the matching workspace room', async () => {
    const { client, realtime } = await setup();
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });
    const received = new Promise<unknown>((resolve) => client.once('support:level-granted', resolve));
    const event = {
      eventId: 'grant:one', workspaceId: 'primary', senderDisplayName: 'Viewer',
      senderUsername: 'viewer', levelId: '123e4567-e89b-42d3-a456-426614174000',
      levelName: 'Голос эфира', thresholdPoints: 10_000, pointsAdded: 100,
      streamTotal: 2_000, lifetimeTotal: 10_050, expiresAt: null,
    };
    realtime.publishSupportLevelGranted('other', event);
    realtime.publishSupportLevelGranted('primary', event);
    await expect(received).resolves.toEqual(event);
  });

  it('delivers gift completion to the current workspace admin only, outside the replay', async () => {
    const principal: AuthPrincipal = {
      userId: randomUUID(), displayName: 'Admin', isAdmin: true,
      workspaces: [{ id: 'primary', displayName: 'Primary' }, { id: 'other', displayName: 'Other' }],
    };
    const { client, address, manager, realtime } = await setup(
      (workspaceId, user) => user?.workspaces.some((workspace) => workspace.id === workspaceId) ?? false,
      (headers) => headers.cookie === 'role=standard' ? { ...principal, userId: randomUUID(), isAdmin: false } : principal,
    );
    const additionalClient = async (workspaceId: string, cookie?: string) => {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = createClient(address, {
        transports: ['websocket'], forceNew: true, ...(cookie ? { extraHeaders: { cookie } } : {}),
      });
      clients.add(socket);
      expect(await subscribe(socket, workspaceId)).toEqual({ ok: true });
      return socket;
    };
    const standard = await additionalClient('primary', 'role=standard');
    const other = await additionalClient('other');
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });

    const live = await manager.start('primary', 'fixture_streamer');
    const completion: GiftCompletedEvent = {
      eventId: 'gift-complete:one', workspaceId: 'primary', generation: live.generation, connectionId: live.connectionId!,
      giftId: '5655', giftName: 'Rose', repeatCount: 3, diamondCount: 100,
      senderDisplayName: 'Viewer', senderUsername: 'viewer',
    };
    const unexpected = vi.fn();
    standard.on('gift:completed', unexpected);
    other.on('gift:completed', unexpected);
    const accepted = vi.fn();
    client.on('gift:completed', accepted);
    realtime.publishGiftCompleted({ ...completion, generation: 0 });
    realtime.publishGiftCompleted({ ...completion, connectionId: randomUUID() });
    realtime.publishGiftCompleted(completion);
    await manager.stop('primary');
    realtime.publishGiftCompleted(completion);
    for (const [socket, workspace] of [[client, 'primary'], [standard, 'primary'], [other, 'other']] as const) {
      const snapshot = new Promise<Parameters<ServerToClientEvents['snapshot']>[0]>((resolve) => socket.once('snapshot', resolve));
      await subscribe(socket, workspace);
      expect((await snapshot).replay.every((event) => event.type === 'connection.state')).toBe(true);
    }
    expect(accepted).toHaveBeenCalledExactlyOnceWith(completion);
    expect(unexpected).not.toHaveBeenCalled();
  });

  it('recovers gift goals on an admin snapshot and keeps progress and milestone inside that workspace', async () => {
    const workspaces = ['primary', 'other'].map((id) => ({ id, displayName: id }));
    const configuration = { giftId: '5655', targetCount: 2, soundAssetId: null, isEnabled: true, revision: 1 };
    const loadGoal = vi.fn(async () => configuration);
    const goals: GiftGoalRuntime = new GiftGoalRuntime({ get: loadGoal }, (id) => manager.status(id), (update) => realtime.publishGiftGoal(update));
    const { client, address, manager, realtime } = await setup(
      (id, principal) => principal?.workspaces.some((workspace) => workspace.id === id) ?? false,
      (headers) => ({ userId: randomUUID(), displayName: 'Fixture', isAdmin: headers.cookie !== 'role=standard', workspaces }),
      undefined, undefined, undefined, undefined, { prepare: (id) => goals.prepare(id, true), snapshot: (id) => goals.snapshot(id) },
    );
    const subscribeAndRead = async (socket: typeof client, id: string) => {
      const pending = new Promise<Parameters<ServerToClientEvents['snapshot']>[0]>((resolve) => socket.once('snapshot', resolve));
      expect(await subscribe(socket, id)).toEqual({ ok: true });
      return pending;
    };
    const standard: typeof client = createClient(address, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: 'role=standard' } });
    const other: typeof client = createClient(address, { transports: ['websocket'], forceNew: true });
    clients.add(standard); clients.add(other);
    expect((await subscribeAndRead(standard, 'primary')).giftGoal).toBeUndefined();
    expect(loadGoal).not.toHaveBeenCalled();
    expect((await subscribeAndRead(other, 'other')).giftGoal).toMatchObject({ workspaceId: 'other', progress: 0 });
    expect((await subscribeAndRead(client, 'primary')).giftGoal).toMatchObject({ workspaceId: 'primary', progress: 0 });

    const live = await manager.start('primary', 'fixture_streamer');
    const connectionId = live.connectionId!;
    goals.trackConnection('primary', { type: 'connection.state', state: 'live', generation: live.generation, sequence: live.lastSequence, connectionId });
    const adminUpdates = vi.fn();
    const privateUpdates = vi.fn();
    client.on('gift-goal:update', adminUpdates);
    standard.on('gift-goal:update', privateUpdates);
    other.on('gift-goal:update', privateUpdates);
    const gift = {
      type: 'gift.received' as const, eventId: 'fixture-one', generation: live.generation, sequence: live.lastSequence + 1,
      giftId: '5655', giftName: 'Rose', senderDisplayName: 'Даритель', senderUsername: 'viewer', diamondCount: 100, repeatCount: 3,
    };
    goals.observe('primary', connectionId, gift, 'fixture-private');
    goals.observe('primary', connectionId, gift, 'fixture-private');
    const recovered = await subscribeAndRead(client, 'primary');
    expect(recovered.giftGoal).toMatchObject({ progress: 3, topDonors: [{ displayName: 'Даритель', points: 300 }] });
    expect(recovered).not.toHaveProperty('reached');
    expect(recovered.replay.every((event) => event.type === 'connection.state')).toBe(true);
    expect((await subscribeAndRead(standard, 'primary')).giftGoal).toBeUndefined();
    expect((await subscribeAndRead(other, 'other')).giftGoal).toMatchObject({ progress: 0, topDonors: [] });
    expect(adminUpdates.mock.calls.filter(([update]) => update.reached === true)).toHaveLength(1);
    expect(privateUpdates).not.toHaveBeenCalled();
    goals.close();
  });

  it('sends coalesced activity and its recoverable summary only to the matching admin room', async () => {
    const workspaces = ['primary', 'elsewhere'].map((id) => ({ id, displayName: id }));
    const activityPrepared = vi.fn(async (_id: string) => { void _id; });
    let liveConnector: ScriptedConnector | undefined;
    const { client, address, manager } = await setup(
      (id, principal) => principal?.workspaces.some(({ id: allowedId }) => allowedId === id) ?? false,
      (headers) => ({ userId: randomUUID(), displayName: 'Fixture', isAdmin: headers.cookie !== 'role=standard', workspaces }),
      undefined, undefined, () => {
        const connector = new ScriptedConnector([], '7484000000000000001');
        liveConnector = connector;
        return connector;
      }, undefined, undefined, activityPrepared,
    );
    async function readSnapshot(socket: typeof client, workspace: string) {
      const next = new Promise<Parameters<ServerToClientEvents['snapshot']>[0]>((resolve) => socket.once('snapshot', resolve));
      expect(await subscribe(socket, workspace)).toEqual({ ok: true });
      return next;
    }
    const standard: typeof client = createClient(address, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: 'role=standard' } });
    const other: typeof client = createClient(address, { transports: ['websocket'], forceNew: true });
    clients.add(standard); clients.add(other);
    expect((await readSnapshot(standard, 'primary')).liveActivity).toBeUndefined();
    expect(activityPrepared).not.toHaveBeenCalled();
    expect((await readSnapshot(other, 'elsewhere')).liveActivity).toMatchObject({ workspaceId: 'elsewhere', viewers: null, totalLikes: null });
    expect((await readSnapshot(client, 'primary')).liveActivity).toMatchObject({ workspaceId: 'primary', viewers: null });
    expect(activityPrepared.mock.calls).toEqual([['elsewhere'], ['primary']]);

    const privateUpdates = vi.fn();
    standard.on('live-activity:update', privateUpdates);
    other.on('live-activity:update', privateUpdates);
    const next = new Promise<Parameters<ServerToClientEvents['live-activity:update']>[0]>((resolve) => client.once('live-activity:update', resolve));
    manager.setLikeGoal('primary', { targetCount: 25, revision: 1 });
    await manager.start('primary', 'fixture_streamer');
    liveConnector!.emit('roomUser', { total: '81', totalUser: '903' });
    liveConnector!.emit('like', { total: '120', count: 90 });
    liveConnector!.emit('like', { total: '150', count: 7 });
    liveConnector!.emit('like', { total: '125', count: 5 });
    liveConnector!.emit('share', { common: { msgId: '7484000000000000021' }, user: { nickname: 'Зритель', secUid: 'fixture-private' } });
    expect(await next).toMatchObject({
      workspaceId: 'primary', viewers: 81, totalLikes: 150,
      likeGoal: { targetCount: 25, baselineLikes: 120 }, recentActions: [{ kind: 'share', displayName: 'Зритель' }],
    });

    const recovered = await readSnapshot(client, 'primary');
    expect(recovered.liveActivity).toEqual(manager.getLiveActivity('primary'));
    expect(recovered.replay.every((event) => event.type === 'connection.state')).toBe(true);
    expect(JSON.stringify(recovered.liveActivity)).not.toContain('fixture-private');
    expect((await readSnapshot(standard, 'primary')).liveActivity).toBeUndefined();
    expect((await readSnapshot(other, 'elsewhere')).liveActivity).toMatchObject({ totalLikes: null, recentActions: [] });
    expect(privateUpdates).not.toHaveBeenCalled();
  });

  it('rejects unauthorized and malformed subscriptions', async () => {
    const { client } = await setup();
    expect(await subscribe(client, 'other')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const malformed = await new Promise<CommandAcknowledgement>((resolve) => {
      client.emit('workspace:subscribe', { commandId: 'bad', workspaceId: '../primary' }, resolve);
    });
    expect(malformed).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });

  it('sends a snapshot before deltas and never creates a second matching connector', async () => {
    const { client, connector } = await setup();
    const order: string[] = [];
    client.on('snapshot', () => order.push('snapshot'));
    client.on('event', () => order.push('event'));
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });
    const firstCommand = randomUUID();
    const connect = (commandId: string) => new Promise<CommandAcknowledgement>((resolve) => client.emit(
      'live:connect', { commandId, workspaceId: 'primary', tiktokUsername: 'streamer' }, resolve,
    ));
    expect(await connect(firstCommand)).toEqual({ ok: true });
    expect(await connect(firstCommand)).toEqual({ ok: true, duplicate: true });
    expect(await connect(randomUUID())).toEqual({ ok: true });
    await vi.waitFor(() => expect(order).toContain('event'));
    expect(order[0]).toBe('snapshot');
    expect(connector.connect).toHaveBeenCalledTimes(1);
  });

  it('blocks a new LIVE connection when access expires without stopping an active connector', async () => {
    let allowed = true;
    const authorizeLiveConnect: NonNullable<RealtimeServerOptions['authorizeLiveConnect']> = async () => allowed
      ? { ok: true }
      : { ok: false, error: { code: 'ACCESS_DENIED', message: 'subscription_expired' } };
    const { client, connector } = await setup(undefined, undefined, undefined, undefined, undefined, authorizeLiveConnect);
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });
    const connect = () => new Promise<CommandAcknowledgement>((resolve) => client.emit(
      'live:connect', { commandId: randomUUID(), workspaceId: 'primary', tiktokUsername: 'streamer' }, resolve,
    ));
    expect(await connect()).toEqual({ ok: true });
    allowed = false;
    expect(await connect()).toEqual({ ok: false, error: { code: 'ACCESS_DENIED', message: 'subscription_expired' } });
    expect(connector.connect).toHaveBeenCalledTimes(1);
    expect(connector.disconnect).not.toHaveBeenCalled();
  });

  it('drives normalized scripted events through reconnect and browser reload without a live account', async () => {
    const scripted: ScriptedConnector[] = [];
    const factory: LiveConnectorFactory = () => {
      const index = scripted.length;
      const connector = new ScriptedConnector(index === 0 ? [
        { afterMs: 5, eventName: 'chat', payload: {
          common: { msgId: 'script-chat-1' }, user: { displayId: 'moderator', nickname: 'Moderator' },
          userIdentity: { isModeratorOfAnchor: true }, content: 'Scripted hello',
        } },
        { afterMs: 10, eventName: 'gift', payload: {
          common: { msgId: 'script-gift-1' }, user: { displayId: 'donor', nickname: 'Donor' },
          giftId: '5655', repeatCount: 1, repeatEnd: false, giftDetails: { giftType: 1, giftName: 'Rose' },
        } },
        { afterMs: 15, eventName: 'gift', payload: {
          common: { msgId: 'script-gift-2' }, user: { displayId: 'donor', nickname: 'Donor' },
          giftId: '5655', repeatCount: 3, repeatEnd: false, giftDetails: { giftType: 1, giftName: 'Rose' },
        } },
        { afterMs: 20, eventName: 'gift', payload: {
          common: { msgId: 'script-gift-3' }, user: { displayId: 'donor', nickname: 'Donor' },
          giftId: '5655', repeatCount: 3, repeatEnd: true, giftDetails: { giftType: 1, giftName: 'Rose' },
        } },
        { afterMs: 25, eventName: 'gift', payload: {
          common: { msgId: 'script-gift-3' }, user: { displayId: 'donor', nickname: 'Donor' },
          giftId: '5655', repeatCount: 3, repeatEnd: true, giftDetails: { giftType: 1, giftName: 'Rose' },
        } },
        { afterMs: 30, eventName: 'disconnected', payload: { code: 1006, reason: 'scripted' } },
      ] : [{
        afterMs: 5, eventName: 'chat', payload: {
          common: { msgId: 'script-chat-2' }, user: { displayId: 'viewer', nickname: 'Viewer' },
          content: 'Recovered after reconnect',
        },
      }]);
      scripted.push(connector);
      return connector;
    };
    const { address, client, events } = await setup(undefined, undefined, undefined, undefined, factory);
    expect(await subscribe(client, 'primary')).toEqual({ ok: true });
    await new Promise<CommandAcknowledgement>((resolve) => client.emit('live:connect', {
      commandId: randomUUID(), workspaceId: 'primary', tiktokUsername: 'fixture_streamer',
    }, resolve));
    await vi.waitFor(() => expect(scripted).toHaveLength(2), { timeout: 2_000 });
    await vi.waitFor(() => expect(events.some(([, event]) => event.type === 'chat.message' && event.text === 'Recovered after reconnect')).toBe(true));
    expect(events.filter(([, event]) => event.type === 'gift.received').map(([, event]) => event.type === 'gift.received' ? event.repeatCount : 0)).toEqual([1, 2]);

    const reloaded = createClient(address, { transports: ['websocket'], forceNew: true });
    clients.add(reloaded);
    await new Promise<void>((resolve, reject) => { reloaded.once('connect', resolve); reloaded.once('connect_error', reject); });
    const snapshot = new Promise<unknown>((resolve) => reloaded.once('snapshot', resolve));
    expect(await subscribe(reloaded, 'primary')).toEqual({ ok: true });
    await expect(snapshot).resolves.toMatchObject({ connectionState: 'live' });
    expect(scripted).toHaveLength(2);
  });

  it('removes socket listeners and stops the connector on shutdown', async () => {
    const { app, client, connector } = await setup();
    await subscribe(client, 'primary');
    await new Promise<CommandAcknowledgement>((resolve) => client.emit('live:connect', {
      commandId: randomUUID(), workspaceId: 'primary', tiktokUsername: 'streamer',
    }, resolve));
    await app.close();
    apps.delete(app);
    expect(connector.disconnect).toHaveBeenCalledTimes(1);
    expect(client.connected).toBe(false);
  });
});

describe('recent event buffer', () => {
  it('gives a fresh browser the bounded recent context from the active generation', () => {
    const buffer = new RecentEventBuffer(3);
    buffer.add('primary', { type: 'connection.state', generation: 1, sequence: 1, state: 'connecting' });
    buffer.add('primary', { type: 'connection.state', generation: 1, sequence: 2, state: 'live' });
    expect(buffer.replay('primary', 0, 0)).toEqual({
      events: [
        { type: 'connection.state', generation: 1, sequence: 1, state: 'connecting' },
        { type: 'connection.state', generation: 1, sequence: 2, state: 'live' },
      ],
      requiresFullRefresh: false,
    });
  });

  it('is bounded and signals a sequence gap it can no longer fill', () => {
    const buffer = new RecentEventBuffer(2);
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      buffer.add('primary', { type: 'connection.state', generation: 1, sequence, state: 'live' });
    }
    const overview = buffer.replay('primary', 1, 0);
    expect(overview.requiresFullRefresh).toBe(true);
    expect(overview.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(buffer.replay('primary', 1, 1).events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it('returns the current tail when the cursor points to an old generation or a restarted process', () => {
    const buffer = new RecentEventBuffer(3);
    buffer.add('primary', { type: 'connection.state', generation: 1, sequence: 8, state: 'live' });
    const newStream = { type: 'connection.state', generation: 2, sequence: 1, state: 'connecting' } as const;
    buffer.add('primary', newStream);
    expect(buffer.replay('primary', 1, 8)).toEqual({ events: [newStream], requiresFullRefresh: true });
    expect(buffer.replay('primary', 2, 8)).toEqual({ events: [newStream], requiresFullRefresh: true });
  });
});
