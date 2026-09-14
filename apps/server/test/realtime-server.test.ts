import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents, CommandAcknowledgement, ServerToClientEvents,
} from '@tiktok-helper/contracts';
import { buildApp } from '../src/app.js';
import { RecentEventBuffer } from '../src/realtime/buffer.js';
import { attachRealtimeServer } from '../src/realtime/server.js';
import { TikTokSessionManager } from '../src/tiktok/session-manager.js';
import type { ConnectorEventMap, LiveConnector } from '../src/tiktok/types.js';

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

async function setup(authorizeWorkspace = (workspaceId: string) => workspaceId === 'primary') {
  const connector = new FakeConnector();
  const events: Parameters<ReturnType<typeof attachRealtimeServer>['publish']>[] = [];
  let publish: ReturnType<typeof attachRealtimeServer>['publish'] = () => undefined;
  const manager = new TikTokSessionManager(() => connector, (workspaceId, event) => {
    events.push([workspaceId, event]); publish(workspaceId, event);
  });
  const app = buildApp({ logger: false, tiktokManager: manager });
  apps.add(app);
  const realtime = attachRealtimeServer(app, manager, { authorizeWorkspace, bufferCapacity: 2 });
  publish = realtime.publish;
  app.addHook('preClose', async () => realtime.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client: Socket<ServerToClientEvents, ClientToServerEvents> = createClient(address, {
    transports: ['websocket'], forceNew: true,
  });
  clients.add(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve); client.once('connect_error', reject);
  });
  return { app, client, connector, manager, realtime, events };
}

function subscribe(
  client: Socket<ServerToClientEvents, ClientToServerEvents>, workspaceId: string,
): Promise<CommandAcknowledgement> {
  return new Promise((resolve) => client.emit('workspace:subscribe', {
    commandId: randomUUID(), workspaceId,
  }, resolve));
}

describe('realtime server', () => {
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
  it('is bounded and signals a sequence gap it can no longer fill', () => {
    const buffer = new RecentEventBuffer(2);
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      buffer.add('primary', { type: 'connection.state', generation: 1, sequence, state: 'live' });
    }
    expect(buffer.replay('primary', 1, 0)).toEqual({ events: [], requiresFullRefresh: true });
    expect(buffer.replay('primary', 1, 1).events.map((event) => event.sequence)).toEqual([2, 3]);
  });
});
