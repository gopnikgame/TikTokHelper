import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { TikTokLiveConnection } from 'tiktok-live-connector';
import { describe, expect, it, vi } from 'vitest';
import { createTikTokConnectorFactory } from '../src/tiktok/live-connector.js';

vi.mock(import('tiktok-live-connector'), async (importOriginal) => {
  const connector = await importOriginal();
  return {
    ...connector,
    TikTokLiveConnection: vi.fn(class extends connector.TikTokLiveConnection {}),
  };
});

function connectionOptions(proxyUrl?: string) {
  createTikTokConnectorFactory(proxyUrl)('fixture_streamer');
  return vi.mocked(TikTokLiveConnection).mock.lastCall?.[1];
}

describe('TikTok connector transport', () => {
  it.each([undefined, ''])('uses the direct connection by default (%s)', (proxyUrl) => {
    const options = connectionOptions(proxyUrl);
    expect(options).toMatchObject({ enableExtendedGiftInfo: false, processInitialData: true });
    expect(options?.webClientOptions).toBeUndefined();
    expect(options?.wsClientOptions).toBeUndefined();
  });

  it.each(['http', 'https'])('uses the proper HTTP and CONNECT agents for a %s proxy', (scheme) => {
    const options = connectionOptions(`${scheme}://127.0.0.1:8080`);
    expect(options?.webClientOptions).toMatchObject({
      http2: false,
      agent: { http: expect.any(HttpProxyAgent), https: expect.any(HttpsProxyAgent) },
    });
    expect(options?.wsClientOptions?.agent).toBe(options?.webClientOptions?.agent?.https);
  });

  it.each(['socks', 'socks4', 'socks4a', 'socks5', 'socks5h'])('uses SOCKS for both clients (%s)', (scheme) => {
    const options = connectionOptions(`${scheme}://127.0.0.1:1080`);
    const agent = options?.webClientOptions?.agent?.http;
    expect(agent).toBeInstanceOf(SocksProxyAgent);
    expect(options?.webClientOptions?.agent?.https).toBe(agent);
    expect(options?.wsClientOptions?.agent).toBe(agent);
    expect(options?.webClientOptions?.http2).toBe(false);
  });

  it.each([
    'pac+ftp://fixture.invalid/proxy.pac',
    'PAC+FTP://fixture.invalid/proxy.pac',
    'pac+https://fixture.invalid/proxy.pac',
    'ftp://fixture.invalid/proxy.pac',
    'socks5:missing-host',
    'not a URL',
  ])('rejects an unsupported or invalid proxy at startup (%s)', (proxyUrl) => {
    expect(() => createTikTokConnectorFactory(proxyUrl)).toThrow(
      /^TIKTOK_PROXY_URL must be an HTTP\(S\) or SOCKS proxy URL$/,
    );
  });

  it('rejects incorrectly escaped credentials during config validation', () => {
    expect(() => createTikTokConnectorFactory('socks5://fixture-user:%FF@127.0.0.1:1080')).toThrow(
      /^TIKTOK_PROXY_URL contains invalid proxy credentials$/,
    );
  });

  it('closes a pending WebSocket after a rejected upgrade', async () => {
    const adapter = createTikTokConnectorFactory()('fixture_streamer');
    const connection = vi.mocked(TikTokLiveConnection).mock.instances.at(-1);
    if (!connection) throw new Error('Expected a connector instance');
    const terminate = vi.fn();
    Object.defineProperty(connection, 'wsClient', { value: { readyState: 0, CONNECTING: 0, terminate } });
    const failure = new Error('Synthetic upgrade rejection');
    vi.spyOn(connection, 'connect').mockRejectedValue(failure);
    await expect(adapter.connect()).rejects.toBe(failure);
    expect(terminate).toHaveBeenCalledOnce();
  });
});
