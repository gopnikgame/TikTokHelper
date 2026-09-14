import { desc, eq, sql } from 'drizzle-orm';
import type { RecentChannel } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { recentChannels, workspaces } from '../db/schema.js';

export interface RecentChannelRepository {
  record(workspaceId: string, tiktokUsername: string): Promise<void>;
  list(workspaceId: string, limit?: number): Promise<RecentChannel[]>;
}

export function createRecentChannelRepository(db: Database): RecentChannelRepository {
  return {
    async record(workspaceId, tiktokUsername) {
      const normalized = tiktokUsername.replace(/^@/, '').toLowerCase();
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      await db.insert(recentChannels).values({ workspaceId, tiktokUsername: normalized }).onConflictDoUpdate({
        target: [recentChannels.workspaceId, recentChannels.tiktokUsername],
        set: {
          connectionCount: sql`${recentChannels.connectionCount} + 1`,
          lastConnectedAt: new Date(),
        },
      });
    },
    async list(workspaceId, limit = 20) {
      const rows = await db.select({
        tiktokUsername: recentChannels.tiktokUsername,
        connectionCount: recentChannels.connectionCount,
        lastConnectedAt: recentChannels.lastConnectedAt,
      }).from(recentChannels).where(eq(recentChannels.workspaceId, workspaceId))
        .orderBy(desc(recentChannels.lastConnectedAt)).limit(Math.min(50, Math.max(1, limit)));
      return rows.map((row) => ({ ...row, lastConnectedAt: row.lastConnectedAt.toISOString() }));
    },
  };
}
