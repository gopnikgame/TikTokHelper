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
  foreignKey({
    columns: [table.workspaceId, table.soundAssetId],
    foreignColumns: [soundAssets.workspaceId, soundAssets.id],
  }).onDelete('cascade'),
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
