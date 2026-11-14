import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  AutomationConfiguration, EventReaction, SaveEventReaction, SaveSupportLevel,
  SupportLevel, UpdateWorkspaceSpeechPolicy, WorkspaceSpeechPolicy,
} from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import {
  eventReactions, giftCatalog, soundLibraryAssets, supportLevels, workspaceSpeechPolicies, workspaces,
} from '../db/schema.js';

export type ReactionMoveDirection = 'up' | 'down';

export interface AutomationRepository {
  get(workspaceId: string, allowGiftReactions?: boolean): Promise<AutomationConfiguration>;
  savePolicy(workspaceId: string, input: UpdateWorkspaceSpeechPolicy): Promise<WorkspaceSpeechPolicy>;
  createSupportLevel(workspaceId: string, input: SaveSupportLevel): Promise<SupportLevel | null>;
  updateSupportLevel(workspaceId: string, id: string, input: SaveSupportLevel): Promise<SupportLevel | null>;
  deleteSupportLevel(workspaceId: string, id: string): Promise<boolean>;
  createEventReaction(workspaceId: string, input: SaveEventReaction, allowGiftReactions?: boolean): Promise<EventReaction | null>;
  updateEventReaction(workspaceId: string, id: string, input: SaveEventReaction, allowGiftReactions?: boolean): Promise<EventReaction | null>;
  deleteEventReaction(workspaceId: string, id: string, allowGiftReactions?: boolean): Promise<boolean>;
  moveEventReaction(workspaceId: string, id: string, direction: ReactionMoveDirection, allowGiftReactions?: boolean): Promise<boolean>;
}

const defaultPolicy = (workspaceId: string): WorkspaceSpeechPolicy => ({
  workspaceId, moderatorSpeechEnabled: false, moderatorCooldownSeconds: 30,
  defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 200, maxQueueSize: 20,
  readUserName: false, fallbackLanguage: 'ru-RU', revision: 1,
});

function presentLevel(row: typeof supportLevels.$inferSelect): SupportLevel {
  return {
    id: row.id, workspaceId: row.workspaceId, name: row.name,
    thresholdPoints: row.thresholdPoints, pointsScope: row.pointsScope as SupportLevel['pointsScope'],
    privilegeDuration: row.privilegeDuration as SupportLevel['privilegeDuration'],
    privilegeDurationDays: row.privilegeDurationDays, grantsChatSpeech: row.grantsChatSpeech,
    chatSpeechCooldownSeconds: row.chatSpeechCooldownSeconds,
    announcementTemplate: row.announcementTemplate, soundAssetId: row.soundAssetId,
    isEnabled: row.isEnabled, position: row.position,
  };
}

function presentReaction(row: typeof eventReactions.$inferSelect): EventReaction {
  return {
    id: row.id, workspaceId: row.workspaceId, name: row.name,
    eventType: row.eventType as EventReaction['eventType'], supportLevelId: row.supportLevelId,
    speechTemplate: row.speechTemplate, soundAssetId: row.soundAssetId,
    cooldownSeconds: row.cooldownSeconds, isEnabled: row.isEnabled, position: row.position,
    ...(row.eventType === 'gift_completed' && row.minimumGiftPoints !== null
      ? { giftId: row.giftId, minimumGiftPoints: row.minimumGiftPoints } : {}),
  };
}

function reactionScope(workspaceId: string, allowGiftReactions: boolean) {
  return and(eq(eventReactions.workspaceId, workspaceId),
    allowGiftReactions ? undefined : ne(eventReactions.eventType, 'gift_completed'));
}

