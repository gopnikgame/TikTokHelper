import { and, count, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIKE_GOAL_MAX_TARGET, type GiftEvent, type SaveEventReaction, type SaveGiftGoal } from '@tiktok-helper/contracts';

import { createAutomationRepository } from '../src/automation/repository.js';
import { createDatabase } from '../src/db/client.js';
import {
  eventReactions, giftCatalog, giftGoalSettings, likeGoalSettings, processedGiftEvents, processedGiftStreaks, soundLibraryAssets,
  supporterLevelGrants, supporterStreamTotals, supporters,
  supportLevels, users, workspaces,
} from '../src/db/schema.js';
import { createGiftGoalRepository } from '../src/gift-goals/repository.js';
import { createLikeGoalRepository } from '../src/like-goals/repository.js';
import { createSoundRepository } from '../src/sounds/repository.js';
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

  it('claims a completion once per workspace without incrementing gift totals', async () => {
    if (!integration) return;
    const repository = createSupporterRepository(integration.db);
    const workspaceId = `complete-${randomUUID()}`;
    const otherWorkspaceId = `complete-${randomUUID()}`;
    const eventId = `gift-complete:${'e'.repeat(64)}`;
    const claims = await Promise.all(Array.from({ length: 8 }, () => repository.claimGiftCompletion(workspaceId, eventId)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await repository.claimGiftCompletion(otherWorkspaceId, eventId)).toBe(true);
    const rows = await integration.db.select().from(supporterStreamTotals).where(eq(supporterStreamTotals.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('stores gift filters with workspace isolation and keeps assigned sounds in use', async () => {
    if (!integration) return;
    const { db } = integration;
    const repository = createAutomationRepository(db);
    const workspaceId = `gift-rule-${randomUUID()}`;
    const giftId = `fixture-${randomUUID()}`;
    await db.insert(giftCatalog).values({ giftId, giftName: 'Fixture Rose' });
    const sounds = createSoundRepository(db);
    const sound = await sounds.createSound(workspaceId, {
      displayName: 'Fixture Bell', storageKey: `${giftId}.wav`, mimeType: 'audio/wav',
      contentSha256: 'a'.repeat(64), byteSize: 512,
    });

    const input: SaveEventReaction = {
      eventType: 'gift_completed', name: 'Fixture gift reaction', giftId, minimumGiftPoints: 10,
      supportLevelId: null, soundAssetId: sound.id, speechTemplate: 'Thank you, {user}!',
      cooldownSeconds: 0, isEnabled: false, position: 0,
    };
    expect(await repository.createEventReaction(workspaceId, input)).toBeNull();
    expect(await repository.createEventReaction(workspaceId, { ...input, giftId: 'fixture-unknown' }, true)).toBeNull();
    const saved = await repository.createEventReaction(workspaceId, input, true);
    expect(saved).toMatchObject({ ...input, workspaceId });
    if (!saved) throw new Error('Fixture reaction was not inserted');
    const standard: SaveEventReaction = {
      eventType: 'donor_seen', name: 'Fixture donor reaction', supportLevelId: null,
      soundAssetId: null, speechTemplate: null, cooldownSeconds: 0, isEnabled: false, position: 0,
    };
    expect((await repository.get(workspaceId)).eventReactions).toEqual([]);
    expect((await repository.get(workspaceId, true)).eventReactions).toEqual([saved]);
    expect(await repository.updateEventReaction(workspaceId, saved.id, standard)).toBeNull();
    expect(await repository.deleteEventReaction(workspaceId, saved.id)).toBe(false);
    expect(await repository.updateEventReaction('another-fixture', saved.id, input, true)).toBeNull();
    expect(await sounds.listSounds(workspaceId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sound.id, usageCount: 1 }),
    ]));

    // SQL CHECK must reject a null minimum, including writes that bypass HTTP validation.
    await expect(db.update(eventReactions).set({ minimumGiftPoints: null }).where(eq(eventReactions.id, saved.id)))
      .rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'event_reactions_gift_filter_chk' } });
    await expect(db.delete(giftCatalog).where(eq(giftCatalog.giftId, giftId)))
      .rejects.toMatchObject({ cause: {
        constraint_name: 'event_reactions_gift_id_gift_catalog_gift_id_fk',
      } });
    const withoutSound = await repository.createEventReaction(workspaceId, { ...input, soundAssetId: null }, true);
    if (!withoutSound) throw new Error('Fixture reaction without sound was not inserted');
    expect(await repository.updateEventReaction(workspaceId, saved.id, { ...input, isEnabled: true }, true))
      .toMatchObject({ isEnabled: true });
    await db.update(soundLibraryAssets).set({ status: 'quarantined', quarantinedAt: new Date(), quarantineReason: 'Fixture' })
      .where(eq(soundLibraryAssets.id, sound.id));
    const beforeMove = (await repository.get(workspaceId, true)).eventReactions;
    expect(beforeMove.map((rule) => rule.position)).toEqual([0, 0]);
    expect(await repository.moveEventReaction(workspaceId, withoutSound.id, 'up')).toBe(false);
    expect(await repository.moveEventReaction('another-fixture', withoutSound.id, 'up', true)).toBe(false);
    expect(await repository.moveEventReaction(workspaceId, withoutSound.id, 'up', true)).toBe(true);
    expect((await repository.get(workspaceId, true)).eventReactions).toEqual([
      { ...withoutSound, position: 0 }, { ...input, id: saved.id, workspaceId, position: 1, isEnabled: true },
    ]);
    expect(await repository.createEventReaction(workspaceId, input, true)).toBeNull();
    expect(await repository.updateEventReaction(workspaceId, withoutSound.id, input, true)).toBeNull();
    expect(await repository.updateEventReaction(workspaceId, saved.id, input, true))
      .toMatchObject({ isEnabled: false, soundAssetId: sound.id });
    expect(await repository.updateEventReaction(workspaceId, saved.id, { ...input, isEnabled: true }, true)).toBeNull();
    const converted = await repository.updateEventReaction(workspaceId, saved.id, standard, true);
    expect(converted).toMatchObject({ eventType: 'donor_seen', soundAssetId: null });
    expect(converted).not.toHaveProperty('giftId');
    expect(converted).not.toHaveProperty('minimumGiftPoints');
    expect(await repository.deleteEventReaction(workspaceId, saved.id)).toBe(true);
  });

  it('preserves visible rule order when simultaneous moves act on tied positions', async () => {
    if (!integration) return;
    const repository = createAutomationRepository(integration.db);
    const workspaceId = `gift-order-${randomUUID()}`;
    const visible: SaveEventReaction = {
      eventType: 'donor_seen', name: 'Fixture donor', supportLevelId: null, soundAssetId: null,
      speechTemplate: null, cooldownSeconds: 0, isEnabled: false, position: 1,
    };
    const hidden = await repository.createEventReaction(workspaceId, {
      ...visible, name: 'Fixture gift', eventType: 'gift_completed', giftId: null, minimumGiftPoints: 0,
    }, true);
    const visibleRules = [];
    for (const name of ['First', 'Second', 'Third']) {
      const rule = await repository.createEventReaction(workspaceId, { ...visible, name });
      if (!rule) throw new Error('Fixture reaction was not inserted');
      visibleRules.push(rule);
    }

    const [first, second, third] = visibleRules;
    expect(await Promise.all([
      repository.moveEventReaction(workspaceId, third!.id, 'up'),
      repository.moveEventReaction(workspaceId, third!.id, 'up'),
    ])).toEqual([true, true]);
    expect((await repository.get(workspaceId)).eventReactions).toEqual([
      { ...third!, position: 0 }, { ...first!, position: 1 }, { ...second!, position: 2 },
    ]);
    expect((await repository.get(workspaceId, true)).eventReactions.find((rule) => rule.id === hidden?.id)).toEqual(hidden);
  });

  it('keeps one gift goal per workspace and changes revision only for changed settings', async () => {
    if (!integration) return;
    const { db } = integration;
    const goals = createGiftGoalRepository(db);
    const workspaceId = `goal-${randomUUID()}`;
    const otherWorkspaceId = `goal-${randomUUID()}`;
    const giftId = `fixture-${randomUUID()}`;
    const input: SaveGiftGoal = { giftId, targetCount: 100, soundAssetId: null, isEnabled: true };
    expect(await goals.get(workspaceId)).toBeNull();
    expect(await goals.save(workspaceId, input)).toBeNull();
    await db.insert(giftCatalog).values({ giftId, giftName: 'Fixture rose' });

    const copies = await Promise.all(Array.from({ length: 6 }, () => goals.save(workspaceId, input)));
    expect(copies).toEqual(Array.from({ length: 6 }, () => ({ ...input, revision: 1 })));
    expect(await goals.save(otherWorkspaceId, { ...input, targetCount: 8 })).toEqual({ ...input, targetCount: 8, revision: 1 });
    expect(await goals.save(workspaceId, { ...input, targetCount: 9 })).toEqual({ ...input, targetCount: 9, revision: 2 });
    expect(await goals.get(workspaceId)).toEqual({ ...input, targetCount: 9, revision: 2 });
    expect(await goals.get(otherWorkspaceId)).toEqual({ ...input, targetCount: 8, revision: 1 });
    await expect(db.update(giftGoalSettings).set({ targetCount: 0 }).where(eq(giftGoalSettings.workspaceId, workspaceId)))
      .rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'gift_goal_settings_target_count_chk' } });
    await expect(db.delete(giftCatalog).where(eq(giftCatalog.giftId, giftId)))
      .rejects.toMatchObject({ cause: { constraint_name: 'gift_goal_settings_gift_id_gift_catalog_gift_id_fk' } });
  });

  it('isolates like goals by workspace and never increments the revision for concurrent retries', async () => {
    if (!integration) return;
    const { db } = integration;
    const repository = createLikeGoalRepository(db);
    const workspaceId = `like-goal-${randomUUID()}`;
    const otherWorkspaceId = `like-goal-${randomUUID()}`;
    expect(await repository.get(workspaceId)).toEqual({ targetCount: null, revision: 0 });

    const saveCopies = (targetCount: number | null) => Promise.all(
      Array.from({ length: 6 }, () => repository.save(workspaceId, { targetCount })),
    );
    const first = await saveCopies(100);
    expect(first).toEqual(Array.from({ length: 6 }, () => ({ targetCount: 100, revision: 1 })));
    expect(await repository.save(otherWorkspaceId, { targetCount: LIKE_GOAL_MAX_TARGET }))
      .toEqual({ targetCount: LIKE_GOAL_MAX_TARGET, revision: 1 });

    const disabled = await saveCopies(null);
    expect(disabled).toEqual(Array.from({ length: 6 }, () => ({ targetCount: null, revision: 2 })));
    expect(await repository.save(workspaceId, { targetCount: 100 })).toEqual({ targetCount: 100, revision: 3 });
    expect(await repository.get(workspaceId)).toEqual({ targetCount: 100, revision: 3 });
    expect(await repository.get(otherWorkspaceId)).toEqual({ targetCount: LIKE_GOAL_MAX_TARGET, revision: 1 });
    const competing = await Promise.all([200, 300].map((targetCount) => repository.save(workspaceId, { targetCount })));
    expect(competing.map(({ revision }) => revision).sort()).toEqual([4, 5]);
    expect(await repository.get(workspaceId)).toEqual(competing.find(({ revision }) => revision === 5));
    for (const targetCount of [0, LIKE_GOAL_MAX_TARGET + 1]) {
      await expect(db.update(likeGoalSettings).set({ targetCount }).where(eq(likeGoalSettings.workspaceId, workspaceId)))
        .rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'like_goal_settings_target_count_chk' } });
    }
    await expect(db.update(likeGoalSettings).set({ revision: 0 }).where(eq(likeGoalSettings.workspaceId, workspaceId)))
      .rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'like_goal_settings_revision_chk' } });
  });

  it('keeps goal assignments in sound usage and detaches them only after authorized quarantine and deletion', async () => {
    if (!integration) return;
    const { db } = integration;
    const workspaceId = `goal-sound-${randomUUID()}`;
    const otherWorkspaceId = `goal-sound-${randomUUID()}`;
    const giftId = `fixture-${randomUUID()}`;
    const ownerId = randomUUID();
    const adminId = randomUUID();
    await db.insert(users).values([
      { id: ownerId, identitySubject: ownerId },
      { id: adminId, identitySubject: adminId, globalRole: 'admin' },
    ]);
    const owner = { userId: ownerId, isAdmin: false };
    const admin = { userId: adminId, isAdmin: true };
    await db.insert(giftCatalog).values({ giftId, giftName: 'Fixture rose' });
    const goals = createGiftGoalRepository(db);
    const sounds = createSoundRepository(db);
    const sound = await sounds.createSound(workspaceId, {
      displayName: 'Fixture bell', storageKey: `${giftId}.wav`, mimeType: 'audio/wav',
      contentSha256: 'a'.repeat(64), byteSize: 512,
    }, ownerId);
    const input: SaveGiftGoal = { giftId, targetCount: 100, soundAssetId: sound.id, isEnabled: true };
    expect(await goals.save(workspaceId, input)).toEqual({ ...input, revision: 1 });
    expect((await sounds.listSounds(workspaceId, owner)).find((asset) => asset.id === sound.id))
      .toMatchObject({ usageCount: 1, canDelete: false });
    expect(await sounds.deleteSound(sound.id, owner)).toEqual({ ok: false, reason: 'in_use', usageCount: 1 });
    expect(await sounds.deleteSound(sound.id, admin)).toEqual({ ok: false, reason: 'not_quarantined' });

    expect(await sounds.quarantineSound(sound.id, admin, 'Fixture')).toMatchObject({ status: 'quarantined', usageCount: 1 });
    expect(await goals.save(otherWorkspaceId, { ...input, isEnabled: false })).toBeNull();
    expect(await goals.save(workspaceId, { ...input, isEnabled: false })).toEqual({ ...input, isEnabled: false, revision: 2 });
    expect(await goals.save(workspaceId, input)).toBeNull();
    expect(await sounds.deleteSound(sound.id, admin)).toMatchObject({ ok: true, removedMappings: 1 });
    expect(await goals.get(workspaceId)).toEqual({ ...input, isEnabled: false, soundAssetId: null, revision: 2 });
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

  it('resets totals and grants without removing rules or gift idempotency records', async () => {
    if (!integration) return;
    const workspaceId = 'support-reset';
    await seedLevels(workspaceId);
    const repository = createSupporterRepository(integration.db);
    await repository.processGift(workspaceId, streamOne, gift('reset-event', 25), identityKey);

    expect(await repository.resetWorkspaceStatistics(workspaceId)).toBe(1);

    const [supporterCount] = await integration.db.select({ value: count() }).from(supporters)
      .where(eq(supporters.workspaceId, workspaceId));
    const [streamCount] = await integration.db.select({ value: count() }).from(supporterStreamTotals)
      .where(eq(supporterStreamTotals.workspaceId, workspaceId));
    const [grantCount] = await integration.db.select({ value: count() }).from(supporterLevelGrants)
      .where(eq(supporterLevelGrants.workspaceId, workspaceId));
    const [levelCount] = await integration.db.select({ value: count() }).from(supportLevels)
      .where(eq(supportLevels.workspaceId, workspaceId));
    const [eventCount] = await integration.db.select({ value: count() }).from(processedGiftEvents)
      .where(eq(processedGiftEvents.workspaceId, workspaceId));
    expect({
      supporters: supporterCount?.value, streams: streamCount?.value, grants: grantCount?.value,
      levels: levelCount?.value, processedEvents: eventCount?.value,
    }).toEqual({ supporters: 0, streams: 0, grants: 0, levels: 2, processedEvents: 1 });
  });

  it('persists series progress across reconnect and accounts only the missing increments', async () => {
    if (!integration) return;
    const workspaceId = 'support-streak';
    const repository = createSupporterRepository(integration.db);
    const key = 'd'.repeat(64);
    const send = (id: string, historicalCount: number, totalCount: number, streakKey = key) => repository.processGift(
      workspaceId, streamOne, { ...gift(id, 5), repeatCount: totalCount - historicalCount }, identityKey,
      { streak: { key: streakKey, historicalCount, totalCount } },
    );
    // The higher stage arrives first, even if overlapping writes both saw the old baseline.
    expect(await send('stage-3', 0, 3)).toMatchObject({ repeatCount: 3, streamTotal: 15 });
    expect(await send('stage-1-late', 0, 1)).toMatchObject({ repeatCount: 0, duplicate: true });
    expect(await send('stage-4-reconnected', 0, 4)).toMatchObject({ repeatCount: 1, streamTotal: 20 });
    expect(await send('stage-4-duplicate', 0, 4)).toMatchObject({ repeatCount: 0, duplicate: true });
    expect(await send('other-group', 0, 2, 'e'.repeat(64))).toMatchObject({ repeatCount: 2, streamTotal: 30 });
    await repository.rememberHistoricalStreak(workspaceId, key, 7);
    await repository.rememberHistoricalStreak(workspaceId, key, 6);
    expect(await send('stage-8-live-after-restart', 0, 8)).toMatchObject({ repeatCount: 1, streamTotal: 35 });
    const persisted = await integration.db.select().from(processedGiftStreaks).where(eq(processedGiftStreaks.workspaceId, workspaceId));
    expect(new Map(persisted.map((streak) => [streak.streakKey, streak.repeatCount]))).toEqual(new Map([[key, 8], ['e'.repeat(64), 2]]));
    await repository.resetWorkspaceStatistics(workspaceId);
    expect(await send('stage-8-after-reset', 0, 8)).toMatchObject({ repeatCount: 0, duplicate: true });
    expect(await send('stage-9-live', 0, 9)).toMatchObject({ repeatCount: 1, streamTotal: 5, lifetimeTotal: 5 });
  });

  it('locks the cumulative count under concurrent delivery with different packet IDs', async () => {
    if (!integration) return;
    const workspaceId = 'support-parallel-stages';
    const repository = createSupporterRepository(integration.db);
    const result = await Promise.all([4, 1, 3, 5, 2, 5].map((totalCount, sequence) => repository.processGift(
      workspaceId, streamOne, { ...gift(`packet-${sequence}`, 3), repeatCount: totalCount }, identityKey,
      { streak: { key: 'f'.repeat(64), historicalCount: 0, totalCount } },
    )));
    expect(result.reduce((total, item) => total + item.repeatCount, 0)).toBe(5);
    expect(result.reduce((total, item) => total + item.pointsAdded, 0)).toBe(15);
    expect(Math.max(...result.map((item) => item.streamTotal))).toBe(15);
  });

  it('keeps old ledger entries authoritative and suppresses duplicate zero-value gift playback', async () => {
    if (!integration) return;
    const workspaceId = 'support-old-ledger';
    const repository = createSupporterRepository(integration.db);
    await repository.processGift(workspaceId, streamOne, gift('legacy-packet', 5), identityKey);
    const accounting = { upstreamEventId: 'legacy-packet', streak: { key: 'c'.repeat(64), historicalCount: 0, totalCount: 1 } };
    expect(await repository.processGift(workspaceId, streamOne, gift('streak:stage-1', 5), identityKey, accounting))
      .toMatchObject({ repeatCount: 0, duplicate: true });
    expect(await repository.processGift(workspaceId, streamOne, { ...gift('streak:stage-2', 5), repeatCount: 2 }, identityKey, {
      ...accounting, streak: { ...accounting.streak, totalCount: 2 },
    })).toMatchObject({ repeatCount: 1, streamTotal: 10 });
    expect(await repository.processGift(workspaceId, streamOne, gift('free-packet', 0), identityKey))
      .toMatchObject({ repeatCount: 1, pointsAdded: 0, duplicate: false });
    expect(await repository.processGift(workspaceId, streamOne, gift('free-packet', 0), identityKey))
      .toMatchObject({ repeatCount: 0, pointsAdded: 0, duplicate: true });
  });
});
