import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
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
  const observed = and(isNotNull(giftCatalog.firstSeenAt), isNotNull(giftCatalog.lastSeenAt));
  return {
    async observe(workspaceId, gift) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      await db.insert(giftCatalog).values({
        firstSeenWorkspaceId: workspaceId, giftId: gift.giftId, giftName: gift.giftName,
        imageUrl: gift.imageUrl ?? null, diamondCount: gift.diamondCount ?? null,
      }).onConflictDoUpdate({
        target: giftCatalog.giftId,
        set: {
          giftName: gift.giftName === gift.giftId ? sql`${giftCatalog.giftName}` : gift.giftName,
          imageUrl: gift.imageUrl ? gift.imageUrl : sql`${giftCatalog.imageUrl}`,
          diamondCount: gift.diamondCount === undefined ? sql`${giftCatalog.diamondCount}` : gift.diamondCount,
          firstSeenWorkspaceId: sql`case when ${giftCatalog.firstSeenAt} is null then excluded.first_seen_workspace_id else ${giftCatalog.firstSeenWorkspaceId} end`,
          firstSeenAt: sql`coalesce(${giftCatalog.firstSeenAt}, excluded.first_seen_at)`,
          lastSeenAt: new Date(),
        },
      });
    },
    async list() {
      const rows = await db.select().from(giftCatalog).where(observed).orderBy(desc(giftCatalog.lastSeenAt));
      return rows.map(view);
    },
    async exists(workspaceId, giftId) {
      void workspaceId;
      const [row] = await db.select({ giftId: giftCatalog.giftId }).from(giftCatalog)
        .where(and(eq(giftCatalog.giftId, giftId), observed)).limit(1);
      return Boolean(row);
    },
  };
}