export function createAutomationRepository(db: Database): AutomationRepository {
  async function soundIsActive(soundAssetId: string | null): Promise<boolean> {
    if (!soundAssetId) return true;
    const [sound] = await db.select({ id: soundLibraryAssets.id }).from(soundLibraryAssets)
      .where(and(eq(soundLibraryAssets.id, soundAssetId), eq(soundLibraryAssets.status, 'active'))).limit(1);
    return sound !== undefined;
  }

  async function saveReaction(workspaceId: string, input: SaveEventReaction, allowGiftReactions: boolean, id?: string) {
    const isGiftReaction = input.eventType === 'gift_completed';
    if (isGiftReaction && !allowGiftReactions) return null;
    const values = {
      ...input,
      giftId: isGiftReaction ? input.giftId ?? null : null,
      minimumGiftPoints: isGiftReaction ? input.minimumGiftPoints ?? null : null,
    };

    return db.transaction(async (tx) => {
      let retainedQuarantinedSound: string | undefined;
      if (values.soundAssetId) {
        // Lock the sound status through the rule write.
        const [sound] = await tx.select({ status: soundLibraryAssets.status }).from(soundLibraryAssets)
          .where(eq(soundLibraryAssets.id, values.soundAssetId))
          .for('share').limit(1);
        if (sound?.status !== 'active') {
          if (sound?.status !== 'quarantined' || !isGiftReaction || values.isEnabled || id === undefined) return null;
          retainedQuarantinedSound = values.soundAssetId;
        }
      }
      if (values.giftId) {
        const [gift] = await tx.select({ id: giftCatalog.giftId }).from(giftCatalog)
          .where(eq(giftCatalog.giftId, values.giftId)).for('key share').limit(1);
        if (!gift) return null;
      }
      if (id !== undefined) {
        const retainedAssignment = retainedQuarantinedSound ? and(
          eq(eventReactions.eventType, 'gift_completed'), eq(eventReactions.soundAssetId, retainedQuarantinedSound),
        ) : undefined;
        const [row] = await tx.update(eventReactions).set({ ...values, updatedAt: new Date() })
          .where(and(reactionScope(workspaceId, allowGiftReactions), eq(eventReactions.id, id), retainedAssignment)).returning();
        return row ? presentReaction(row) : null;
      }
      await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await tx.insert(eventReactions).values({ workspaceId, ...values }).returning();
      return row ? presentReaction(row) : null;
    });
  }

  return {
    async get(workspaceId, allowGiftReactions = false) {
      const [policyRow, levelRows, reactionRows] = await Promise.all([
        db.select().from(workspaceSpeechPolicies).where(eq(workspaceSpeechPolicies.workspaceId, workspaceId)).limit(1),
        db.select().from(supportLevels).where(eq(supportLevels.workspaceId, workspaceId))
          .orderBy(asc(supportLevels.position), asc(supportLevels.thresholdPoints)),
        db.select().from(eventReactions).where(reactionScope(workspaceId, allowGiftReactions))
          .orderBy(asc(eventReactions.position), asc(eventReactions.createdAt), asc(eventReactions.id)),
      ]);
      const policy = policyRow[0]
        ? { ...defaultPolicy(workspaceId), ...policyRow[0] }
        : defaultPolicy(workspaceId);
      return {
        policy: {
          workspaceId: policy.workspaceId, moderatorSpeechEnabled: policy.moderatorSpeechEnabled,
          moderatorCooldownSeconds: policy.moderatorCooldownSeconds,
          defaultSpeechCooldownSeconds: policy.defaultSpeechCooldownSeconds,
          maxMessageCharacters: policy.maxMessageCharacters, maxQueueSize: policy.maxQueueSize,
          readUserName: policy.readUserName, fallbackLanguage: policy.fallbackLanguage,
          revision: policy.revision,
        },
        supportLevels: levelRows.map(presentLevel), eventReactions: reactionRows.map(presentReaction),
      };
    },
    async savePolicy(workspaceId, input) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await db.insert(workspaceSpeechPolicies).values({ workspaceId, ...input })
        .onConflictDoUpdate({
          target: workspaceSpeechPolicies.workspaceId,
          set: { ...input, revision: sql`${workspaceSpeechPolicies.revision} + 1`, updatedAt: new Date() },
        }).returning();
      if (!row) throw new Error('Speech policy was not saved');
      return { workspaceId, ...input, revision: row.revision };
    },
    async createSupportLevel(workspaceId, input) {
      if (!await soundIsActive(input.soundAssetId)) return null;
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await db.insert(supportLevels).values({ workspaceId, ...input }).returning();
      return row ? presentLevel(row) : null;
    },
    async updateSupportLevel(workspaceId, id, input) {
      if (!await soundIsActive(input.soundAssetId)) return null;
      const [row] = await db.update(supportLevels).set({ ...input, updatedAt: new Date() })
        .where(and(eq(supportLevels.workspaceId, workspaceId), eq(supportLevels.id, id))).returning();
      return row ? presentLevel(row) : null;
    },
    async deleteSupportLevel(workspaceId, id) {
      const rows = await db.delete(supportLevels)
        .where(and(eq(supportLevels.workspaceId, workspaceId), eq(supportLevels.id, id))).returning({ id: supportLevels.id });
      return rows.length > 0;
    },
    async createEventReaction(workspaceId, input, allowGiftReactions = false) {
      return saveReaction(workspaceId, input, allowGiftReactions);
    },
    async updateEventReaction(workspaceId, id, input, allowGiftReactions = false) {
      return saveReaction(workspaceId, input, allowGiftReactions, id);
    },
    async deleteEventReaction(workspaceId, id, allowGiftReactions = false) {
      const rows = await db.delete(eventReactions)
        .where(and(reactionScope(workspaceId, allowGiftReactions), eq(eventReactions.id, id))).returning({ id: eventReactions.id });
      return rows.length > 0;
    },
    async moveEventReaction(workspaceId, id, direction, allowGiftReactions = false) {
      const scope = reactionScope(workspaceId, allowGiftReactions);
      return db.transaction(async (tx) => {
        // Acquire locks in a stable order, then sort by the positions visible after waiting for them.
        const locked = tx.select({
          id: eventReactions.id, position: eventReactions.position, createdAt: eventReactions.createdAt,
        }).from(eventReactions).where(scope).orderBy(asc(eventReactions.id)).for('no key update').as('locked');
        const rows = await tx.select({ id: locked.id, position: locked.position }).from(locked)
          .orderBy(asc(locked.position), asc(locked.createdAt), asc(locked.id));
        const index = rows.findIndex((row) => row.id === id);
        const otherIndex = index + (direction === 'up' ? -1 : 1);
        const current = rows[index];
        const other = rows[otherIndex];
        if (!current || !other || rows.length > 10_001) return false;

        rows[index] = other;
        rows[otherIndex] = current;
        const changes = rows.flatMap((row, position) => row.position === position ? [] : [{ id: row.id, position }]);
        const positions = sql.join(changes.map((row) => sql`when ${row.id} then ${row.position}`), sql` `);
        await tx.update(eventReactions).set({
          position: sql`case ${eventReactions.id} ${positions} else ${eventReactions.position} end`,
        }).where(and(scope, inArray(eventReactions.id, changes.map((row) => row.id))));
        return true;
      });
    },
  };
}
