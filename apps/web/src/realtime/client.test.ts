import { describe, expect, it } from 'vitest';
import type { RealtimeSnapshot } from '@tiktok-helper/contracts';
import { RealtimeStateModel } from './client.js';

const snapshot = (overrides: Partial<RealtimeSnapshot> = {}): RealtimeSnapshot => ({
  workspaceId: 'primary', generation: 2, lastSequence: 3, connectionState: 'live',
  replay: [], requiresFullRefresh: false, ...overrides,
});

describe('RealtimeStateModel', () => {
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
