import { sql } from 'drizzle-orm';
import {
  boolean, check, foreignKey, index, integer, pgTable, primaryKey, smallint, text,
  timestamp, unique, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: varchar('id', { length: 64 }).primaryKey(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityProvider: varchar('identity_provider', { length: 32 }).notNull().default('vline'),
  identitySubject: varchar('identity_subject', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 120 }),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  globalRole: varchar('global_role', { length: 16 }).notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('users_identity_uidx').on(table.identityProvider, table.identitySubject),
  check('users_identity_provider_chk', sql`${table.identityProvider} ~ '^[a-z][a-z0-9_-]{0,31}$'`),
  check('users_identity_subject_chk', sql`length(trim(${table.identitySubject})) > 0`),
  check('users_status_chk', sql`${table.status} in ('active', 'disabled')`),
  check('users_global_role_chk', sql`${table.globalRole} in ('user', 'admin')`),
]);

export const workspaceMemberships = pgTable('workspace_memberships', {
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  index('workspace_memberships_user_idx').on(table.userId),
  check('workspace_memberships_role_chk', sql`${table.role} in ('owner', 'member')`),
]);

export const appSessions = pgTable('app_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('app_sessions_token_hash_uidx').on(table.tokenHash),
  index('app_sessions_user_idx').on(table.userId),
  index('app_sessions_expiry_idx').on(table.idleExpiresAt, table.absoluteExpiresAt),
  check('app_sessions_token_hash_chk', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check('app_sessions_idle_expiry_chk', sql`${table.idleExpiresAt} > ${table.createdAt}`),
  check('app_sessions_absolute_expiry_chk', sql`${table.absoluteExpiresAt} >= ${table.idleExpiresAt}`),
  check('app_sessions_revoked_at_chk', sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`),
]);

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  tiktokUsername: varchar('tiktok_username', { length: 24 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('channels_workspace_uidx').on(table.workspaceId),
  index('channels_workspace_idx').on(table.workspaceId),
]);

export const recentChannels = pgTable('recent_channels', {
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  tiktokUsername: varchar('tiktok_username', { length: 24 }).notNull(),
  connectionCount: integer('connection_count').notNull().default(1),
  firstConnectedAt: timestamp('first_connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.tiktokUsername] }),
  index('recent_channels_workspace_last_connected_idx').on(table.workspaceId, table.lastConnectedAt),
  check('recent_channels_connection_count_chk', sql`${table.connectionCount} >= 1`),
]);

export const workspacePreferences = pgTable('workspace_preferences', {
  workspaceId: varchar('workspace_id', { length: 64 }).primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  playbackMode: text('playback_mode').notNull().default('controlled_overlap'),
  overlapPercent: smallint('overlap_percent').notNull().default(25),
  maxConcurrentSounds: smallint('max_concurrent_sounds').notNull().default(4),
  volumePercent: smallint('volume_percent').notNull().default(80),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('workspace_preferences_playback_mode_chk', sql`${table.playbackMode} in ('controlled_overlap', 'sequential', 'strong_overlap')`),
  check('workspace_preferences_overlap_chk', sql`${table.overlapPercent} between 0 and 100`),
  check('workspace_preferences_concurrency_chk', sql`${table.maxConcurrentSounds} between 1 and 32`),
  check('workspace_preferences_volume_chk', sql`${table.volumePercent} between 0 and 100`),
  check('workspace_preferences_revision_chk', sql`${table.revision} >= 1`),
]);

export const soundAssets = pgTable('sound_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  displayName: varchar('display_name', { length: 160 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('sound_assets_workspace_storage_uidx').on(table.workspaceId, table.storageKey),
  unique('sound_assets_workspace_id_unique').on(table.workspaceId, table.id),
  index('sound_assets_workspace_idx').on(table.workspaceId),
  check('sound_assets_duration_chk', sql`${table.durationMs} is null or ${table.durationMs} > 0`),
]);

export const soundLibraryAssets = pgTable('sound_library_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalWorkspaceId: varchar('original_workspace_id', { length: 64 })
    .references(() => workspaces.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  storageKey: text('storage_key').notNull(),
  displayName: varchar('display_name', { length: 160 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  durationMs: integer('duration_ms'),
  contentSha256: varchar('content_sha256', { length: 64 }),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  quarantineReason: varchar('quarantine_reason', { length: 500 }),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
  quarantinedByUserId: uuid('quarantined_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('sound_library_assets_storage_uidx').on(table.storageKey),
  index('sound_library_assets_creator_idx').on(table.createdByUserId),
  check('sound_library_assets_duration_chk', sql`${table.durationMs} is null or ${table.durationMs} > 0`),
  check('sound_library_assets_sha256_chk', sql`${table.contentSha256} is null or ${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
  check('sound_library_assets_status_chk', sql`${table.status} in ('active', 'quarantined')`),
  check('sound_library_assets_quarantine_chk', sql`(${table.status} = 'active' and ${table.quarantineReason} is null and ${table.quarantinedAt} is null) or (${table.status} = 'quarantined' and ${table.quarantineReason} is not null and ${table.quarantinedAt} is not null)`),
]);

export const observedGifts = pgTable('observed_gifts', {
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  giftId: varchar('gift_id', { length: 80 }).notNull(),
  giftName: varchar('gift_name', { length: 160 }).notNull(),
  imageUrl: text('image_url'),
  diamondCount: integer('diamond_count'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.giftId] }),
  index('observed_gifts_workspace_last_seen_idx').on(table.workspaceId, table.lastSeenAt),
  check('observed_gifts_diamond_count_chk', sql`${table.diamondCount} is null or ${table.diamondCount} >= 0`),
]);

