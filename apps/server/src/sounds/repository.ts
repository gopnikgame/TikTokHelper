import { and, eq } from 'drizzle-orm';
import type { GiftSoundMapping, SoundAsset, UpdateGiftSoundMapping } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { giftSoundRules, soundAssets, workspaces } from '../db/schema.js';
import type { GiftCatalogRepository } from '../gifts/repository.js';

export interface BuiltInSound { displayName: string; storageKey: string }
export interface SoundRepository {
  seed(workspaceId: string, sounds: BuiltInSound[]): Promise<void>;
  listSounds(workspaceId: string): Promise<SoundAsset[]>;
  listMappings(workspaceId: string): Promise<GiftSoundMapping[]>;
  saveMapping(workspaceId: string, input: UpdateGiftSoundMapping): Promise<GiftSoundMapping | null>;
  createSound(workspaceId: string, sound: BuiltInSound & { mimeType: string }): Promise<SoundAsset>;
}

const soundUrl = (storageKey: string) => storageKey.startsWith('uploaded/')
  ? `/media/sounds/${encodeURIComponent(storageKey.slice('uploaded/'.length))}`
  : `/sounds/${encodeURIComponent(storageKey)}`;

export function createSoundRepository(db: Database, giftCatalog?: GiftCatalogRepository): SoundRepository {
  return {
    async seed(workspaceId, sounds) {
      if (sounds.length === 0) return;
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      await db.insert(soundAssets).values(sounds.map((sound) => ({
        workspaceId, storageKey: sound.storageKey, displayName: sound.displayName, mimeType: 'audio/wav',
      }))).onConflictDoNothing();
    },
    async listSounds(workspaceId) {
      const rows = await db.select().from(soundAssets).where(eq(soundAssets.workspaceId, workspaceId));
      return rows.map((row) => ({ id: row.id, displayName: row.displayName, url: soundUrl(row.storageKey) }));
    },
    async createSound(workspaceId, sound) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await db.insert(soundAssets).values({ workspaceId, ...sound }).returning();
      if (!row) throw new Error('Sound asset was not created');
      return { id: row.id, displayName: row.displayName, url: soundUrl(row.storageKey) };
    },
    async listMappings(workspaceId) {
      const rows = await db.select({
        giftId: giftSoundRules.giftId, soundAssetId: giftSoundRules.soundAssetId,
        soundDisplayName: soundAssets.displayName, storageKey: soundAssets.storageKey,
        isEnabled: giftSoundRules.isEnabled,
      }).from(giftSoundRules).innerJoin(soundAssets, and(
        eq(soundAssets.workspaceId, giftSoundRules.workspaceId),
        eq(soundAssets.id, giftSoundRules.soundAssetId),
      )).where(eq(giftSoundRules.workspaceId, workspaceId));
      return rows.map((row) => ({ ...row, soundUrl: soundUrl(row.storageKey) }));
    },
    async saveMapping(workspaceId, input) {
      if (giftCatalog && !await giftCatalog.exists(workspaceId, input.giftId)) return null;
      const [owned] = await db.select({ id: soundAssets.id, displayName: soundAssets.displayName, storageKey: soundAssets.storageKey })
        .from(soundAssets).where(and(eq(soundAssets.workspaceId, workspaceId), eq(soundAssets.id, input.soundAssetId))).limit(1);
      if (!owned) return null;
      await db.insert(giftSoundRules).values({ workspaceId, ...input }).onConflictDoUpdate({
        target: [giftSoundRules.workspaceId, giftSoundRules.giftId],
        set: { soundAssetId: input.soundAssetId, isEnabled: input.isEnabled, updatedAt: new Date() },
      });
      return {
        giftId: input.giftId, soundAssetId: owned.id, soundDisplayName: owned.displayName,
        soundUrl: soundUrl(owned.storageKey), isEnabled: input.isEnabled,
      };
    },
  };
}
