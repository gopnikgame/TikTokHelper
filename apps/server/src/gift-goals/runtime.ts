import type { ConnectionStateEvent, GiftEvent, GiftGoalConfiguration, GiftGoalState, GiftGoalUpdate } from '@tiktok-helper/contracts';
import type { LiveSessionSnapshot } from '../tiktok/types.js';
import type { GiftGoalRepository } from './repository.js';
import { GiftGoalTracker } from './tracker.js';

const PROGRESS_INTERVAL_MS = 250;

export class GiftGoalRuntime {
  readonly #tracker = new GiftGoalTracker();
  readonly #soundAssignments = new Map<string, string>();
  readonly #loading = new Map<string, Promise<GiftGoalConfiguration | null>>();
  readonly #timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly repository: Pick<GiftGoalRepository, 'get'>,
    private readonly liveStatus: (workspaceId: string) => LiveSessionSnapshot,
    private readonly publish: (update: GiftGoalUpdate) => void,
  ) {}

  async prepare(workspaceId: string, forAdministrator = false): Promise<void> {
    if (this.#tracker.hasWorkspace(workspaceId)) return;
    let loading = this.#loading.get(workspaceId);
    if (!loading) {
      loading = this.repository.get(workspaceId).finally(() => { this.#loading.delete(workspaceId); });
      this.#loading.set(workspaceId, loading);
    }
    const configuration = await loading;
    if (configuration || forAdministrator) this.configure(workspaceId, configuration);
  }

  configure(workspaceId: string, configuration: GiftGoalConfiguration | null): void {
    if (!this.#tracker.hasWorkspace(workspaceId)) {
      const status = this.liveStatus(workspaceId);
      this.#tracker.trackConnection(workspaceId, {
        type: 'connection.state', state: status.state, generation: status.generation,
        connectionId: status.connectionId, sequence: status.lastSequence,
      });
    }
    const configurationChanged = this.#tracker.setConfiguration(workspaceId, configuration);
    if (configurationChanged) {
      if (configuration?.soundAssetId) this.#soundAssignments.set(workspaceId, configuration.soundAssetId);
      else this.#soundAssignments.delete(workspaceId);
    }
    if (configurationChanged) this.#flush(workspaceId);
  }

  async refreshSound(soundId: string): Promise<void> {
    const affected = [...this.#soundAssignments].filter(([, assigned]) => assigned === soundId);
    // Quarantine retains the assignment, while deletion removes it in PostgreSQL.
    await Promise.all(affected.map(async ([workspaceId]) => {
      this.configure(workspaceId, await this.repository.get(workspaceId));
    }));
  }

  snapshot(workspaceId: string): GiftGoalState | undefined {
    return this.#tracker.hasWorkspace(workspaceId) ? this.#tracker.snapshot(workspaceId) : undefined;
  }

  trackConnection(workspaceId: string, event: ConnectionStateEvent): void {
    if (this.#tracker.hasWorkspace(workspaceId) && this.#tracker.trackConnection(workspaceId, event)) this.#flush(workspaceId);
  }

  observe(workspaceId: string, connectionId: string, gift: GiftEvent, identityKey: string): void {
    const result = this.#tracker.observe(workspaceId, connectionId, gift, identityKey);
    if (!result.changed) return;
    if (result.reached) { this.#flush(workspaceId, true); return; }
    if (this.#timers.has(workspaceId)) return;
    const timer = setTimeout(() => this.#flush(workspaceId), PROGRESS_INTERVAL_MS);
    this.#timers.set(workspaceId, timer);
    timer.unref();
  }

  close(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #flush(workspaceId: string, reached = false): void {
    clearTimeout(this.#timers.get(workspaceId));
    this.#timers.delete(workspaceId);
    this.publish({ state: this.#tracker.snapshot(workspaceId), ...(reached ? { reached: true } : {}) });
  }
}
