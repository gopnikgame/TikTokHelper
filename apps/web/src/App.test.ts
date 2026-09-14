import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from './settings-model.js';
import { operatorEventCount } from './event-model.js';

describe('default workspace settings', () => {
  it('uses moderate overlap as the initial sound-series behavior', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      tiktokUsername: '',
      playbackMode: 'controlled_overlap',
      overlapPercent: 25,
      maxConcurrentSounds: 4,
      volumePercent: 80,
    });
  });
});

describe('operator event counter', () => {
  it('does not present reconnect state transitions as chat or gifts', () => {
    expect(operatorEventCount([
      { type: 'connection.state', generation: 1, sequence: 1, state: 'connecting' },
      { type: 'connection.state', generation: 1, sequence: 2, state: 'failed' },
      { type: 'chat.message', generation: 1, sequence: 3, eventId: 'chat-1', senderDisplayName: 'Viewer', senderUsername: 'viewer', text: 'Hello' },
    ])).toBe(1);
  });
});
