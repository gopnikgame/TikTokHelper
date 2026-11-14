import { describe, expect, it, vi } from 'vitest';
import type { RegionalGift, RegionalGiftRegion } from '@tiktok-helper/contracts';

import { RegionalGiftCatalog, type RegionalGiftStore } from '../src/gifts/regional-catalog.js';
import { RegionalGiftProviderError } from '../src/gifts/regional-provider.js';

const hour = 3_600_000;
const firstGift: RegionalGift = { giftId: '302', giftName: 'Test Rose', imageUrl: null, diamondCount: 1 };
const newGift: RegionalGift = { giftId: '30', giftName: 'New Rose', imageUrl: 'https://cdn.tiktokcdn.com/gift.png', diamondCount: 2 };

function fixture() {
  let now = Date.UTC(2026, 10, 15);
  const data = new Map<RegionalGiftRegion, Parameters<RegionalGiftStore['write']>[1]>();
  const store: RegionalGiftStore = {
    async read(region) { return data.get(region) ?? null; },
    async write(region, snapshot) { data.set(region, snapshot); },
  };
  const fetchGifts = vi.fn<(region: RegionalGiftRegion) => Promise<RegionalGift[]>>().mockResolvedValue([firstGift]);
  const build = () => new RegionalGiftCatalog(store, fetchGifts, () => now);
  return { build, fetchGifts, advance: (ms: number) => { now += ms; } };
}

describe('regional gift snapshots', () => {
  it('coalesces concurrent refreshes, observes freshness and picks up new gifts', async () => {
    const { build, fetchGifts, advance } = fixture();
    const catalog = build();
    expect(await catalog.search('US', '', 1)).toMatchObject({ status: 'empty', canRefresh: true });
    const refresh = catalog.refresh('US', false);
    expect(catalog.refresh('US', true)).toBe(refresh);
    await refresh;
    await catalog.refresh('US', true);
    advance(23 * hour);
    await catalog.refresh('US', false);
    expect(fetchGifts).toHaveBeenCalledExactlyOnceWith('US');
    expect((await build().search('US', 'rose', 1)).gifts).toEqual([firstGift]);
    expect((await catalog.search('CA', '', 1)).gifts).toEqual([]);

    advance(hour);
    fetchGifts.mockResolvedValueOnce([firstGift, newGift]);
    await catalog.refresh('US', false);
    expect((await catalog.search('US', '30', 1)).gifts).toEqual([newGift, firstGift]);
    expect(await catalog.find('US', newGift.giftId)).toEqual(newGift);
    expect(await catalog.find('CA', newGift.giftId)).toBeUndefined();
  });

  it('keeps the previous list through provider errors and honors Retry-After', async () => {
    const { build, fetchGifts, advance } = fixture();
    const catalog = build();
    await catalog.refresh('BY', false);
    advance(hour);
    fetchGifts.mockRejectedValueOnce(new RegionalGiftProviderError('rate_limited', 2 * hour));
    await catalog.refresh('BY', true);
    const stale = await catalog.search('BY', '', 1);
    expect(stale).toMatchObject({ status: 'rate_limited', gifts: [firstGift], canRefresh: false });
    await catalog.refresh('AE', false);
    await build().refresh('BY', true);
    expect(fetchGifts).toHaveBeenCalledTimes(2);

    advance(2 * hour);
    fetchGifts.mockRejectedValueOnce(new RegionalGiftProviderError('unavailable'));
    await catalog.refresh('BY', true);
    expect(await build().search('BY', '', 1)).toMatchObject({
      status: 'unavailable', gifts: [firstGift], updatedAt: stale.updatedAt, canRefresh: false,
    });
    advance(hour);
    fetchGifts.mockResolvedValueOnce([newGift]);
    await catalog.refresh('BY', true);
    expect(await catalog.search('BY', '', 1)).toMatchObject({ status: 'ready', gifts: [newGift] });
  });

  it('downloads one region at a time even when several are opened in quick succession', async () => {
    const { build, fetchGifts } = fixture();
    let resolveDownload!: (gifts: RegionalGift[]) => void;
    fetchGifts.mockImplementationOnce(() => new Promise((resolve) => { resolveDownload = resolve; }));
    const catalog = build();
    const us = catalog.refresh('US', false);
    const de = catalog.refresh('DE', false);
    await vi.waitFor(() => expect(fetchGifts).toHaveBeenCalledExactlyOnceWith('US'));
    resolveDownload([firstGift]);
    await Promise.all([us, de]);
    expect(fetchGifts.mock.calls).toEqual([['US'], ['DE']]);
  });

  it('limits page size and keeps later results reachable', async () => {
    const { build, fetchGifts } = fixture();
    fetchGifts.mockResolvedValueOnce(Array.from({ length: 25 }, (_, index) => ({
      ...firstGift, giftId: String(index + 1),
    })));
    const catalog = build();
    await catalog.refresh('DE', false);
    const first = await catalog.search('DE', '', 1);
    expect(first.gifts).toHaveLength(24);
    expect(first.hasMore).toBe(true);
    expect(await catalog.search('DE', '', 2)).toMatchObject({ gifts: [{ giftId: '25' }], hasMore: false });
    expect((await catalog.search('DE', '25', 1)).gifts[0]?.giftId).toBe('25');
  });
});
