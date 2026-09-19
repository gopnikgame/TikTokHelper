import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpIdentityBridge } from '../src/auth/bridge-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP identity bridge', () => {
  it('revalidates through the entitlement route next to a prefixed token route', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(JSON.stringify({
        allowed: true, reason: 'active_subscription', validUntil: 1_800_000_000_000,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const bridge = new HttpIdentityBridge(
      'https://vline.online/integrations/tiktok-helper/token',
      'tiktok-helper', 'secret', 'https://tiktok.vpnline.online/auth/callback',
    );

    await expect(bridge.checkAccess('123e4567-e89b-42d3-a456-426614174000')).resolves.toEqual({
      allowed: true, reason: 'active_subscription', validUntil: 1_800_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://vline.online/integrations/tiktok-helper/entitlement');
  });
});
