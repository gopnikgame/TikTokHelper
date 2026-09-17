import type { ConnectorEventMap, LiveConnector } from '../../src/tiktok/types.js';

export interface ConnectorStep<EventName extends keyof ConnectorEventMap = keyof ConnectorEventMap> {
  afterMs: number;
  eventName: EventName;
  payload: ConnectorEventMap[EventName];
}

export class ScriptedConnector implements LiveConnector {
  readonly #handlers = new Map<keyof ConnectorEventMap, Set<(event: never) => void>>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  connectCount = 0;
  disconnectCount = 0;

  constructor(private readonly steps: ConnectorStep[]) {}

  async connect(): Promise<void> {
    this.connectCount += 1;
    for (const step of this.steps) {
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        this.emit(step.eventName, step.payload);
      }, step.afterMs);
      this.#timers.add(timer);
    }
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  on<EventName extends keyof ConnectorEventMap>(
    eventName: EventName,
    handler: (event: ConnectorEventMap[EventName]) => void,
  ): void {
    const handlers = this.#handlers.get(eventName) ?? new Set();
    handlers.add(handler as (event: never) => void);
    this.#handlers.set(eventName, handlers);
  }

  emit<EventName extends keyof ConnectorEventMap>(
    eventName: EventName,
    payload: ConnectorEventMap[EventName],
  ): void {
    for (const handler of this.#handlers.get(eventName) ?? []) handler(payload as never);
  }

  removeAllListeners(): void { this.#handlers.clear(); }
}
