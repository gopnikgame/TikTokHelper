import { desc, eq, sql } from 'drizzle-orm';
import type { GiftEvent, ObservedGift } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { giftCatalog, workspaces } from '../db/schema.js';

export interface GiftCatalogRepository {
  observe(workspaceId: string, gift: GiftEvent): Promise<void>;
  list(workspaceId: string): Promise<ObservedGift[]>;
  exists(workspaceId: string, giftId: string): Promise<boolean>;
}

function view(row: typeof giftCatalog.$inferSelect): ObservedGift {
  return { ...row, firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString() };
}

export function createGiftCatalogRepository(db: Database): GiftCatalogRepository {
  return {
    async observe(workspaceId, gift) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      await db.insert(giftCatalog).values({
        firstSeenWorkspaceId: workspaceId, giftId: gift.giftId, giftName: gift.giftName,
        imageUrl: gift.imageUrl ?? null, diamondCount: gift.diamondCount ?? null,
      }).onConflictDoUpdate({
        target: giftCatalog.giftId,
        set: {
          giftName: gift.giftName,
          imageUrl: gift.imageUrl ? gift.imageUrl : sql`${giftCatalog.imageUrl}`,
          diamondCount: gift.diamondCount === undefined ? sql`${giftCatalog.diamondCount}` : gift.diamondCount,
          lastSeenAt: new Date(),
        },
      });
    },
    async list() {
      const rows = await db.select().from(giftCatalog).orderBy(desc(giftCatalog.lastSeenAt));
      return rows.map(view);
    },
    async exists(workspaceId, giftId) {
      void workspaceId;
      const [row] = await db.select({ giftId: giftCatalog.giftId }).from(giftCatalog)
        .where(eq(giftCatalog.giftId, giftId)).limit(1);
      return Boolean(row);
    },
  };
}
