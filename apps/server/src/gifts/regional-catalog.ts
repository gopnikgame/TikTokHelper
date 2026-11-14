import { eq } from 'drizzle-orm';
import type { RegionalGift, RegionalGiftPage, RegionalGiftRegion } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { regionalGiftCatalog } from '../db/schema.js';
import { RegionalGiftProviderError } from './regional-provider.js';

type RegionalSnapshot = Omit<typeof regionalGiftCatalog.$inferSelect, 'region'>;

export interface RegionalGiftStore {
  read(region: RegionalGiftRegion): Promise<RegionalSnapshot | null>;
  write(region: RegionalGiftRegion, snapshot: RegionalSnapshot): Promise<void>;
}

export type RegionalGiftCatalogReader = Pick<RegionalGiftCatalog, 'search' | 'refresh' | 'find'>;

export function createRegionalGiftStore(db: Database): RegionalGiftStore {
  return {
    async read(region) {
      const { gifts, updatedAt, retryAt, lastError } = regionalGiftCatalog;
      const [row] = await db.select({ gifts, updatedAt, retryAt, lastError }).from(regionalGiftCatalog)
        .where(eq(regionalGiftCatalog.region, region));
      return row ?? null;
    },
    async write(region, snapshot) {
      await db.insert(regionalGiftCatalog).values({ ...snapshot, region })
        .onConflictDoUpdate({ target: regionalGiftCatalog.region, set: snapshot });
    },
  };
}

const pageSize = 24;
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const emptySnapshot: RegionalSnapshot = { gifts: [], updatedAt: null, retryAt: null, lastError: null };

export class RegionalGiftCatalog {
  readonly #snapshots = new Map<RegionalGiftRegion, Promise<RegionalSnapshot>>();
  readonly #refreshing = new Map<RegionalGiftRegion, Promise<void>>();
  #refreshQueue = Promise.resolve();
  #rateLimitedUntil = 0;

  constructor(
    private readonly store: RegionalGiftStore,
    private readonly fetchGifts: (region: RegionalGiftRegion) => Promise<RegionalGift[]>,
    private readonly now = Date.now,
  ) {}

  #read(region: RegionalGiftRegion): Promise<RegionalSnapshot> {
    const loaded = this.#snapshots.get(region);
    if (loaded) return loaded;
    const reading = this.store.read(region).then((snapshot) => snapshot ?? emptySnapshot).catch((error: unknown) => {
      this.#snapshots.delete(region);
      throw error;
    });
    this.#snapshots.set(region, reading);
    return reading;
  }

  #eligibleAt(snapshot: RegionalSnapshot, force: boolean): number {
    return Math.max(
      snapshot.updatedAt ? snapshot.updatedAt.getTime() + (force ? hour : day) : 0,
      snapshot.retryAt?.getTime() ?? 0,
      this.#rateLimitedUntil,
    );
  }

  async search(region: RegionalGiftRegion, query: string, page: number): Promise<RegionalGiftPage> {
    const snapshot = await this.#read(region);
    const term = query.trim().toLocaleLowerCase();
    const offset = (page - 1) * pageSize;
    const matches = term
      ? snapshot.gifts.filter((gift) => gift.giftId.includes(term) || gift.giftName.toLocaleLowerCase().includes(term))
      : snapshot.gifts;
    const exact = term ? matches.findIndex((gift) => gift.giftId === term) : -1;
    if (exact > 0) matches.unshift(...matches.splice(exact, 1));
    const next = this.#eligibleAt(snapshot, true);
    return {
      gifts: matches.slice(offset, offset + pageSize),
      hasMore: matches.length > offset + pageSize,
      updatedAt: snapshot.updatedAt?.toISOString() ?? null,
      status: this.#rateLimitedUntil > this.now() ? 'rate_limited'
        : snapshot.lastError ?? (snapshot.updatedAt ? 'ready' : 'empty'),
      canRefresh: next <= this.now() && !this.#refreshing.has(region),
      nextRefreshAt: next ? new Date(next).toISOString() : null,
    };
  }

  async find(region: RegionalGiftRegion, giftId: string): Promise<RegionalGift | undefined> {
    return (await this.#read(region)).gifts.find((gift) => gift.giftId === giftId);
  }

  refresh(region: RegionalGiftRegion, force: boolean): Promise<void> {
    const pending = this.#refreshing.get(region);
    if (pending) return pending;
    const refresh = this.#refreshQueue.then(() => this.#refresh(region, force))
      .finally(() => this.#refreshing.delete(region));
    this.#refreshQueue = refresh.catch(() => {});
    this.#refreshing.set(region, refresh);
    return refresh;
  }

  async #refresh(region: RegionalGiftRegion, force: boolean): Promise<void> {
    const current = await this.#read(region);
    if (this.#eligibleAt(current, force) > this.now()) return;

    let snapshot: RegionalSnapshot;
    try {
      const gifts = await this.fetchGifts(region);
      snapshot = { gifts, updatedAt: new Date(this.now()), lastError: null, retryAt: null };
    } catch (error) {
      if (!(error instanceof RegionalGiftProviderError)) throw error;
      const backoff = this.now() + Math.max(hour, error.retryAfterMs ?? 0);
      if (error.kind === 'rate_limited') this.#rateLimitedUntil = Math.max(this.#rateLimitedUntil, backoff);
      snapshot = { ...current, lastError: error.kind, retryAt: new Date(backoff) };
    }
    await this.store.write(region, snapshot);
    this.#snapshots.set(region, Promise.resolve(snapshot));
  }
}
