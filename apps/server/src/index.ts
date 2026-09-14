import { sql } from 'drizzle-orm';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { createSettingsRepository } from './settings/repository.js';
import { createTikTokConnector } from './tiktok/live-connector.js';
import { TikTokSessionManager } from './tiktok/session-manager.js';
import { attachRealtimeServer, type RealtimeServer } from './realtime/server.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const { client, db } = createDatabase(databaseUrl);
const realtimeRef: { current?: RealtimeServer } = {};
const tiktokManager = new TikTokSessionManager(createTikTokConnector, (workspaceId, event) => {
  realtimeRef.current?.publish(workspaceId, event);
});
const app = buildApp({
  readinessCheck: async () => {
    try { await db.execute(sql`select 1`); return true; } catch { return false; }
  },
  settingsRepository: createSettingsRepository(db),
  tiktokManager,
  staticRoot: process.env.WEB_ROOT,
});
realtimeRef.current = attachRealtimeServer(app, tiktokManager, {
  authorizeWorkspace: (workspaceId) => workspaceId === (process.env.DEFAULT_WORKSPACE_ID ?? 'primary'),
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
