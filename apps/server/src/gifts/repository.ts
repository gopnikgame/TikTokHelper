import { and, desc, eq, sql } from 'drizzle-orm';
import type { GiftEvent, ObservedGift } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { observedGifts, workspaces } from '../db/schema.js';

export interface GiftCatalogRepository {
  observe(workspaceId: string, gift: GiftEvent): Promise<void>;
  list(workspaceId: string): Promise<ObservedGift[]>;
  exists(workspaceId: string, giftId: string): Promise<boolean>;
}

function view(row: typeof observedGifts.$inferSelect): ObservedGift {
  return { ...row, firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString() };
}

export function createGiftCatalogRepository(db: Database): GiftCatalogRepository {
  return {
    async observe(workspaceId, gift) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      await db.insert(observedGifts).values({
        workspaceId, giftId: gift.giftId, giftName: gift.giftName,
        imageUrl: gift.imageUrl ?? null, diamondCount: gift.diamondCount ?? null,
      }).onConflictDoUpdate({
        target: [observedGifts.workspaceId, observedGifts.giftId],
        set: {
          giftName: gift.giftName,
          imageUrl: gift.imageUrl ? gift.imageUrl : sql`${observedGifts.imageUrl}`,
          diamondCount: gift.diamondCount === undefined ? sql`${observedGifts.diamondCount}` : gift.diamondCount,
          lastSeenAt: new Date(),
        },
      });
    },
    async list(workspaceId) {
      const rows = await db.select().from(observedGifts)
        .where(eq(observedGifts.workspaceId, workspaceId)).orderBy(desc(observedGifts.lastSeenAt));
      return rows.map(view);
    },
    async exists(workspaceId, giftId) {
      const [row] = await db.select({ giftId: observedGifts.giftId }).from(observedGifts)
        .where(and(eq(observedGifts.workspaceId, workspaceId), eq(observedGifts.giftId, giftId))).limit(1);
      return Boolean(row);
    },
  };
}
