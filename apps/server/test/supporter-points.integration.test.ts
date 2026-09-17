import { and, count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GiftEvent } from '@tiktok-helper/contracts';

import { createDatabase } from '../src/db/client.js';
import {
  processedGiftEvents, supporterLevelGrants, supporterStreamTotals, supporters,
  supportLevels, workspaces,
} from '../src/db/schema.js';
import { createSupporterRepository } from '../src/supporters/repository.js';

const integration = process.env.TEST_DATABASE_URL
  ? createDatabase(process.env.TEST_DATABASE_URL)
  : null;

const identityKey = 'a'.repeat(64);
const streamOne = '10000000-0000-4000-8000-000000000001';
const streamTwo = '10000000-0000-4000-8000-000000000002';

function gift(eventId: string, points: number, username = 'viewer'): GiftEvent {
  return {
    type: 'gift.received', generation: 1, sequence: 1, eventId,
    giftId: '5655', giftName: 'Rose', senderDisplayName: username,
    senderUsername: username, repeatCount: 1, diamondCount: points,
  };
}

async function seedLevels(workspaceId: string) {
  if (!integration) throw new Error('TEST_DATABASE_URL is required');
  await integration.db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId });
  return integration.db.insert(supportLevels).values([
    {
      workspaceId, name: 'Stream voice', thresholdPoints: 10,
      pointsScope: 'stream', privilegeDuration: 'stream', privilegeDurationDays: null,
      grantsChatSpeech: true, chatSpeechCooldownSeconds: 30, isEnabled: true, position: 0,
    },
    {
      workspaceId, name: 'Lifetime voice', thresholdPoints: 20,
      pointsScope: 'lifetime', privilegeDuration: 'permanent', privilegeDurationDays: null,
      grantsChatSpeech: true, chatSpeechCooldownSeconds: 30, isEnabled: true, position: 1,
    },
  ]).returning();
}

describe.skipIf(!integration)('supporter repository PostgreSQL integration', () => {
  beforeAll(async () => {
    if (!integration) return;
    await migrate(integration.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  });

  afterAll(async () => { await integration?.client.end(); });

  it('accepts concurrent copies of one event exactly once', async () => {
    if (!integration) return;
    const workspaceId = 'support-duplicate';
    await seedLevels(workspaceId);
    const repository = createSupporterRepository(integration.db);

    const results = await Promise.all(Array.from({ length: 12 }, async () => (
      repository.processGift(workspaceId, streamOne, gift('same-event', 5), identityKey)
    )));

    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(11);
    const [supporter] = await integration.db.select().from(supporters).where(and(
      eq(supporters.workspaceId, workspaceId), eq(supporters.identityKey, identityKey),
    ));
    const [stream] = await integration.db.select().from(supporterStreamTotals).where(and(
      eq(supporterStreamTotals.workspaceId, workspaceId), eq(supporterStreamTotals.streamId, streamOne),
      eq(supporterStreamTotals.identityKey, identityKey),
    ));
    const [processed] = await integration.db.select({ value: count() }).from(processedGiftEvents).where(
      eq(processedGiftEvents.workspaceId, workspaceId),
    );
    expect({ lifetime: supporter?.lifetimePoints, stream: stream?.points, events: processed?.value })
      .toEqual({ lifetime: 5, stream: 5, events: 1 });
  });

  it('loses no concurrent points and grants every crossed level once', async () => {
    if (!integration) return;
    const workspaceId = 'support-concurrent';
    const levels = await seedLevels(workspaceId);
    const repository = createSupporterRepository(integration.db);

    const results = await Promise.all(Array.from({ length: 8 }, async (_, index) => (
      repository.processGift(workspaceId, streamOne, gift(`event-${index}`, 5), identityKey)
    )));

    expect(results.every((result) => !result.duplicate)).toBe(true);
    expect(Math.max(...results.map((result) => result.lifetimeTotal))).toBe(40);
    const [supporter] = await integration.db.select().from(supporters).where(and(
      eq(supporters.workspaceId, workspaceId), eq(supporters.identityKey, identityKey),
    ));
    const [stream] = await integration.db.select().from(supporterStreamTotals).where(and(
      eq(supporterStreamTotals.workspaceId, workspaceId), eq(supporterStreamTotals.streamId, streamOne),
      eq(supporterStreamTotals.identityKey, identityKey),
    ));
    const grants = await integration.db.select().from(supporterLevelGrants).where(and(
      eq(supporterLevelGrants.workspaceId, workspaceId), eq(supporterLevelGrants.identityKey, identityKey),
    ));
    expect({ lifetime: supporter?.lifetimePoints, stream: stream?.points })
      .toEqual({ lifetime: 40, stream: 40 });
    expect(grants).toHaveLength(2);
    expect(new Set(grants.map((grant) => grant.supportLevelId)))
      .toEqual(new Set(levels.map((level) => level.id)));
    expect(results.flatMap((result) => result.grantedLevels)).toHaveLength(2);
  });

  it('updates the public username while separating stream and lifetime totals', async () => {
    if (!integration) return;
    const workspaceId = 'support-identity';
    await seedLevels(workspaceId);
    const repository = createSupporterRepository(integration.db);

    const first = await repository.processGift(workspaceId, streamOne, gift('old-name', 10, 'old_name'), identityKey);
    const second = await repository.processGift(workspaceId, streamTwo, gift('new-name', 15, 'new_name'), identityKey);

    expect(first).toMatchObject({ streamTotal: 10, lifetimeTotal: 10 });
    expect(second).toMatchObject({ streamTotal: 15, lifetimeTotal: 25 });
    const [supporter] = await integration.db.select().from(supporters).where(and(
      eq(supporters.workspaceId, workspaceId), eq(supporters.identityKey, identityKey),
    ));
    const streams = await integration.db.select().from(supporterStreamTotals).where(and(
      eq(supporterStreamTotals.workspaceId, workspaceId), eq(supporterStreamTotals.identityKey, identityKey),
    ));
    expect(supporter).toMatchObject({ username: 'new_name', displayName: 'new_name', lifetimePoints: 25 });
    expect(new Map(streams.map((stream) => [stream.streamId, stream.points])))
      .toEqual(new Map([[streamOne, 10], [streamTwo, 15]]));
  });
});
