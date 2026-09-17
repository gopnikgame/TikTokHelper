import type { RealtimeEvent } from '@tiktok-helper/contracts';

export interface ReplayResult {
  events: RealtimeEvent[];
  requiresFullRefresh: boolean;
}

export class RecentEventBuffer {
  readonly #events = new Map<string, RealtimeEvent[]>();

  constructor(private readonly capacity = 500) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer');
  }

  add(workspaceId: string, event: RealtimeEvent): void {
    const events = this.#events.get(workspaceId) ?? [];
    events.push(event);
    if (events.length > this.capacity) events.splice(0, events.length - this.capacity);
    this.#events.set(workspaceId, events);
  }

  replay(workspaceId: string, generation?: number, lastSequence?: number): ReplayResult {
    const events = this.#events.get(workspaceId) ?? [];
    if (generation === undefined || lastSequence === undefined) return { events: [], requiresFullRefresh: false };
    const currentGeneration = events.at(-1)?.generation;
    // A new browser has no generation cursor yet. Its snapshot is authoritative,
    // so include the bounded recent context from the current generation instead
    // of treating generation 0 as an unrecoverable gap.
    if (generation === 0 && lastSequence === 0 && currentGeneration !== undefined) {
      return {
        events: events.filter((event) => event.generation === currentGeneration),
        requiresFullRefresh: false,
      };
    }
    if (currentGeneration !== undefined && generation !== currentGeneration) {
      return { events: [], requiresFullRefresh: true };
    }
    const sameGeneration = events.filter((event) => event.generation === generation);
    const oldestSequence = sameGeneration[0]?.sequence;
    if (oldestSequence !== undefined && lastSequence + 1 < oldestSequence) {
      return { events: [], requiresFullRefresh: true };
    }
    return {
      events: sameGeneration.filter((event) => event.sequence > lastSequence),
      requiresFullRefresh: false,
    };
  }
}
