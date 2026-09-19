import { describe, expect, it, vi } from 'vitest';
import type { ClientToServerEvents, RealtimeSnapshot, ServerToClientEvents } from '@tiktok-helper/contracts';
import type { Socket } from 'socket.io-client';
import { createRealtimeClient, RealtimeStateModel } from './client.js';

const snapshot = (overrides: Partial<RealtimeSnapshot> = {}): RealtimeSnapshot => ({
  workspaceId: 'primary', generation: 2, lastSequence: 3, connectionState: 'live',
  replay: [], requiresFullRefresh: false, ...overrides,
});

describe('RealtimeStateModel', () => {
  it('tracks authenticated presence and clears a stale count on disconnect', () => {
    const model = new RealtimeStateModel();
    model.setTransportConnected(true);
    model.setOnlineUsers(3);
    expect(model.state.onlineUsers).toBe(3);
    model.setTransportConnected(false);
    expect(model.state.onlineUsers).toBeNull();
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
});

describe('realtime client commands', () => {
  it('resubscribes after a successful live connection changes the event generation', async () => {
    const handlers = new Map<string, () => void>();
    const emitted: string[] = [];
    const socket = {
      on(eventName: string, handler: () => void) { handlers.set(eventName, handler); return this; },
      emit(eventName: string, _payload: unknown, acknowledge?: (result: { ok: true }) => void) {
        emitted.push(eventName); acknowledge?.({ ok: true }); return this;
      },
      close: vi.fn(),
    } as unknown as Socket<ServerToClientEvents, ClientToServerEvents>;
    const client = createRealtimeClient('primary', () => undefined, socket);
    handlers.get('connect')?.();
    expect(emitted.filter((eventName) => eventName === 'workspace:subscribe')).toHaveLength(1);
    await client.connectLive('streamer');
    expect(emitted.filter((eventName) => eventName === 'workspace:subscribe')).toHaveLength(2);
  });

  it('delivers support-level grants to the browser automation handler', () => {
    const handlers = new Map<string, (payload?: unknown) => void>();
    const socket = {
      on(eventName: string, handler: (payload?: unknown) => void) { handlers.set(eventName, handler); return this; },
      emit() { return this; }, close: vi.fn(),
    } as unknown as Socket<ServerToClientEvents, ClientToServerEvents>;
    const onGrant = vi.fn();
    createRealtimeClient('primary', () => undefined, socket, undefined, onGrant);
    const grant = {
      eventId: 'grant-1', workspaceId: 'primary', senderDisplayName: 'Viewer', senderUsername: 'viewer',
      levelId: '123e4567-e89b-42d3-a456-426614174000', levelName: 'Голос', thresholdPoints: 100,
      pointsAdded: 10, streamTotal: 100, lifetimeTotal: 100, expiresAt: null,
    };
    handlers.get('support:level-granted')?.(grant);
    expect(onGrant).toHaveBeenCalledWith(grant);
  });
});
