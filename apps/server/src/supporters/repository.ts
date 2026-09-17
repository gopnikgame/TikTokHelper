import { and, eq, gt, or, sql } from 'drizzle-orm';
import type { GiftEvent, SpeechLevelEntitlement, SupportLevel } from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import {
  processedGiftEvents, supporterLevelGrants, supporterStreamTotals, supporters,
  supportLevels, workspaces,
} from '../db/schema.js';

export interface GrantedSupportLevel {
  level: SupportLevel;
  expiresAt: string | null;
}

export interface SupportProcessingResult {
  duplicate: boolean;
  pointsAdded: number;
  streamTotal: number;
  lifetimeTotal: number;
  grantedLevels: GrantedSupportLevel[];
}

export interface SupporterRepository {
  processGift(workspaceId: string, streamId: string, gift: GiftEvent, identityKey: string): Promise<SupportProcessingResult>;
  listActiveSpeechEntitlements(workspaceId: string, streamId: string): Promise<Array<{
    identityKey: string; entitlement: SpeechLevelEntitlement;
  }>>;
}

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

export function giftPoints(gift: Pick<GiftEvent, 'diamondCount' | 'repeatCount'>): number {
  if (gift.diamondCount === undefined || gift.diamondCount <= 0) return 0;
  const points = gift.diamondCount * gift.repeatCount;
  return Number.isSafeInteger(points) && points > 0 ? points : 0;
}

export function createSupporterRepository(db: Database): SupporterRepository {
  return {
    async listActiveSpeechEntitlements(workspaceId, streamId) {
      const now = new Date();
      const rows = await db.select({
        identityKey: supporterLevelGrants.identityKey,
        levelId: supportLevels.id, levelName: supportLevels.name,
        cooldownSeconds: supportLevels.chatSpeechCooldownSeconds,
        expiresAt: supporterLevelGrants.expiresAt,
      }).from(supporterLevelGrants).innerJoin(supportLevels, and(
        eq(supportLevels.workspaceId, supporterLevelGrants.workspaceId),
        eq(supportLevels.id, supporterLevelGrants.supportLevelId),
      )).where(and(
        eq(supporterLevelGrants.workspaceId, workspaceId),
        eq(supportLevels.isEnabled, true), eq(supportLevels.grantsChatSpeech, true),
        or(eq(supporterLevelGrants.grantKey, 'achievement'), eq(supporterLevelGrants.grantKey, streamId)),
        or(sql`${supporterLevelGrants.expiresAt} is null`, gt(supporterLevelGrants.expiresAt, now)),
      ));
      return rows.map((row) => ({
        identityKey: row.identityKey,
        entitlement: {
          levelId: row.levelId, levelName: row.levelName,
          cooldownSeconds: row.cooldownSeconds, expiresAt: row.expiresAt?.toISOString() ?? null,
        },
      }));
    },
    async processGift(workspaceId, streamId, gift, identityKey) {
      const pointsAdded = giftPoints(gift);
      if (pointsAdded === 0) return { duplicate: false, pointsAdded: 0, streamTotal: 0, lifetimeTotal: 0, grantedLevels: [] };
      return db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
        const [accepted] = await tx.insert(processedGiftEvents).values({
          workspaceId, eventId: gift.eventId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }).onConflictDoNothing().returning({ eventId: processedGiftEvents.eventId });
        if (!accepted) return { duplicate: true, pointsAdded: 0, streamTotal: 0, lifetimeTotal: 0, grantedLevels: [] };

        const [supporter] = await tx.insert(supporters).values({
          workspaceId, identityKey, username: gift.senderUsername,
          displayName: gift.senderDisplayName, lifetimePoints: pointsAdded,
        }).onConflictDoUpdate({
          target: [supporters.workspaceId, supporters.identityKey],
          set: {
            username: gift.senderUsername, displayName: gift.senderDisplayName,
            lifetimePoints: sql`${supporters.lifetimePoints} + ${pointsAdded}`,
            lastSupportedAt: new Date(),
          },
        }).returning({ lifetimePoints: supporters.lifetimePoints });
        const [stream] = await tx.insert(supporterStreamTotals).values({
          workspaceId, streamId, identityKey, points: pointsAdded,
        }).onConflictDoUpdate({
          target: [supporterStreamTotals.workspaceId, supporterStreamTotals.streamId, supporterStreamTotals.identityKey],
          set: { points: sql`${supporterStreamTotals.points} + ${pointsAdded}`, updatedAt: new Date() },
        }).returning({ points: supporterStreamTotals.points });
        if (!supporter || !stream) throw new Error('Support totals were not saved');

        const enabledLevels = await tx.select().from(supportLevels).where(and(
          eq(supportLevels.workspaceId, workspaceId), eq(supportLevels.isEnabled, true),
        ));
        const grantedLevels: GrantedSupportLevel[] = [];
        for (const row of enabledLevels) {
          const total = row.pointsScope === 'stream' ? stream.points : supporter.lifetimePoints;
          if (total < row.thresholdPoints) continue;
          const grantKey = row.privilegeDuration === 'stream' ? streamId : 'achievement';
          const expiresAt = row.privilegeDuration === 'days' && row.privilegeDurationDays
            ? new Date(Date.now() + row.privilegeDurationDays * 24 * 60 * 60 * 1000) : null;
          const [grant] = await tx.insert(supporterLevelGrants).values({
            workspaceId, identityKey, supportLevelId: row.id, grantKey, expiresAt,
          }).onConflictDoNothing().returning({ supportLevelId: supporterLevelGrants.supportLevelId });
          if (grant) grantedLevels.push({ level: presentLevel(row), expiresAt: expiresAt?.toISOString() ?? null });
        }
        return {
          duplicate: false, pointsAdded, streamTotal: stream.points,
          lifetimeTotal: supporter.lifetimePoints, grantedLevels,
        };
      });
    },
  };
}
