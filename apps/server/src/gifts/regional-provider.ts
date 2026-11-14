import type { RegionalGift, RegionalGiftRegion } from '@tiktok-helper/contracts';

const CATALOG_ENDPOINT = 'https://api.eulerstream.com/webcast/gifts';
const CATALOG_STORAGE = /^eulerstream-tiktok\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/;
const MAX_LINK_BYTES = 16 * 1024;
const MAX_CATALOG_BYTES = 20 * 1024 * 1024;
const MAX_GIFTS = 5_000;
const MAX_RETRY_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;

export class RegionalGiftProviderError extends Error {
  constructor(readonly kind: 'rate_limited' | 'unavailable', readonly retryAfterMs?: number) {
    super(kind === 'rate_limited' ? 'Regional gift provider rate limit exceeded' : 'Regional gift catalog unavailable');
    this.name = 'RegionalGiftProviderError';
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function httpsUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 4_096) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash) return url;
  } catch { /* The provider may omit or supply an invalid URL. */ }
  return undefined;
}

function retryDelay(value: string | null): number | undefined {
  if (!value) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, delay)) : undefined;
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (response.status !== 200 || response.redirected) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      throw new RegionalGiftProviderError('rate_limited', retryDelay(response.headers.get('retry-after')));
    }
    throw new RegionalGiftProviderError('unavailable');
  }
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new RegionalGiftProviderError('unavailable');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new RegionalGiftProviderError('unavailable');
      }
      chunks.push(chunk.value);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
    return JSON.parse(text) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function giftId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)) return value;
  return undefined;
}

function giftImage(...images: unknown[]): string | null {
  for (const value of images) {
    const image = record(value);
    const urls = image?.url_list ?? image?.urlList;
    if (!Array.isArray(urls)) continue;
    for (const candidate of urls) {
      const url = httpsUrl(candidate);
      if (url && (url.hostname === 'tiktokcdn.com' || url.hostname.endsWith('.tiktokcdn.com'))) return url.href;
    }
  }
  return null;
}

function normalizeCatalog(payload: unknown): RegionalGift[] {
  const items = record(record(payload)?.data)?.gifts;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_GIFTS) {
    throw new RegionalGiftProviderError('unavailable');
  }

  const gifts = new Map<string, RegionalGift>();
  for (const value of items) {
    const item = record(value);
    const id = giftId(item?.id);
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!id || !name || name.length > 160 || !name.isWellFormed() || name.includes('\0')) {
      throw new RegionalGiftProviderError('unavailable');
    }
    const previous = gifts.get(id);
    const price = item?.diamond_count;
    const diamondCount = typeof price === 'number' && Number.isInteger(price) && price >= 0 && price <= 2_147_483_647
      ? price : null;
    gifts.set(id, {
      giftId: id,
      giftName: previous?.giftName ?? name,
      imageUrl: previous?.imageUrl ?? giftImage(item?.image, item?.icon, item?.preview_image),
      diamondCount: previous?.diamondCount ?? diamondCount,
    });
  }
  return [...gifts.values()];
}

export async function fetchRegionalGifts(
  region: RegionalGiftRegion,
  apiKey?: string,
  fetcher: typeof fetch = fetch,
): Promise<RegionalGift[]> {
  const endpoint = new URL(CATALOG_ENDPOINT);
  endpoint.searchParams.set('region', region);
  const options = { redirect: 'error', signal: AbortSignal.timeout(12_000) } as const;
  try {
    const headers = new Headers({ accept: 'application/json' });
    if (apiKey) headers.set('x-api-key', apiKey);
    const linkResponse = await fetcher(endpoint, { ...options, headers });
    const link = record(await readJson(linkResponse, MAX_LINK_BYTES));
    const downloadUrl = httpsUrl(link?.url);
    if (link?.code !== 200 || !downloadUrl || !CATALOG_STORAGE.test(downloadUrl.hostname) || downloadUrl.pathname === '/') {
      throw new RegionalGiftProviderError('unavailable');
    }
    const catalogResponse = await fetcher(downloadUrl, { ...options, headers: { accept: 'application/json' } });
    return normalizeCatalog(await readJson(catalogResponse, MAX_CATALOG_BYTES));
  } catch (error) {
    if (error instanceof RegionalGiftProviderError) throw error;
    throw new RegionalGiftProviderError('unavailable');
  }
}
