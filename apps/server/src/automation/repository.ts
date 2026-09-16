import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  AutomationConfiguration, EventReaction, SaveEventReaction, SaveSupportLevel,
  SupportLevel, UpdateWorkspaceSpeechPolicy, WorkspaceSpeechPolicy,
} from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import {
  eventReactions, soundLibraryAssets, supportLevels, workspaceSpeechPolicies, workspaces,
} from '../db/schema.js';

export interface AutomationRepository {
  get(workspaceId: string): Promise<AutomationConfiguration>;
  savePolicy(workspaceId: string, input: UpdateWorkspaceSpeechPolicy): Promise<WorkspaceSpeechPolicy>;
  createSupportLevel(workspaceId: string, input: SaveSupportLevel): Promise<SupportLevel | null>;
  updateSupportLevel(workspaceId: string, id: string, input: SaveSupportLevel): Promise<SupportLevel | null>;
  deleteSupportLevel(workspaceId: string, id: string): Promise<boolean>;
  createEventReaction(workspaceId: string, input: SaveEventReaction): Promise<EventReaction | null>;
  updateEventReaction(workspaceId: string, id: string, input: SaveEventReaction): Promise<EventReaction | null>;
  deleteEventReaction(workspaceId: string, id: string): Promise<boolean>;
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
  };
}

export function createAutomationRepository(db: Database): AutomationRepository {
  async function soundIsActive(soundAssetId: string | null): Promise<boolean> {
    if (!soundAssetId) return true;
    const [sound] = await db.select({ id: soundLibraryAssets.id }).from(soundLibraryAssets)
      .where(and(eq(soundLibraryAssets.id, soundAssetId), eq(soundLibraryAssets.status, 'active'))).limit(1);
    return sound !== undefined;
  }

  return {
    async get(workspaceId) {
      const [policyRow, levelRows, reactionRows] = await Promise.all([
        db.select().from(workspaceSpeechPolicies).where(eq(workspaceSpeechPolicies.workspaceId, workspaceId)).limit(1),
        db.select().from(supportLevels).where(eq(supportLevels.workspaceId, workspaceId))
          .orderBy(asc(supportLevels.position), asc(supportLevels.thresholdPoints)),
        db.select().from(eventReactions).where(eq(eventReactions.workspaceId, workspaceId))
          .orderBy(asc(eventReactions.position), asc(eventReactions.createdAt)),
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
    async createEventReaction(workspaceId, input) {
      if (!await soundIsActive(input.soundAssetId)) return null;
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await db.insert(eventReactions).values({ workspaceId, ...input }).returning();
      return row ? presentReaction(row) : null;
    },
    async updateEventReaction(workspaceId, id, input) {
      if (!await soundIsActive(input.soundAssetId)) return null;
      const [row] = await db.update(eventReactions).set({ ...input, updatedAt: new Date() })
        .where(and(eq(eventReactions.workspaceId, workspaceId), eq(eventReactions.id, id))).returning();
      return row ? presentReaction(row) : null;
    },
    async deleteEventReaction(workspaceId, id) {
      const rows = await db.delete(eventReactions)
        .where(and(eq(eventReactions.workspaceId, workspaceId), eq(eventReactions.id, id))).returning({ id: eventReactions.id });
      return rows.length > 0;
    },
  };
}
