import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from './settings-model.js';
import { operatorEventCount } from './event-model.js';
import { loadSession } from './auth-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('application session bootstrap', () => {
  it('treats 401 as a signed-out user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    await expect(loadSession()).resolves.toBeNull();
  });

  it('loads named workspaces without exposing a fixed primary workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      authenticated: true,
      mode: 'vline',
      user: { userId: '123e4567-e89b-42d3-a456-426614174000', displayName: 'Иван', workspaces: [{ id: 'workspace-1', displayName: 'Эфир жены' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(loadSession()).resolves.toMatchObject({ user: { workspaces: [{ displayName: 'Эфир жены' }] } });
  });
});

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
