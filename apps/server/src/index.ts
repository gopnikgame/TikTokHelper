import { sql } from 'drizzle-orm';
import { mkdir, readdir } from 'node:fs/promises';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { createSettingsRepository } from './settings/repository.js';
import { createTikTokConnector } from './tiktok/live-connector.js';
import { TikTokSessionManager } from './tiktok/session-manager.js';
import { attachRealtimeServer, type RealtimeServer } from './realtime/server.js';
import { createSoundRepository } from './sounds/repository.js';
import { createSoundUploadStore } from './sounds/upload.js';
import { createGiftCatalogRepository } from './gifts/repository.js';
import { createRecentChannelRepository } from './channels/repository.js';
import { createAuthRepository } from './auth/repository.js';
import { HttpIdentityBridge } from './auth/bridge-client.js';
import { AuthService, parseCookie } from './auth/service.js';
import { isTrustedLocalAccess, localPrincipal } from './auth/local-access.js';
import { createAutomationRepository } from './automation/repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const { client, db } = createDatabase(databaseUrl);
const workspaceId = process.env.DEFAULT_WORKSPACE_ID ?? 'primary';
const soundRoot = process.env.SOUND_ROOT;
const soundUploadRoot = process.env.SOUND_UPLOAD_ROOT;
if (soundUploadRoot) await mkdir(soundUploadRoot, { recursive: true });
const giftCatalogRepository = createGiftCatalogRepository(db);
const recentChannelRepository = createRecentChannelRepository(db);
const soundRepository = createSoundRepository(db, giftCatalogRepository);
const authRepository = createAuthRepository(db);
const authEnvironment = {
  authorizeUrl: process.env.VLINE_BRIDGE_AUTHORIZE_URL,
  tokenUrl: process.env.VLINE_BRIDGE_TOKEN_URL,
  clientId: process.env.VLINE_BRIDGE_CLIENT_ID,
  clientSecret: process.env.VLINE_BRIDGE_CLIENT_SECRET,
  redirectUri: process.env.VLINE_BRIDGE_REDIRECT_URI,
};
const authValues = Object.values(authEnvironment);
const configuredAuthValues = authValues.filter((value) => value !== undefined && value.length > 0).length;
if (configuredAuthValues > 0 && configuredAuthValues !== authValues.length) {
  throw new Error('All VLINE_BRIDGE_* variables are required when authentication is enabled');
}
const authConfigured = configuredAuthValues === authValues.length;
const authService = authConfigured ? new AuthService(
  authRepository,
  new HttpIdentityBridge(authEnvironment.tokenUrl!, authEnvironment.clientId!, authEnvironment.clientSecret!, authEnvironment.redirectUri!),
  { bridgeAuthorizeUrl: authEnvironment.authorizeUrl!, clientId: authEnvironment.clientId!, redirectUri: authEnvironment.redirectUri! },
) : undefined;
if (soundRoot) {
  const files = (await readdir(soundRoot)).filter((name) => /\.wav$/i.test(name));
  await soundRepository.seed(workspaceId, files.map((storageKey) => ({
    storageKey, displayName: storageKey.replace(/\.wav$/i, ''),
  })));
}
const realtimeRef: { current?: RealtimeServer } = {};
const tiktokManager = new TikTokSessionManager(createTikTokConnector, (workspaceId, event) => {
  if (event.type === 'gift.received') {
    void giftCatalogRepository.observe(workspaceId, event).catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({
        level: 'error', component: 'gift_catalog', event: 'gift_observe_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })}\n`);
    });
  }
  realtimeRef.current?.publish(workspaceId, event);
}, undefined, (entry) => process.stderr.write(`${JSON.stringify({ level: 'error', component: 'tiktok', ...entry })}\n`), (workspaceId, username) => {
  void recentChannelRepository.record(workspaceId, username).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      level: 'error', component: 'recent_channels', event: 'connection_record_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })}\n`);
  });
});
const app = buildApp({
  readinessCheck: async () => {
    try { await db.execute(sql`select 1`); return true; } catch { return false; }
  },
  settingsRepository: createSettingsRepository(db),
  soundRepository,
  giftCatalogRepository,
  recentChannelRepository,
  automationRepository: createAutomationRepository(db),
  soundRoot,
  soundUploadRoot,
  soundUploadStore: soundUploadRoot ? createSoundUploadStore(soundUploadRoot) : undefined,
  tiktokManager,
  authService,
  localWorkspaceId: workspaceId,
  onSoundChanged: (soundId) => realtimeRef.current?.publishSoundLibraryChanged(soundId),
  staticRoot: process.env.WEB_ROOT,
});
realtimeRef.current = attachRealtimeServer(app, tiktokManager, {
  ...(authService ? { authenticate: async (headers: import('node:http').IncomingHttpHeaders) => (
    isTrustedLocalAccess(headers)
      ? localPrincipal(workspaceId)
      : (await authService.resolve(parseCookie(headers.cookie, authService.cookieName)))?.principal ?? null
  ) } : {}),
  authorizeWorkspace: authService
    ? (requestedWorkspaceId, principal) => principal?.workspaces.some((workspace) => workspace.id === requestedWorkspaceId) ?? false
    : (requestedWorkspaceId) => requestedWorkspaceId === workspaceId,
});
app.addHook('preClose', async () => realtimeRef.current?.close());
app.addHook('onClose', async () => client.end());

try {
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
} catch (error) {
  app.log.error({ event: 'server_start_failed', errorName: error instanceof Error ? error.name : 'UnknownError' }, 'server start failed');
  await app.close();
  process.exitCode = 1;
}
