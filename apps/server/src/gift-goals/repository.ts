import { and, eq, sql } from 'drizzle-orm';
import type { GiftGoalConfiguration, SaveGiftGoal } from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import { giftCatalog, giftGoalSettings, soundLibraryAssets, workspaces } from '../db/schema.js';

export interface GiftGoalRepository {
  get(workspaceId: string): Promise<GiftGoalConfiguration | null>;
  save(workspaceId: string, input: SaveGiftGoal): Promise<GiftGoalConfiguration | null>;
}

const projection = {
  giftId: giftGoalSettings.giftId,
  targetCount: giftGoalSettings.targetCount,
  soundAssetId: giftGoalSettings.soundAssetId,
  isEnabled: giftGoalSettings.isEnabled,
  revision: giftGoalSettings.revision,
};

export function createGiftGoalRepository(db: Database): GiftGoalRepository & {
  getGiftName(giftId: string): Promise<string | null>;
} {
  return {
    async get(workspaceId) {
      const [row] = await db.select(projection).from(giftGoalSettings)
        .where(eq(giftGoalSettings.workspaceId, workspaceId)).limit(1);
      return row ?? null;
    },

    async getGiftName(giftId) {
      const [gift] = await db.select({ name: giftCatalog.giftName }).from(giftCatalog).where(eq(giftCatalog.giftId, giftId)).limit(1);
      return gift?.name.trim() || null;
    },

    async save(workspaceId, input) {
      return db.transaction(async (tx) => {
        let retainedQuarantinedSound: string | null = null;
        if (input.soundAssetId) {
          const [sound] = await tx.select({ status: soundLibraryAssets.status }).from(soundLibraryAssets)
            .where(eq(soundLibraryAssets.id, input.soundAssetId)).for('share').limit(1);
          if (sound?.status !== 'active') {
            if (sound?.status !== 'quarantined' || input.isEnabled) return null;
            retainedQuarantinedSound = input.soundAssetId;
          }
        }

        const [gift] = await tx.select({ id: giftCatalog.giftId }).from(giftCatalog)
          .where(eq(giftCatalog.giftId, input.giftId)).for('key share').limit(1);
        if (!gift) return null;

        const revision = sql<number>`case when (${giftGoalSettings.giftId}, ${giftGoalSettings.targetCount},
          ${giftGoalSettings.soundAssetId}, ${giftGoalSettings.isEnabled}) is distinct from
          (${input.giftId}::varchar, ${input.targetCount}::integer, ${input.soundAssetId}::uuid, ${input.isEnabled}::boolean)
          then ${giftGoalSettings.revision} + 1 else ${giftGoalSettings.revision} end`;

        if (retainedQuarantinedSound) {
          const [saved] = await tx.update(giftGoalSettings).set({ ...input, revision }).where(and(
            eq(giftGoalSettings.workspaceId, workspaceId), eq(giftGoalSettings.soundAssetId, retainedQuarantinedSound),
          )).returning(projection);
          return saved ?? null;
        }

        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
        const [saved] = await tx.insert(giftGoalSettings).values({ workspaceId, ...input })
          .onConflictDoUpdate({ target: giftGoalSettings.workspaceId, set: { ...input, revision } })
          .returning(projection);
        return saved ?? null;
      });
    },
  };
}
