import type { UpdateWorkspaceSettings } from '@tiktok-helper/contracts';

export const DEFAULT_SETTINGS: UpdateWorkspaceSettings = {
  tiktokUsername: '',
  playbackMode: 'controlled_overlap',
  overlapPercent: 25,
  maxConcurrentSounds: 4,
  volumePercent: 80,
};
