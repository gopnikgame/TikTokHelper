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
    const retained = this.#events.get(workspaceId);
    const events = retained?.at(-1)?.generation === event.generation ? retained : [];
    events.push(event);
    if (events.length > this.capacity) events.splice(0, events.length - this.capacity);
    this.#events.set(workspaceId, events);
  }

  replay(workspaceId: string, generation?: number, lastSequence?: number): ReplayResult {
    const events = this.#events.get(workspaceId) ?? [];
    if (generation === undefined || lastSequence === undefined) return { events: [], requiresFullRefresh: false };
    const latest = events.at(-1);
    // A new browser has no generation cursor yet. Its snapshot is authoritative,
    // so include the bounded recent context from the current generation instead
    // of treating generation 0 as an unrecoverable gap.
    if (generation === 0 && lastSequence === 0) {
      return { events: [...events], requiresFullRefresh: false };
    }
    if (!latest || generation !== latest.generation || lastSequence > latest.sequence) {
      return { events: [...events], requiresFullRefresh: true };
    }
    const oldestSequence = events[0]?.sequence;
    if (oldestSequence !== undefined && lastSequence + 1 < oldestSequence) {
      return { events: [...events], requiresFullRefresh: true };
    }
    return {
      events: events.filter((event) => event.sequence > lastSequence),
      requiresFullRefresh: false,
    };
  }
}
