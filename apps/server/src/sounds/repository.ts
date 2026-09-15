import { and, count, eq } from 'drizzle-orm';
import type { GiftSoundMapping, SoundAsset, UpdateGiftSoundMapping } from '@tiktok-helper/contracts';
import type { Database } from '../db/client.js';
import { giftSoundRules, soundLibraryAssets, workspaces } from '../db/schema.js';
import type { GiftCatalogRepository } from '../gifts/repository.js';

export interface BuiltInSound { displayName: string; storageKey: string }
export interface SoundActor { userId: string; isAdmin: boolean }
export type DeleteSoundResult =
  | { ok: true; storageKey: string; removedMappings: number }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'in_use' | 'not_quarantined'; usageCount?: number };
export interface SoundRepository {
  seed(workspaceId: string, sounds: BuiltInSound[]): Promise<void>;
  listSounds(workspaceId: string, actor?: SoundActor): Promise<SoundAsset[]>;
  listMappings(workspaceId: string): Promise<GiftSoundMapping[]>;
  saveMapping(workspaceId: string, input: UpdateGiftSoundMapping): Promise<GiftSoundMapping | null>;
  createSound(workspaceId: string, sound: BuiltInSound & { mimeType: string }, createdByUserId?: string): Promise<SoundAsset>;
  quarantineSound(soundId: string, actor: SoundActor, reason: string): Promise<SoundAsset | null>;
  deleteSound(soundId: string, actor: SoundActor): Promise<DeleteSoundResult>;
}

const soundUrl = (storageKey: string) => storageKey.startsWith('uploaded/')
  ? `/media/sounds/${encodeURIComponent(storageKey.slice('uploaded/'.length))}`
  : `/sounds/${encodeURIComponent(storageKey)}`;

export function createSoundRepository(db: Database, giftCatalog?: GiftCatalogRepository): SoundRepository {
  async function usageCount(soundId: string): Promise<number> {
    const [row] = await db.select({ value: count() }).from(giftSoundRules).where(eq(giftSoundRules.soundAssetId, soundId));
    return Number(row?.value ?? 0);
  }
  function present(row: typeof soundLibraryAssets.$inferSelect, actor?: SoundActor, used = 0): SoundAsset {
    const isOwnedByCurrentUser = actor !== undefined && row.createdByUserId === actor.userId;
    return {
      id: row.id, displayName: row.displayName, url: soundUrl(row.storageKey),
      status: row.status as SoundAsset['status'], createdByUserId: row.createdByUserId,
      isOwnedByCurrentUser, usageCount: used, quarantineReason: row.quarantineReason,
      canQuarantine: actor?.isAdmin === true && row.status === 'active',
      canDelete: row.status === 'quarantined' ? actor?.isAdmin === true : isOwnedByCurrentUser && used === 0,
    };
  }
  return {
    async seed(workspaceId, sounds) {
      if (sounds.length === 0) return;
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      await db.insert(soundLibraryAssets).values(sounds.map((sound) => ({
        originalWorkspaceId: workspaceId,
        storageKey: sound.storageKey, displayName: sound.displayName, mimeType: 'audio/wav',
      }))).onConflictDoNothing();
    },
    async listSounds(_workspaceId, actor) {
      const rows = await db.select({ asset: soundLibraryAssets, usageCount: count(giftSoundRules.id) })
        .from(soundLibraryAssets).leftJoin(giftSoundRules, eq(giftSoundRules.soundAssetId, soundLibraryAssets.id))
        .groupBy(soundLibraryAssets.id);
      return rows.filter(({ asset }) => asset.status === 'active' || actor?.isAdmin)
        .map(({ asset, usageCount: used }) => present(asset, actor, Number(used)));
    },
    async createSound(workspaceId, sound, createdByUserId) {
      await db.insert(workspaces).values({ id: workspaceId, displayName: workspaceId }).onConflictDoNothing();
      const [row] = await db.insert(soundLibraryAssets).values({ originalWorkspaceId: workspaceId, createdByUserId, ...sound }).returning();
      if (!row) throw new Error('Sound asset was not created');
      return present(row, createdByUserId ? { userId: createdByUserId, isAdmin: false } : undefined);
    },
    async listMappings(workspaceId) {
      const rows = await db.select({
        giftId: giftSoundRules.giftId, soundAssetId: giftSoundRules.soundAssetId,
        soundDisplayName: soundLibraryAssets.displayName, storageKey: soundLibraryAssets.storageKey,
        isEnabled: giftSoundRules.isEnabled,
      }).from(giftSoundRules).innerJoin(
        soundLibraryAssets, eq(soundLibraryAssets.id, giftSoundRules.soundAssetId),
      ).where(and(eq(giftSoundRules.workspaceId, workspaceId), eq(soundLibraryAssets.status, 'active')));
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
    async quarantineSound(soundId, actor, reason) {
      if (!actor.isAdmin) return null;
      const [row] = await db.update(soundLibraryAssets).set({
        status: 'quarantined', quarantineReason: reason, quarantinedAt: new Date(), quarantinedByUserId: actor.userId,
      }).where(and(eq(soundLibraryAssets.id, soundId), eq(soundLibraryAssets.status, 'active'))).returning();
      return row ? present(row, actor, await usageCount(soundId)) : null;
    },
    async deleteSound(soundId, actor) {
      return db.transaction(async (tx) => {
        const [asset] = await tx.select().from(soundLibraryAssets).where(eq(soundLibraryAssets.id, soundId)).for('update').limit(1);
        if (!asset) return { ok: false, reason: 'not_found' } as const;
        const [usage] = await tx.select({ value: count() }).from(giftSoundRules).where(eq(giftSoundRules.soundAssetId, soundId));
        const used = Number(usage?.value ?? 0);
        if (actor.isAdmin) {
          if (asset.status !== 'quarantined') return { ok: false, reason: 'not_quarantined' } as const;
          await tx.delete(giftSoundRules).where(eq(giftSoundRules.soundAssetId, soundId));
        } else {
          if (asset.createdByUserId !== actor.userId) return { ok: false, reason: 'forbidden' } as const;
          if (used > 0) return { ok: false, reason: 'in_use', usageCount: used } as const;
        }
        await tx.delete(soundLibraryAssets).where(eq(soundLibraryAssets.id, soundId));
        return { ok: true, storageKey: asset.storageKey, removedMappings: used } as const;
      });
    },
  };
}
