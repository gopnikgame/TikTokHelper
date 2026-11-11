import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { genericInstallInstructions, updateBlockedByLive } from './lifecycle.js';

const worker = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
const origin = 'https://example.test';
const mount = `${origin}/tiktokhelper/`;

function loadWorker(scope = mount) {
  const handlers = new Map<string, (event: object) => void>();
  const addAll = vi.fn<(urls: string[]) => Promise<void>>(async () => undefined);
  const offline = new Response('offline');
  const match = vi.fn<(request: string | Request) => Promise<Response>>(async () => offline);
  const put = vi.fn();
  const open = vi.fn<(name: string) => Promise<{ addAll: typeof addAll; match: typeof match; put: typeof put }>>(async () => ({ addAll, match, put }));
  const remove = vi.fn<(name: string) => Promise<boolean>>(async () => true);
  const skipWaiting = vi.fn(async () => undefined);
  const fetch = vi.fn(async () => new Response('network'));
  const previousCaches = ['vline-app-shell-v1', 'tiktok-helper-app-shell-v1', 'tiktok-helper-mounted-app-shell-v0', 'tiktok-helper-tts-models-v1'];
  runInNewContext(worker, {
    __SOURCE_REVISION__: 'test', URL, Response, fetch,
    caches: { open, delete: remove, keys: async () => previousCaches },
    self: { registration: { scope }, addEventListener: handlers.set.bind(handlers), clients: { claim: async () => undefined }, skipWaiting },
  });
  const dispatch = (eventName: string, properties = {}) => {
    const promise = vi.fn<(_response: Promise<unknown>) => void>();
    handlers.get(eventName)?.({ waitUntil: promise, respondWith: promise, ...properties });
    return promise.mock.calls[0]?.[0];
  };
  const request = (url: string, mode = 'same-origin') => dispatch('fetch', { request: { url, mode, method: 'GET', headers: new Headers() } });
  return { addAll, dispatch, fetch, match, open, put, remove, request, skipWaiting };
}

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

  it('precaches only inside its scope and cleans only older versions of its shell cache', async () => {
    const mounted = loadWorker();
    await mounted.dispatch('install');
    expect(mounted.open).toHaveBeenCalledWith('tiktok-helper-mounted-app-shell-v1');
    expect(mounted.addAll).toHaveBeenCalledWith(expect.arrayContaining([`${mount}offline.html`, `${mount}manifest.webmanifest`, `${mount}icons/icon-192.png`]));
    await mounted.dispatch('activate');
    expect(mounted.remove.mock.calls).toEqual([['tiktok-helper-mounted-app-shell-v0']]);

    const standalone = loadWorker(`${origin}/`);
    await standalone.dispatch('install');
    expect(standalone.open).toHaveBeenCalledWith('tiktok-helper-app-shell-v1');
    expect(standalone.addAll).toHaveBeenCalledWith(expect.arrayContaining([`${origin}/offline.html`, `${origin}/manifest.webmanifest`]));
  });

  it('keeps cabinet, auth, and socket requests out of its caches', () => {
    const { request, open } = loadWorker();
    expect(request(`${origin}/cabinet`, 'navigate')).toBeUndefined();
    expect(request(`${origin}/assets/cabinet.js`)).toBeUndefined();
    expect(request(`${mount}api/auth/session`)).toBeUndefined();
    expect(request(`${mount}auth/callback?code=synthetic`, 'navigate')).toBeUndefined();
    expect(request(`${mount}socket.io/?EIO=4`)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it('reads verified TTS files from their own cache and falls back to its scoped offline page', async () => {
    const { fetch, match, open, put, request } = loadWorker();
    await request(`${mount}tts-assets/voices/synthetic/model.js`);
    expect(open).toHaveBeenCalledWith('tiktok-helper-tts-models-v1');
    expect(put).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    fetch.mockRejectedValueOnce(new Error('offline'));
    await request(mount, 'navigate');
    expect(match).toHaveBeenLastCalledWith(`${mount}offline.html`);
  });

  it('activates an update only when a page in its scope requests it', async () => {
    const { dispatch, skipWaiting } = loadWorker();
    await dispatch('install');
    const data = { type: 'SKIP_WAITING' };
    dispatch('message', { data, source: { url: `${origin}/cabinet` } });
    expect(skipWaiting).not.toHaveBeenCalled();
    await dispatch('message', { data, source: { url: mount } });
    expect(skipWaiting).toHaveBeenCalledOnce();
  });
});
