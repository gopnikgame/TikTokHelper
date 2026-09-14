import { describe, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '@tiktok-helper/contracts';
import { TikTokSessionManager, type Scheduler } from '../src/tiktok/session-manager.js';
import type { ConnectorEventMap, LiveConnector } from '../src/tiktok/types.js';

class FakeConnector implements LiveConnector {
  readonly handlers = new Map<keyof ConnectorEventMap, Array<(event: never) => void>>();
  connect = vi.fn(async () => undefined);
  disconnect = vi.fn(async () => undefined);
  on<EventName extends keyof ConnectorEventMap>(eventName: EventName, handler: (event: ConnectorEventMap[EventName]) => void): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler as (event: never) => void);
    this.handlers.set(eventName, handlers);
  }
  emit<EventName extends keyof ConnectorEventMap>(eventName: EventName, event: ConnectorEventMap[EventName]): void {
    for (const handler of this.handlers.get(eventName) ?? []) handler(event as never);
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
      user: { id: '42', displayId: 'current_viewer', nickname: 'Current Viewer' },
      content: 'Current message',
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'chat.message', senderUsername: 'current_viewer', text: 'Current message',
    }));
  });

  it('turns a gift streak into incremental playback counts without double counting the final event', async () => {
    const connector = new FakeConnector();
    const events: RealtimeEvent[] = [];
    const manager = new TikTokSessionManager(() => connector, (_workspace, event) => events.push(event));
    await manager.start('family', 'streamer');
    connector.emit('gift', gift(1, false, 'gift-1'));
    connector.emit('gift', gift(3, false, 'gift-2'));
    connector.emit('gift', gift(3, true, 'gift-3'));
    connector.emit('gift', gift(3, true, 'gift-3'));
    expect(events.filter((event) => event.type === 'gift.received').map((event) => event.repeatCount)).toEqual([1, 2]);
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
