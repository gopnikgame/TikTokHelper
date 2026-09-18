import type { ChatSpeakerContext, SpeechLevelEntitlement } from '@tiktok-helper/contracts';
import type { GrantedSupportLevel, SupporterRepository } from './repository.js';

interface WorkspaceCache {
  streamId: string;
  byIdentity: Map<string, SpeechLevelEntitlement[]>;
}

export class EntitlementCache {
  readonly #workspaces = new Map<string, WorkspaceCache>();

  constructor(
    private readonly repository: Pick<SupporterRepository, 'listActiveSpeechEntitlements'>,
    private readonly now: () => number = Date.now,
  ) {}

  async prepare(workspaceId: string, streamId: string): Promise<void> {
    const rows = await this.repository.listActiveSpeechEntitlements(workspaceId, streamId);
    const byIdentity = new Map<string, SpeechLevelEntitlement[]>();
    for (const row of rows) {
      const current = byIdentity.get(row.identityKey) ?? [];
      current.push(row.entitlement);
      byIdentity.set(row.identityKey, current);
    }
    this.#workspaces.set(workspaceId, { streamId, byIdentity });
  }

  async refresh(workspaceId: string): Promise<void> {
    const current = this.#workspaces.get(workspaceId);
    if (current) await this.prepare(workspaceId, current.streamId);
  }

  clear(workspaceId: string): void {
    this.#workspaces.delete(workspaceId);
  }

  speakerContext(
    workspaceId: string, identityKey: string,
    roles: { isModerator: boolean; isGiftGiver: boolean },
  ): ChatSpeakerContext {
    const entitlements = this.#workspaces.get(workspaceId)?.byIdentity.get(identityKey) ?? [];
    const now = this.now();
    const speechLevels = entitlements.filter((item) => item.expiresAt === null || Date.parse(item.expiresAt) > now);
    return { ...roles, speechLevels };
  }

  addGranted(workspaceId: string, identityKey: string, grants: GrantedSupportLevel[]): void {
    const current = this.#workspaces.get(workspaceId);
    if (!current || grants.length === 0) return;
    const entitlements = current.byIdentity.get(identityKey) ?? [];
    for (const grant of grants) {
      if (!grant.level.grantsChatSpeech || !grant.level.isEnabled) continue;
      const item: SpeechLevelEntitlement = {
        levelId: grant.level.id, levelName: grant.level.name,
        cooldownSeconds: grant.level.chatSpeechCooldownSeconds, expiresAt: grant.expiresAt,
      };
      const index = entitlements.findIndex((existing) => existing.levelId === item.levelId);
      if (index >= 0) entitlements[index] = item; else entitlements.push(item);
    }
    current.byIdentity.set(identityKey, entitlements);
  }
}