export const giftCatalog = pgTable('gift_catalog', {
  giftId: varchar('gift_id', { length: 80 }).primaryKey(),
  giftName: varchar('gift_name', { length: 160 }).notNull(),
  imageUrl: text('image_url'),
  diamondCount: integer('diamond_count'),
  firstSeenWorkspaceId: varchar('first_seen_workspace_id', { length: 64 })
    .references(() => workspaces.id, { onDelete: 'set null' }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('gift_catalog_last_seen_idx').on(table.lastSeenAt),
  check('gift_catalog_diamond_count_chk', sql`${table.diamondCount} is null or ${table.diamondCount} >= 0`),
]);

export const giftSoundRules = pgTable('gift_sound_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  giftId: varchar('gift_id', { length: 80 }).notNull(),
  soundAssetId: uuid('sound_asset_id').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('gift_sound_rules_workspace_gift_uidx').on(table.workspaceId, table.giftId),
  index('gift_sound_rules_workspace_idx').on(table.workspaceId),
  index('gift_sound_rules_sound_asset_idx').on(table.soundAssetId),
  foreignKey({ columns: [table.soundAssetId], foreignColumns: [soundLibraryAssets.id] })
    .onDelete('restrict'),
]);

export const workspaceSpeechPolicies = pgTable('workspace_speech_policies', {
  workspaceId: varchar('workspace_id', { length: 64 }).primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  moderatorSpeechEnabled: boolean('moderator_speech_enabled').notNull().default(false),
  moderatorCooldownSeconds: integer('moderator_cooldown_seconds').notNull().default(30),
  defaultSpeechCooldownSeconds: integer('default_speech_cooldown_seconds').notNull().default(30),
  maxMessageCharacters: integer('max_message_characters').notNull().default(200),
  maxQueueSize: integer('max_queue_size').notNull().default(20),
  readUserName: boolean('read_user_name').notNull().default(false),
  fallbackLanguage: varchar('fallback_language', { length: 16 }).notNull().default('ru-RU'),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('workspace_speech_policies_moderator_cooldown_chk', sql`${table.moderatorCooldownSeconds} between 5 and 3600`),
  check('workspace_speech_policies_default_cooldown_chk', sql`${table.defaultSpeechCooldownSeconds} between 5 and 3600`),
  check('workspace_speech_policies_message_length_chk', sql`${table.maxMessageCharacters} between 20 and 500`),
  check('workspace_speech_policies_queue_size_chk', sql`${table.maxQueueSize} between 1 and 100`),
  check('workspace_speech_policies_revision_chk', sql`${table.revision} >= 1`),
]);

export const supportLevels = pgTable('support_levels', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  thresholdPoints: integer('threshold_points').notNull(),
  pointsScope: varchar('points_scope', { length: 16 }).notNull(),
  privilegeDuration: varchar('privilege_duration', { length: 16 }).notNull(),
  privilegeDurationDays: integer('privilege_duration_days'),
  grantsChatSpeech: boolean('grants_chat_speech').notNull().default(false),
  chatSpeechCooldownSeconds: integer('chat_speech_cooldown_seconds').notNull().default(30),
  announcementTemplate: varchar('announcement_template', { length: 500 }),
  soundAssetId: uuid('sound_asset_id').references(() => soundLibraryAssets.id, { onDelete: 'set null' }),
  isEnabled: boolean('is_enabled').notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('support_levels_workspace_id_unique').on(table.workspaceId, table.id),
  index('support_levels_workspace_position_idx').on(table.workspaceId, table.position),
  index('support_levels_sound_asset_idx').on(table.soundAssetId),
  check('support_levels_threshold_chk', sql`${table.thresholdPoints} >= 1`),
  check('support_levels_scope_chk', sql`${table.pointsScope} in ('stream', 'lifetime')`),
  check('support_levels_duration_chk', sql`${table.privilegeDuration} in ('stream', 'days', 'permanent')`),
  check('support_levels_duration_days_chk', sql`(${table.privilegeDuration} = 'days' and ${table.privilegeDurationDays} between 1 and 3650) or (${table.privilegeDuration} <> 'days' and ${table.privilegeDurationDays} is null)`),
  check('support_levels_cooldown_chk', sql`${table.chatSpeechCooldownSeconds} between 5 and 3600`),
  check('support_levels_position_chk', sql`${table.position} between 0 and 10000`),
]);

export const eventReactions = pgTable('event_reactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  supportLevelId: uuid('support_level_id'),
  speechTemplate: varchar('speech_template', { length: 500 }),
  soundAssetId: uuid('sound_asset_id').references(() => soundLibraryAssets.id, { onDelete: 'set null' }),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('event_reactions_workspace_position_idx').on(table.workspaceId, table.position),
  index('event_reactions_sound_asset_idx').on(table.soundAssetId),
  foreignKey({ columns: [table.workspaceId, table.supportLevelId], foreignColumns: [supportLevels.workspaceId, supportLevels.id] }).onDelete('cascade'),
  check('event_reactions_type_chk', sql`${table.eventType} in ('moderator_seen', 'donor_seen', 'support_level_reached')`),
  check('event_reactions_cooldown_chk', sql`${table.cooldownSeconds} between 0 and 86400`),
  check('event_reactions_position_chk', sql`${table.position} between 0 and 10000`),
]);

export const processedGiftEvents = pgTable('processed_gift_events', {
  workspaceId: varchar('workspace_id', { length: 64 }).notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  eventId: varchar('event_id', { length: 160 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.eventId] }),
  index('processed_gift_events_expiry_idx').on(table.expiresAt),
]);
