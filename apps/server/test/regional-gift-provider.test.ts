import { describe, expect, it, vi } from 'vitest';
import { fetchRegionalGifts, RegionalGiftProviderError } from '../src/gifts/regional-provider.js';

const storageHost = 'eulerstream-tiktok.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
const catalogUrl = `https://${storageHost}/catalog/BY.json`;
const cdnImage = 'https://p16-webcast.tiktokcdn.com/gifts/rose.png';

function ticket(url = catalogUrl): Response {
  return Response.json({ code: 200, url });
}

describe('regional gift provider', () => {
  it('loads a region and only sends the optional key to the catalog API', async () => {
    const catalog = Response.json({ data: { gifts: [
      { id: 5655, name: ' Rose ', image: { url_list: ['http://p16-webcast.tiktokcdn.com/rose'] }, diamond_count: 0 },
      { id: '5655', name: 'Rose variant', icon: { url_list: [cdnImage] }, diamond_count: 2 },
      { id: 9142, name: ' Star ', image: { urlList: [cdnImage] }, animation: 'discarded' },
      { id: 1062, name: 'Heart', image: { url_list: ['https://tiktokcdn.com.example.com/heart'] }, diamond_count: 2_147_483_648 },
    ] } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(ticket()).mockResolvedValueOnce(catalog);

    const gifts = await fetchRegionalGifts('BY', 'fixture-key', fetcher);

    expect(gifts).toEqual([
      { giftId: '5655', giftName: 'Rose', imageUrl: cdnImage, diamondCount: 0 },
      { giftId: '9142', giftName: 'Star', imageUrl: cdnImage, diamondCount: null },
      { giftId: '1062', giftName: 'Heart', imageUrl: null, diamondCount: null },
    ]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.eulerstream.com/webcast/gifts?region=BY', catalogUrl,
    ]);
    const request = fetcher.mock.calls[0]?.[1];
    const download = fetcher.mock.calls[1]?.[1];
    expect(request?.redirect).toBe('error');
    expect(download?.redirect).toBe('error');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(download?.signal).toBe(request?.signal);
    expect(new Headers(request?.headers).get('x-api-key')).toBe('fixture-key');
    expect(new Headers(download?.headers).has('x-api-key')).toBe(false);
  });

  it.each([
    'https://169.254.169.254/catalog.json',
    `https://${storageHost}.example.com/catalog.json`,
    `https://untrusted@${storageHost}/catalog.json`,
    `http://${storageHost}/catalog.json`,
    `https://${storageHost}:8443/catalog.json`,
    `https://${storageHost}/`,
  ])('rejects an unsafe catalog download URL before making the second request (%s)', async (url) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(ticket(url));
    await expect(fetchRegionalGifts('US', undefined, fetcher)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('x-api-key')).toBe(false);
  });

  it.each([
    { label: 'empty', gifts: [] },
    { label: 'invalid ID', gifts: [{ id: '0', name: 'Missing gift' }] },
    { label: 'empty name', gifts: [{ id: 5655, name: ' ' }] },
    { label: 'ill-formed name', gifts: [{ id: 5655, name: '\ud800' }] },
  ])('rejects the catalog with $label instead of replacing the snapshot', async ({ gifts }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(ticket())
      .mockResolvedValueOnce(Response.json({ data: { gifts } }));
    await expect(fetchRegionalGifts('CA', undefined, fetcher)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('parses a rate limit before downloading the catalog', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({}, {
      status: 429, headers: { 'retry-after': '120' },
    }));
    await expect(fetchRegionalGifts('AE', undefined, fetcher)).rejects.toMatchObject({
      kind: 'rate_limited', retryAfterMs: 120_000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on the download and does not surface its URL or error body', async () => {
    const retryAt = new Date(Date.now() + 120_000).toUTCString();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(ticket(`${catalogUrl}?signature=opaque-fixture`))
      .mockResolvedValueOnce(Response.json({ internal: 'provider detail' }, { status: 429, headers: { 'retry-after': retryAt } }));
    const error: unknown = await fetchRegionalGifts('DE', undefined, fetcher).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RegionalGiftProviderError);
    expect(error).toMatchObject({ kind: 'rate_limited', message: 'Regional gift provider rate limit exceeded' });
    expect((error as RegionalGiftProviderError).retryAfterMs).toBeGreaterThan(110_000);
    expect(error).not.toHaveProperty('cause');
  });

  it('rejects an oversized streamed response without trusting Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); controller.close(); },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream));
    await expect(fetchRegionalGifts('US', undefined, fetcher)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not expose transport errors that contain the signed URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(ticket())
      .mockRejectedValueOnce(new Error(`${catalogUrl}?signature=opaque-fixture`));
    const error: unknown = await fetchRegionalGifts('DE', undefined, fetcher).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind: 'unavailable', message: 'Regional gift catalog unavailable' });
    expect(error).not.toHaveProperty('cause');
  });
});
