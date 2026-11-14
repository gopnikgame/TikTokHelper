import { and, eq, gt, or, sql } from 'drizzle-orm';
import type { GiftEvent, SpeechLevelEntitlement, SupportLevel } from '@tiktok-helper/contracts';

import type { Database } from '../db/client.js';
import {
  processedGiftEvents, processedGiftStreaks, supporterLevelGrants, supporterStreamTotals, supporters,
  supportLevels, workspaces,
} from '../db/schema.js';
import type { GiftAccounting } from '../tiktok/types.js';

export interface GrantedSupportLevel {
  level: SupportLevel;
  expiresAt: string | null;
}

export interface SupportProcessingResult {
  duplicate: boolean;
  repeatCount: number;
  pointsAdded: number;
  streamTotal: number;
  lifetimeTotal: number;
  grantedLevels: GrantedSupportLevel[];
}

export interface SupporterRepository {
  resetWorkspaceStatistics(workspaceId: string): Promise<number>;
  rememberHistoricalStreak(workspaceId: string, key: string, repeatCount: number): Promise<void>;
  claimGiftCompletion(workspaceId: string, eventId: string): Promise<boolean>;
  processGift(workspaceId: string, streamId: string, gift: GiftEvent, identityKey: string, accounting?: GiftAccounting): Promise<SupportProcessingResult>;
  listActiveSpeechEntitlements(workspaceId: string, streamId: string): Promise<Array<{
    identityKey: string; entitlement: SpeechLevelEntitlement;
  }>>;
}

const GIFT_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

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

function withoutPoints(repeatCount: number): SupportProcessingResult {
  return { duplicate: repeatCount === 0, repeatCount, pointsAdded: 0, streamTotal: 0, lifetimeTotal: 0, grantedLevels: [] };
}

export function createSupporterRepository(db: Database): SupporterRepository {
  return {
    async rememberHistoricalStreak(workspaceId, streakKey, repeatCount) {
      await db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
        await tx.insert(processedGiftStreaks).values({ workspaceId, streakKey, repeatCount }).onConflictDoUpdate({
          target: [processedGiftStreaks.workspaceId, processedGiftStreaks.streakKey],
          set: { repeatCount },
          where: sql`${processedGiftStreaks.repeatCount} < ${repeatCount}`,
        });
      });
    },
    async claimGiftCompletion(workspaceId, eventId) {
      return db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
        const [claimed] = await tx.insert(processedGiftEvents).values({
          workspaceId, eventId, expiresAt: new Date(Date.now() + GIFT_EVENT_RETENTION_MS),
        }).onConflictDoNothing().returning({ eventId: processedGiftEvents.eventId });
        return claimed !== undefined;
      });
    },
    async resetWorkspaceStatistics(workspaceId) {
      const deleted = await db.delete(supporters).where(eq(supporters.workspaceId, workspaceId))
        .returning({ identityKey: supporters.identityKey });
      return deleted.length;
    },
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
    async processGift(workspaceId, streamId, gift, identityKey, accounting) {
      return db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
        const expiresAt = new Date(Date.now() + GIFT_EVENT_RETENTION_MS);
        const upstreamEventId = accounting?.upstreamEventId;
        const [legacyCopy] = upstreamEventId && upstreamEventId !== gift.eventId
          ? await tx.select({ eventId: processedGiftEvents.eventId }).from(processedGiftEvents).where(and(
            eq(processedGiftEvents.workspaceId, workspaceId), eq(processedGiftEvents.eventId, upstreamEventId),
          )).limit(1) : [];
        const [accepted] = await tx.insert(processedGiftEvents).values({
          workspaceId, eventId: gift.eventId, expiresAt,
        }).onConflictDoNothing().returning({ eventId: processedGiftEvents.eventId });
        if (!accepted) return withoutPoints(0);

        const streak = accounting?.streak;
        let repeatCount = legacyCopy ? 0 : gift.repeatCount;
        if (streak) {
          // Lock the series before advancing its cumulative count. The startup history can
          // set a higher baseline than our last database write after a reconnect.
          await tx.insert(processedGiftStreaks).values({ workspaceId, streakKey: streak.key, repeatCount: 0 }).onConflictDoNothing();
          const key = and(eq(processedGiftStreaks.workspaceId, workspaceId), eq(processedGiftStreaks.streakKey, streak.key));
          const [previous] = await tx.select({ repeatCount: processedGiftStreaks.repeatCount }).from(processedGiftStreaks)
            .where(key).for('update');
          if (!previous) throw new Error('Gift streak is missing');
          if (streak.totalCount > previous.repeatCount) {
            await tx.update(processedGiftStreaks).set({ repeatCount: streak.totalCount }).where(key);
          }
          if (!legacyCopy || previous.repeatCount > 0 || streak.historicalCount > 0) {
            repeatCount = Math.max(0, streak.totalCount - Math.max(streak.historicalCount, previous.repeatCount));
          }
        }
        const pointsAdded = giftPoints({ ...gift, repeatCount });
        if (pointsAdded === 0) return withoutPoints(repeatCount);

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
          duplicate: false, repeatCount, pointsAdded, streamTotal: stream.points,
          lifetimeTotal: supporter.lifetimePoints, grantedLevels,
        };
      });
    },
  };
}
