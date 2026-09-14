import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from './settings-model.js';

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
