import { sql } from 'drizzle-orm';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { createSettingsRepository } from './settings/repository.js';
import { createTikTokConnectorFactory } from './tiktok/live-connector.js';
import { TikTokSessionManager } from './tiktok/session-manager.js';
import type { LiveSessionSnapshot } from './tiktok/types.js';
import { attachRealtimeServer, type RealtimeServer } from './realtime/server.js';
import { createSoundRepository } from './sounds/repository.js';
import { createSoundUploadStore } from './sounds/upload.js';
import { inspectSoundFile, synchronizeSoundMetadata } from './sounds/metadata.js';
import { createGiftCatalogRepository } from './gifts/repository.js';
import { createRegionalGiftStore, RegionalGiftCatalog } from './gifts/regional-catalog.js';
import { fetchRegionalGifts } from './gifts/regional-provider.js';
import { createGiftGoalRepository } from './gift-goals/repository.js';
import { createLikeGoalRepository } from './like-goals/repository.js';
import { GiftGoalRuntime } from './gift-goals/runtime.js';
import { createRecentChannelRepository } from './channels/repository.js';
import { createAuthRepository } from './auth/repository.js';
import { HttpIdentityBridge } from './auth/bridge-client.js';
import { AuthService } from './auth/service.js';
import { authorizeLiveConnect, resolveAccessPrincipal } from './auth/local-access.js';
import { readBridgeConfiguration, readPublicBasePath } from './auth/configuration.js';
import { createAutomationRepository } from './automation/repository.js';
import { createSupporterRepository } from './supporters/repository.js';
import { EntitlementCache } from './supporters/entitlement-cache.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const basePath = readPublicBasePath(process.env.TIKTOK_HELPER_BASE_PATH);
const bridgeConfig = readBridgeConfiguration(process.env, basePath);
const createTikTokConnector = createTikTokConnectorFactory(process.env.TIKTOK_PROXY_URL);

