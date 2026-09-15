import { and, eq } from 'drizzle-orm';
import type { GiftSoundMapping, SoundAsset, UpdateGiftSoundMapping } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { giftSoundRules, soundLibraryAssets, workspaces } from '../db/schema.js';
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
      await db.insert(soundLibraryAssets).values(sounds.map((sound) => ({
        originalWorkspaceId: workspaceId,
        storageKey: sound.storageKey, displayName: sound.displayName, mimeType: 'audio/wav',
      }))).onConflictDoNothing();
    },
    async listSounds() {
      const rows = await db.select().from(soundLibraryAssets)
        .where(eq(soundLibraryAssets.status, 'active'));
      return rows.map((row) => ({ id: row.id, displayName: row.displayName, url: soundUrl(row.storageKey) }));
    },
    async createSound(workspaceId, sound) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await db.insert(soundLibraryAssets).values({ originalWorkspaceId: workspaceId, ...sound }).returning();
      if (!row) throw new Error('Sound asset was not created');
      return { id: row.id, displayName: row.displayName, url: soundUrl(row.storageKey) };
    },
    async listMappings(workspaceId) {
      const rows = await db.select({
        giftId: giftSoundRules.giftId, soundAssetId: giftSoundRules.soundAssetId,
        soundDisplayName: soundLibraryAssets.displayName, storageKey: soundLibraryAssets.storageKey,
        isEnabled: giftSoundRules.isEnabled,
      }).from(giftSoundRules).innerJoin(
        soundLibraryAssets, eq(soundLibraryAssets.id, giftSoundRules.soundAssetId),
      ).where(eq(giftSoundRules.workspaceId, workspaceId));
      return rows.map((row) => ({ ...row, soundUrl: soundUrl(row.storageKey) }));
    },
    async saveMapping(workspaceId, input) {
      if (giftCatalog && !await giftCatalog.exists(workspaceId, input.giftId)) return null;
      const [sharedSound] = await db.select({
        id: soundLibraryAssets.id,
        displayName: soundLibraryAssets.displayName,
        storageKey: soundLibraryAssets.storageKey,
      }).from(soundLibraryAssets).where(and(
        eq(soundLibraryAssets.id, input.soundAssetId),
        eq(soundLibraryAssets.status, 'active'),
      )).limit(1);
      if (!sharedSound) return null;
      await db.insert(giftSoundRules).values({ workspaceId, ...input }).onConflictDoUpdate({
        target: [giftSoundRules.workspaceId, giftSoundRules.giftId],
        set: { soundAssetId: input.soundAssetId, isEnabled: input.isEnabled, updatedAt: new Date() },
      });
      return {
        giftId: input.giftId, soundAssetId: sharedSound.id, soundDisplayName: sharedSound.displayName,
        soundUrl: soundUrl(sharedSound.storageKey), isEnabled: input.isEnabled,
      };
    },
  };
}
