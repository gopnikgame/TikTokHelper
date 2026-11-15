import type { PlaybackSettings } from '../audio/playback.js';

export type AudioProfileMode = 'normal' | 'quiet';

export interface QuietProfileOptions {
  volumeLimitPercent: number;
  speechEnabled: boolean;
}

export interface AudioProfileState {
  mode: AudioProfileMode;
  quiet: QuietProfileOptions;
}

export interface AudioProfileOutput {
  playback: PlaybackSettings;
  speechEnabled: boolean;
  speechVolumeLimit: number;
}

const defaultQuiet: QuietProfileOptions = { volumeLimitPercent: 25, speechEnabled: false };
type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(kind: 'localStorage' | 'sessionStorage'): ProfileStorage | undefined {
  try { return window[kind]; }
  catch { return undefined; }
}

function profileKey(workspaceId: string, part: 'mode' | 'quiet'): string {
  return `tiktok-helper.audio-profile.${part}.${encodeURIComponent(workspaceId)}`;
}

function readValue(storage: ProfileStorage | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null; }
  catch { return null; }
}

function writeValue(storage: ProfileStorage | undefined, key: string, value: string): boolean {
  if (!storage) return false;
  try { storage.setItem(key, value); return true; }
  catch { return false; }
}

function readQuiet(raw: string | null): QuietProfileOptions {
  if (!raw) return { ...defaultQuiet };
  try {
    const saved = JSON.parse(raw) as Partial<QuietProfileOptions> | null;
    const volume = saved?.volumeLimitPercent;
    return {
      volumeLimitPercent: typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100
        ? volume : defaultQuiet.volumeLimitPercent,
      speechEnabled: saved?.speechEnabled === true,
    };
  } catch {
    return { ...defaultQuiet };
  }
}

export function readAudioProfile(
  workspaceId: string,
  settingsStorage = browserStorage('localStorage'),
  modeStorage = browserStorage('sessionStorage'),
): AudioProfileState {
  return {
    mode: readValue(modeStorage, profileKey(workspaceId, 'mode')) === 'quiet' ? 'quiet' : 'normal',
    quiet: readQuiet(readValue(settingsStorage, profileKey(workspaceId, 'quiet'))),
  };
}

export function saveAudioProfileMode(workspaceId: string, mode: AudioProfileMode, storage = browserStorage('sessionStorage')): boolean {
  return writeValue(storage, profileKey(workspaceId, 'mode'), mode);
}

export function saveQuietProfileOptions(workspaceId: string, quiet: QuietProfileOptions, storage = browserStorage('localStorage')): boolean {
  return writeValue(storage, profileKey(workspaceId, 'quiet'), JSON.stringify(quiet));
}

export function resolveAudioProfile(settings: PlaybackSettings, profile: AudioProfileState): AudioProfileOutput {
  if (profile.mode === 'normal') {
    return { playback: settings, speechEnabled: true, speechVolumeLimit: 1 };
  }
  const { volumeLimitPercent, speechEnabled } = profile.quiet;
  return {
    playback: {
      playbackMode: 'sequential',
      overlapPercent: 0,
      maxConcurrentSounds: 1,
      volumePercent: Math.min(settings.volumePercent, volumeLimitPercent),
      requiresControlledVolume: true,
    },
    speechEnabled: speechEnabled && volumeLimitPercent > 0,
    speechVolumeLimit: volumeLimitPercent / 100,
  };
}
