import { eq, sql } from 'drizzle-orm';
import type { UpdateWorkspaceSettings, WorkspaceSettings } from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import { channels, workspacePreferences, workspaces } from '../db/schema.js';

export interface SettingsRepository {
  get(workspaceId: string): Promise<WorkspaceSettings | null>;
  save(workspaceId: string, input: UpdateWorkspaceSettings): Promise<WorkspaceSettings>;
}

export function createSettingsRepository(db: Database): SettingsRepository {
  return {
    async get(workspaceId) {
      const [row] = await db.select({
        workspaceId: workspacePreferences.workspaceId,
        tiktokUsername: channels.tiktokUsername,
        playbackMode: workspacePreferences.playbackMode,
        overlapPercent: workspacePreferences.overlapPercent,
        maxConcurrentSounds: workspacePreferences.maxConcurrentSounds,
        volumePercent: workspacePreferences.volumePercent,
        revision: workspacePreferences.revision,
      }).from(workspacePreferences)
        .innerJoin(channels, eq(channels.workspaceId, workspacePreferences.workspaceId))
        .where(eq(workspacePreferences.workspaceId, workspaceId)).limit(1);
      return row as WorkspaceSettings | undefined ?? null;
    },

    async save(workspaceId, input) {
      return db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId })
          .onConflictDoNothing();
        await tx.insert(channels).values({ workspaceId, tiktokUsername: input.tiktokUsername })
          .onConflictDoUpdate({
            target: channels.workspaceId,
            set: { tiktokUsername: input.tiktokUsername, updatedAt: new Date() },
          });
        const [saved] = await tx.insert(workspacePreferences).values({ workspaceId, ...input })
          .onConflictDoUpdate({
            target: workspacePreferences.workspaceId,
            set: { ...input, revision: sql`${workspacePreferences.revision} + 1`, updatedAt: new Date() },
          }).returning();
        if (!saved) throw new Error('Settings were not saved');
        return { workspaceId, ...input, revision: saved.revision };
      });
    },
  };
}
