import { eq, sql } from 'drizzle-orm';
import type { LikeGoalConfiguration, SaveLikeGoal } from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import { likeGoalSettings, workspaces } from '../db/schema.js';

export interface LikeGoalRepository {
  get(workspaceId: string): Promise<LikeGoalConfiguration>;
  save(workspaceId: string, input: SaveLikeGoal): Promise<LikeGoalConfiguration>;
}

const projection = {
  targetCount: likeGoalSettings.targetCount,
  revision: likeGoalSettings.revision,
};

export function createLikeGoalRepository(db: Database): LikeGoalRepository {
  return {
    async get(workspaceId) {
      const [row] = await db.select(projection).from(likeGoalSettings)
        .where(eq(likeGoalSettings.workspaceId, workspaceId)).limit(1);
      return row ?? { targetCount: null, revision: 0 };
    },

    async save(workspaceId, { targetCount }) {
      return db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
        const [saved] = await tx.insert(likeGoalSettings).values({ workspaceId, targetCount })
          .onConflictDoUpdate({
            target: likeGoalSettings.workspaceId,
            set: {
              targetCount,
              revision: sql<number>`case when ${likeGoalSettings.targetCount} is distinct from excluded.target_count
                then ${likeGoalSettings.revision} + 1 else ${likeGoalSettings.revision} end`,
            },
          }).returning(projection);
        if (!saved) throw new Error('Like goal settings were not saved');
        return saved;
      });
    },
  };
}
