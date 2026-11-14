import { describe, expect, it, vi } from 'vitest';
import { GiftGoalRuntime } from '../src/gift-goals/runtime.js';

const workspaceId = 'family';
const connectionId = '11111111-1111-4111-8111-111111111111';
const soundAssetId = '22222222-2222-4222-8222-222222222222';
const configuration = { giftId: 'rose', targetCount: 4, soundAssetId, revision: 1, isEnabled: true };
const liveStatus = () => ({ workspaceId, generation: 1, lastSequence: 2, state: 'live' as const, connectionId, tiktokUsername: 'fixture' });

describe('gift goal runtime', () => {
  it('coalesces ordinary progress but publishes a milestone immediately', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const runtime = new GiftGoalRuntime({ get: async () => configuration }, liveStatus, publish);
    try {
      runtime.configure(workspaceId, configuration);
      publish.mockClear();
      const send = (sequence: number, repeatCount: number) => runtime.observe(workspaceId, connectionId, {
        type: 'gift.received', eventId: `gift-${sequence}`, generation: 1, sequence,
        giftId: 'rose', giftName: 'Rose', senderDisplayName: 'Viewer', senderUsername: 'viewer', repeatCount,
      }, 'fixture-private');
      send(3, 1);
      send(4, 2);
      expect(runtime.snapshot(workspaceId)?.progress).toBe(3);
      expect(publish).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(publish).toHaveBeenCalledExactlyOnceWith({ state: expect.objectContaining({ progress: 3 }) });

      send(5, 3);
      send(5, 3);
      vi.advanceTimersByTime(250);
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish).toHaveBeenLastCalledWith({ state: expect.objectContaining({ progress: 6 }), reached: true });
    } finally {
      runtime.close();
      vi.useRealTimers();
    }
  });

  it('applies a removed sound to its workspaces without clearing their progress', async () => {
    const get = vi.fn(async () => ({ ...configuration, soundAssetId: null }));
    const publish = vi.fn();
    const runtime = new GiftGoalRuntime({ get }, liveStatus, publish);
    runtime.configure(workspaceId, configuration);
    runtime.configure('other', { ...configuration, soundAssetId: null });
    runtime.observe(workspaceId, connectionId, {
      type: 'gift.received', eventId: 'gift-3', generation: 1, sequence: 3,
      giftId: 'rose', giftName: 'Rose', senderDisplayName: 'Viewer', senderUsername: 'viewer', repeatCount: 3,
    }, 'fixture-private');
    await runtime.refreshSound(soundAssetId);
    expect(get).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expect(runtime.snapshot(workspaceId)).toMatchObject({ progress: 3, configuration: { soundAssetId: null } });
    expect(publish).toHaveBeenLastCalledWith({ state: expect.objectContaining({ progress: 3 }) });
    runtime.close();
  });
});
