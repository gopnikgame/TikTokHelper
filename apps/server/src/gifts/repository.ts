import { and, desc, eq, exists, isNotNull, or, sql } from 'drizzle-orm';
import type { GiftEvent, ObservedGift } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { giftCatalog, giftSoundRules, workspaces } from '../db/schema.js';

export interface GiftCatalogRepository {
  observe(workspaceId: string, gift: GiftEvent): Promise<void>;
  list(workspaceId: string): Promise<ObservedGift[]>;
  exists(workspaceId: string, giftId: string): Promise<boolean>;
}

function view(row: typeof giftCatalog.$inferSelect): ObservedGift {
  const { giftId, giftName, imageUrl, diamondCount, firstSeenAt, lastSeenAt } = row;
  return {
    giftId, giftName, imageUrl, diamondCount,
    firstSeenAt: firstSeenAt?.toISOString() ?? null, lastSeenAt: lastSeenAt?.toISOString() ?? null,
  };
}

export function createGiftCatalogRepository(db: Database): GiftCatalogRepository {
  const visibleTo = (workspaceId: string) => or(
    isNotNull(giftCatalog.firstSeenAt),
    exists(db.select({ id: giftSoundRules.id }).from(giftSoundRules).where(and(
      eq(giftSoundRules.workspaceId, workspaceId), eq(giftSoundRules.giftId, giftCatalog.giftId),
    ))),
  );
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
    async list(workspaceId) {
      const rows = await db.select().from(giftCatalog).where(visibleTo(workspaceId))
        .orderBy(sql`${giftCatalog.lastSeenAt} desc nulls last`, desc(giftCatalog.giftId));
      return rows.map(view);
    },
    async exists(workspaceId, giftId) {
      const [row] = await db.select({ giftId: giftCatalog.giftId }).from(giftCatalog)
        .where(and(eq(giftCatalog.giftId, giftId), visibleTo(workspaceId))).limit(1);
      return Boolean(row);
    },
  };
}
