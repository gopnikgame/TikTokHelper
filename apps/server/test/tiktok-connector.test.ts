import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  BaseProtoMessage, CommonMessageData, deserializeMessage, ProtoMessageFetchResult, TikTokLiveConnection,
  User, WebcastChatMessage, WebcastGiftMessage, WebcastLikeMessage, WebcastRoomUserSeqMessage, WebcastSocialMessage,
} from 'tiktok-live-connector';
import { describe, expect, it, vi } from 'vitest';
import { createTikTokConnectorFactory } from '../src/tiktok/live-connector.js';
import { LiveActivity, normalizeLiveActivity } from '../src/tiktok/live-activity.js';

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

  it('returns the room ID from the successful connection state when present', async () => {
    const adapter = createTikTokConnectorFactory()('fixture_streamer');
    const connection = vi.mocked(TikTokLiveConnection).mock.instances.at(-1);
    if (!connection) throw new Error('Expected a connector instance');
    const state = { isConnected: true, isConnecting: false, roomInfo: null, availableGifts: null };
    vi.spyOn(connection, 'connect')
      .mockResolvedValueOnce({ ...state, roomId: ' 7286411200000000123 ' })
      .mockResolvedValueOnce({ ...state, roomId: '' });
    await expect(adapter.connect()).resolves.toBe('7286411200000000123');
    await expect(adapter.connect()).resolves.toBeUndefined();
  });

  it('preserves the signing history and WebSocket history flags on chat and gifts', async () => {
    const adapter = createTikTokConnectorFactory()('fixture_streamer');
    const connection = vi.mocked(TikTokLiveConnection).mock.instances.at(-1);
    if (!connection) throw new Error('Expected a connector instance');
    const onGift = vi.fn();
    const onChat = vi.fn();
    adapter.on('gift', onGift);
    adapter.on('chat', onChat);

    const batch = ProtoMessageFetchResult.decode(Buffer.alloc(0));
    const empty = BaseProtoMessage.decode(Buffer.alloc(0));
    const gift = WebcastGiftMessage.decode(Buffer.alloc(0));
    const chat = WebcastChatMessage.decode(Buffer.alloc(0));
    const ingest = (messages: ProtoMessageFetchResult['messages']) => connection['processProtoMessageFetchResult']({ ...batch, messages });
    await ingest([
      { ...empty, decodedData: { type: 'WebcastGiftMessage', data: gift } },
      { ...empty, decodedData: { type: 'WebcastChatMessage', data: chat } },
    ]);
    expect(onGift).toHaveBeenCalledExactlyOnceWith(gift, true);
    expect(onChat).toHaveBeenCalledExactlyOnceWith(chat, true);

    Object.defineProperty(connection, 'wsClient', { value: {} });
    const restoredGift = { ...gift, giftId: '5655' };
    const liveGift = { ...gift, giftId: '5655', repeatCount: 2 };
    const liveChat = { ...chat, content: 'Тестовая реплика' };
    await ingest([
      { ...empty, isHistory: true, decodedData: { type: 'WebcastGiftMessage', data: restoredGift } },
      { ...empty, decodedData: { type: 'WebcastGiftMessage', data: liveGift } },
      { ...empty, decodedData: { type: 'WebcastChatMessage', data: liveChat } },
    ]);
    expect(onGift.mock.calls).toEqual([[gift, true], [restoredGift, true], [liveGift, undefined]]);
    expect(onChat.mock.calls).toEqual([[chat, true], [liveChat, undefined]]);
  });

  it('delivers normalized viewer, like, follow and share events decoded from the v3 wire packets', async () => {
    const adapter = createTikTokConnectorFactory()('fixture_streamer');
    const connection = vi.mocked(TikTokLiveConnection).mock.instances.at(-1);
    if (!connection) throw new Error('Expected a connector instance');
    const activity = new LiveActivity({ targetCount: 5, revision: 1 });
    for (const kind of ['roomUser', 'like', 'follow', 'share'] as const) {
      adapter.on(kind, (raw, historical = false) => {
        const sample = normalizeLiveActivity(kind, raw, historical);
        if (sample) activity.apply(sample);
      });
    }
    const batch = ProtoMessageFetchResult.decode(Buffer.alloc(0));
    const empty = BaseProtoMessage.decode(Buffer.alloc(0));
    const ingest = (messages: ProtoMessageFetchResult['messages']) => connection['processProtoMessageFetchResult']({ ...batch, messages });
    const viewers = (total: string) => ({
      type: 'WebcastRoomUserSeqMessage' as const,
      data: deserializeMessage('WebcastRoomUserSeqMessage', Buffer.from(WebcastRoomUserSeqMessage.encode({
        ...WebcastRoomUserSeqMessage.decode(Buffer.alloc(0)), total, totalUser: '500', popularity: '900',
      }).finish())),
    });
    const likes = (total: string) => ({
      type: 'WebcastLikeMessage' as const,
      data: deserializeMessage('WebcastLikeMessage', Buffer.from(WebcastLikeMessage.encode({
        ...WebcastLikeMessage.decode(Buffer.alloc(0)), total, count: 100,
      }).finish())),
    });
    const social = (kind: string, msgId: string) => ({
      type: 'WebcastSocialMessage' as const,
      data: deserializeMessage('WebcastSocialMessage', Buffer.from(WebcastSocialMessage.encode({
        ...WebcastSocialMessage.decode(Buffer.alloc(0)),
        common: {
          ...CommonMessageData.decode(Buffer.alloc(0)), msgId,
          displayText: { key: `fixture_${kind}`, defaultPattern: '', defaultFormat: undefined, pieces: [] },
        },
        user: { ...User.decode(Buffer.alloc(0)), nickname: 'Зритель', displayId: 'fixture_private_viewer' },
      }).finish())),
    });
    const signingFollow = social('follow', '21');
    await ingest([
      { ...empty, decodedData: viewers('100') },
      { ...empty, decodedData: likes('15') },
      { ...empty, decodedData: signingFollow },
    ]);
    expect(activity.snapshot('family', 1, null)).toMatchObject({ viewers: null, totalLikes: null, recentActions: [] });
    Object.defineProperty(connection, 'wsClient', { value: {} });
    await ingest([
      { ...empty, decodedData: viewers('27') },
      { ...empty, decodedData: { type: 'WebcastRoomUserSeqMessage', data: WebcastRoomUserSeqMessage.decode(Buffer.alloc(0)) } },
      { ...empty, decodedData: likes('20') },
      { ...empty, isHistory: true, decodedData: likes('100') },
      { ...empty, isHistory: true, decodedData: social('share', '22') },
      { ...empty, decodedData: likes('27') },
      { ...empty, decodedData: social('follow', '21') },
      { ...empty, decodedData: social('share', '22') },
      { ...empty, decodedData: social('follow', '23') },
      { ...empty, decodedData: social('share', '24') },
    ]);
    expect(activity.snapshot('family', 1, null)).toMatchObject({
      viewers: 27, totalLikes: 27, likeGoal: { baselineLikes: 20 },
      recentActions: [{ kind: 'share', displayName: 'Зритель' }, { kind: 'follow', displayName: 'Зритель' }],
    });
    expect(JSON.stringify(activity.snapshot('family', 1, null))).not.toContain('fixture_private_viewer');
  });
});
