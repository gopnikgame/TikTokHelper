import type { SoundAsset } from '@tiktok-helper/contracts';
import { AudioAssetCache, soundIdentity } from './asset-cache.js';
import { AudioBufferStore } from './buffer-store.js';

export interface ManagedPlaybackHandle { durationMs: number; stop(): void }

export class ManagedAudioPlayback {
  readonly #assetCache = new AudioAssetCache();
  readonly #buffers = new AudioBufferStore();
  readonly #decoding = new Map<string, Promise<AudioBuffer>>();
  #context: AudioContext | null = null;

  async enable(): Promise<void> {
    this.#context ??= new AudioContext();
    if (this.#context.state === 'suspended') await this.#context.resume();
    if (this.#context.state !== 'running') throw new Error('Web Audio is unavailable');
  }

  async play(sound: SoundAsset, volumePercent: number, onEnded: () => void): Promise<ManagedPlaybackHandle> {
    const context = this.#context;
    if (!context || context.state !== 'running' || sound.status !== 'active') throw new Error('Managed playback is unavailable');
    const buffer = await this.#loadBuffer(sound, context);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.min(1, Math.max(0, volumePercent / 100));
    source.connect(gain); gain.connect(context.destination);
    source.addEventListener('ended', onEnded, { once: true });
    source.start();
    return { durationMs: buffer.duration * 1_000, stop: () => { try { source.stop(); } catch { /* already stopped */ } } };
  }

  async warm(sounds: readonly SoundAsset[], concurrency = 2): Promise<{ prepared: number; failed: number }> {
    const context = this.#context;
    if (!context || context.state !== 'running') return { prepared: 0, failed: sounds.length };
    let cursor = 0;
    let prepared = 0; let failed = 0;
    const worker = async () => {
      while (cursor < sounds.length) {
        const sound = sounds[cursor++];
        if (!sound || sound.status !== 'active') continue;
        try { await this.#loadBuffer(sound, context); prepared += 1; } catch { failed += 1; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, sounds.length) }, worker));
    return { prepared, failed };
  }

  async reconcile(eligible: readonly SoundAsset[]): Promise<void> {
    const identities = new Set(eligible.filter((sound) => sound.status === 'active').map(soundIdentity));
    this.#buffers.retain(identities);
    await this.#assetCache.prune(eligible);
  }

  async #loadBuffer(sound: SoundAsset, context: AudioContext): Promise<AudioBuffer> {
    const identity = soundIdentity(sound);
    const existing = this.#buffers.get(identity);
    if (existing) return existing;
    const inflight = this.#decoding.get(identity);
    if (inflight) return inflight;
    const decoding = this.#assetCache.load(sound)
      .then((bytes) => context.decodeAudioData(bytes.slice(0)))
      .then((buffer) => { this.#buffers.set(identity, buffer); return buffer; })
      .finally(() => this.#decoding.delete(identity));
    this.#decoding.set(identity, decoding);
    return decoding;
  }
}
