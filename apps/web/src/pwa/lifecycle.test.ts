import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { genericInstallInstructions, updateBlockedByLive } from './lifecycle.js';

describe('PWA lifecycle policy', () => {
  it('blocks an update while a LIVE can be active or reconnecting', () => {
    expect(updateBlockedByLive('connecting')).toBe(true);
    expect(updateBlockedByLive('live')).toBe(true);
    expect(updateBlockedByLive('reconnecting')).toBe(true);
    expect(updateBlockedByLive('stopped')).toBe(false);
    expect(updateBlockedByLive('offline')).toBe(false);
    expect(updateBlockedByLive('failed')).toBe(false);
  });

  it('provides browser-neutral manual installation guidance', () => {
    expect(genericInstallInstructions()).toContain('Добавить на экран Домой');
  });

  it('keeps private runtime routes outside the service-worker cache', () => {
    const worker = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.pathname.startsWith('/socket.io/')");
    expect(worker).not.toContain('tiktok-helper-audio-v1');
    expect(worker).not.toContain('tiktok-helper-tts-models-v1');
    expect(worker).not.toContain('caches.match(');
  });

  it('does not activate a new worker during installation', () => {
    const worker = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
    const installHandler = worker.slice(worker.indexOf("self.addEventListener('install'"), worker.indexOf("self.addEventListener('activate'"));
    expect(installHandler).not.toContain('skipWaiting');
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'");
  });
});