const { client, db } = createDatabase(databaseUrl);
const workspaceId = process.env.DEFAULT_WORKSPACE_ID ?? 'primary';
const soundRoot = process.env.SOUND_ROOT;
const soundUploadRoot = process.env.SOUND_UPLOAD_ROOT;
if (soundUploadRoot) await mkdir(soundUploadRoot, { recursive: true });
const giftCatalogRepository = createGiftCatalogRepository(db);
const regionalCatalogKey = process.env.TIKTOK_REGIONAL_CATALOG_API_KEY?.trim() || undefined;
const regionalGiftCatalog = new RegionalGiftCatalog(createRegionalGiftStore(db), (region) => fetchRegionalGifts(region, regionalCatalogKey));
const giftGoalRepository = createGiftGoalRepository(db);
const likeGoalRepository = createLikeGoalRepository(db);
const recentChannelRepository = createRecentChannelRepository(db);
const soundRepository = createSoundRepository(db, giftCatalogRepository, basePath);
const authRepository = createAuthRepository(db);
const supporterRepository = createSupporterRepository(db);
const entitlementCache = new EntitlementCache(supporterRepository);
const automationRepository = createAutomationRepository(db);
const authService = bridgeConfig ? new AuthService(
  authRepository,
  new HttpIdentityBridge(bridgeConfig.tokenUrl, bridgeConfig.credentials.clientId,
    bridgeConfig.credentials.clientSecret, bridgeConfig.auth.redirectUri, bridgeConfig.entitlement),
  bridgeConfig.auth,
) : undefined;
if (soundRoot) {
  const files = (await readdir(soundRoot)).filter((name) => /\.wav$/i.test(name));
  await soundRepository.seed(workspaceId, await Promise.all(files.map(async (storageKey) => ({
    storageKey, displayName: storageKey.replace(/\.wav$/i, ''),
    ...await inspectSoundFile(join(soundRoot, storageKey)),
  }))));
}
const soundMetadata = await synchronizeSoundMetadata(db, { soundRoot, soundUploadRoot });
process.stdout.write(`${JSON.stringify({ level: 'info', component: 'sounds', event: 'metadata_synchronized', ...soundMetadata })}\n`);
const realtimeRef: { current?: RealtimeServer } = {};
async function prepareLiveActivity(id: string): Promise<void> {
  if (tiktokManager.getLiveActivity(id).likeGoal.revision > 0) return;
  tiktokManager.setLikeGoal(id, await likeGoalRepository.get(id));
}
const giftGoals = new GiftGoalRuntime(
  giftGoalRepository,
  (id): LiveSessionSnapshot => tiktokManager.status(id),
  (update) => realtimeRef.current?.publishGiftGoal(update),
);
const tiktokManager: TikTokSessionManager = new TikTokSessionManager(createTikTokConnector, (workspaceId, event) => {
  if (event.type === 'gift.received') {
    void giftCatalogRepository.observe(workspaceId, event).catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({
        level: 'error', component: 'gift_catalog', event: 'gift_observe_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })}\n`);
    });
  }
  realtimeRef.current?.publish(workspaceId, event);
  if (event.type === 'connection.state') giftGoals.trackConnection(workspaceId, event);
}, undefined, (entry) => process.stderr.write(`${JSON.stringify({ level: 'error', component: 'tiktok', ...entry })}\n`), (workspaceId, username) => {
  void recentChannelRepository.record(workspaceId, username).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      level: 'error', component: 'recent_channels', event: 'connection_record_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })}\n`);
  });
}, async (workspaceId, streamId, gift, identityKey, accounting) => {
  const result = await supporterRepository.processGift(workspaceId, streamId, gift, identityKey, accounting);
  return {
    repeatCount: result.repeatCount,
    applyEntitlements: () => entitlementCache.addGranted(workspaceId, streamId, identityKey, result.grantedLevels),
    announce() {
      for (const grant of result.grantedLevels) realtimeRef.current?.publishSupportLevelGranted(workspaceId, {
        eventId: `${gift.eventId}:${grant.level.id}`, workspaceId,
        senderDisplayName: gift.senderDisplayName, senderUsername: gift.senderUsername,
        levelId: grant.level.id, levelName: grant.level.name,
        thresholdPoints: grant.level.thresholdPoints, pointsAdded: result.pointsAdded,
        streamTotal: result.streamTotal, lifetimeTotal: result.lifetimeTotal,
        expiresAt: grant.expiresAt,
      });
    },
  };
}, async (workspaceId, streamId) => {
  await Promise.all([giftGoals.prepare(workspaceId).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      level: 'warn', component: 'gift_goals', event: 'gift_goal_load_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })}\n`);
  }), prepareLiveActivity(workspaceId).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      level: 'warn', component: 'live_activity', event: 'like_goal_load_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })}\n`);
  })]);
  await entitlementCache.prepare(workspaceId, streamId).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      level: 'error', component: 'supporters', event: 'entitlement_cache_prepare_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })}\n`);
  });
}, (workspaceId, identityKey, roles) => entitlementCache.speakerContext(workspaceId, identityKey, roles),
supporterRepository.rememberHistoricalStreak, async (event, streakable) => {
  // Ordinary gifts have already been claimed by processGift. Finals with no increment need their own claim.
  if (streakable && !await supporterRepository.claimGiftCompletion(event.workspaceId, event.eventId)) return;
  realtimeRef.current?.publishGiftCompleted(event);
}, (workspaceId, connectionId, gift, identityKey) => giftGoals.observe(workspaceId, connectionId, gift, identityKey),
(id) => realtimeRef.current?.scheduleLiveActivity(id));
const app = buildApp({
  readinessCheck: async () => {
    try { await db.execute(sql`select 1`); return true; } catch { return false; }
  },
  settingsRepository: createSettingsRepository(db),
  soundRepository,
  giftCatalogRepository,
  regionalGiftCatalog,
  giftGoalRepository,
  likeGoalRepository,
  recentChannelRepository,
  automationRepository,
  supporterRepository,
  soundRoot,
  soundUploadRoot,
  soundUploadStore: soundUploadRoot ? createSoundUploadStore(soundUploadRoot) : undefined,
  tiktokManager,
  authService,
  ttsAssetRoot: process.env.TTS_ASSET_ROOT,
  localWorkspaceId: workspaceId,
  onSoundChanged: (soundId) => {
    realtimeRef.current?.publishSoundLibraryChanged(soundId);
    void giftGoals.refreshSound(soundId).catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({
        level: 'warn', component: 'gift_goals', event: 'gift_goal_sound_refresh_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })}\n`);
    });
  },
  onGiftGoalChanged: (workspaceId, configuration) => giftGoals.configure(workspaceId, configuration),
  onLikeGoalChanged: (id, configuration) => tiktokManager.setLikeGoal(id, configuration),
  onAutomationChanged: (changedWorkspaceId) => {
    void entitlementCache.refresh(changedWorkspaceId).catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({
        level: 'error', component: 'supporters', event: 'entitlement_cache_refresh_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })}\n`);
    });
  },
  onSupporterStatisticsReset: (changedWorkspaceId) => entitlementCache.clear(changedWorkspaceId),
  staticRoot: process.env.WEB_ROOT,
});
realtimeRef.current = attachRealtimeServer(app, tiktokManager, {
  origin: authService?.publicOrigin,
  prepareLiveActivity,
  giftGoals: {
    prepare: (id) => giftGoals.prepare(id, true),
    snapshot: (id) => giftGoals.snapshot(id),
  },
  sessionRecheckIntervalMs: authService?.integrated ? 15_000 : undefined,
  ...(authService ? { authenticate: async (headers: import('node:http').IncomingHttpHeaders) => (
    (await resolveAccessPrincipal(headers, authService, workspaceId))?.principal ?? null
  ) } : {}),
  authorizeWorkspace: authService
    ? (requestedWorkspaceId, principal) => principal?.workspaces.some((workspace) => workspace.id === requestedWorkspaceId) ?? false
    : (requestedWorkspaceId) => requestedWorkspaceId === workspaceId,
  ...(authService ? { authorizeLiveConnect: async (headers: import('node:http').IncomingHttpHeaders) => {
    try {
      return await authorizeLiveConnect(authService, await resolveAccessPrincipal(headers, authService, workspaceId));
    } catch {
      return { ok: false as const, error: { code: 'ACCESS_UNAVAILABLE' as const, message: 'access_verification_unavailable' } };
    }
  } } : {}),
});
app.addHook('preClose', async () => realtimeRef.current?.close());
app.addHook('onClose', async () => { giftGoals.close(); await client.end(); });

try {
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
} catch (error) {
  app.log.error({ event: 'server_start_failed', errorName: error instanceof Error ? error.name : 'UnknownError' }, 'server start failed');
  await app.close();
  process.exitCode = 1;
}
