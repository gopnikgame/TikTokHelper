import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents, CommandAcknowledgement, RealtimeEvent, RealtimeSnapshot,
  ServerToClientEvents,
} from '@tiktok-helper/contracts';

export interface RealtimeViewState {
  connectionState: RealtimeSnapshot['connectionState'];
  events: RealtimeEvent[];
  generation: number;
  lastSequence: number;
  isTransportConnected: boolean;
}

const emptyState: RealtimeViewState = {
  connectionState: 'stopped', events: [], generation: 0, lastSequence: 0,
  isTransportConnected: false,
};

export class RealtimeStateModel {
  #state: RealtimeViewState = emptyState;
  #hasSnapshot = false;
  #beforeSnapshot: RealtimeEvent[] = [];

  constructor(private readonly eventCapacity = 200) {}

  get state(): RealtimeViewState { return this.#state; }

  setTransportConnected(value: boolean): void {
    this.#state = { ...this.#state, isTransportConnected: value };
  }

  applySnapshot(snapshot: RealtimeSnapshot): void {
    const retained = snapshot.requiresFullRefresh
      ? []
      : this.#state.events.filter((event) => event.generation === snapshot.generation);
    this.#state = {
      ...this.#state,
      connectionState: snapshot.connectionState,
      events: [...retained, ...snapshot.replay].slice(-this.eventCapacity),
      generation: snapshot.generation,
      lastSequence: snapshot.lastSequence,
    };
    this.#hasSnapshot = true;
    const queued = this.#beforeSnapshot;
    this.#beforeSnapshot = [];
    for (const event of queued) this.applyEvent(event);
  }

  applyEvent(event: RealtimeEvent): 'applied' | 'ignored' | 'resync' {
    if (!this.#hasSnapshot) {
      this.#beforeSnapshot.push(event);
      if (this.#beforeSnapshot.length > 100) this.#beforeSnapshot.shift();
      return 'ignored';
    }
    if (event.generation < this.#state.generation || event.sequence <= this.#state.lastSequence) return 'ignored';
    if (event.generation > this.#state.generation || event.sequence !== this.#state.lastSequence + 1) return 'resync';
    this.#state = {
      ...this.#state,
      connectionState: event.type === 'connection.state' ? event.state : this.#state.connectionState,
      events: [...this.#state.events, event].slice(-this.eventCapacity),
      lastSequence: event.sequence,
    };
    return 'applied';
  }
}

export interface RealtimeClient {
  connectLive(tiktokUsername: string): Promise<CommandAcknowledgement>;
  disconnectLive(): Promise<CommandAcknowledgement>;
  close(): void;
}

export function createRealtimeClient(
  workspaceId: string,
  onState: (state: RealtimeViewState) => void,
  socketOverride?: Socket<ServerToClientEvents, ClientToServerEvents>,
): RealtimeClient {
  const model = new RealtimeStateModel();
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = socketOverride ?? io({
    autoConnect: true,
    transports: ['websocket'],
  });

  const notify = () => onState(model.state);
  const subscribe = () => socket.emit('workspace:subscribe', {
    commandId: crypto.randomUUID(), workspaceId,
    generation: model.state.generation, lastSequence: model.state.lastSequence,
  }, () => undefined);

  socket.on('connect', () => { model.setTransportConnected(true); notify(); subscribe(); });
  socket.on('disconnect', () => { model.setTransportConnected(false); notify(); });
  socket.on('snapshot', (snapshot) => { model.applySnapshot(snapshot); notify(); });
  socket.on('event', (event) => {
    if (model.applyEvent(event) === 'resync') subscribe();
    notify();
  });

  const command = <Payload extends { commandId: string; workspaceId: string }>(
    eventName: 'live:connect' | 'live:disconnect', payload: Payload,
  ) => new Promise<CommandAcknowledgement>((resolve) => {
    if (eventName === 'live:connect' && 'tiktokUsername' in payload) {
      socket.emit('live:connect', payload as Payload & { tiktokUsername: string }, resolve);
    } else {
      socket.emit('live:disconnect', payload, resolve);
    }
  });

  return {
    connectLive: async (tiktokUsername) => {
      const result = await command('live:connect', {
        commandId: crypto.randomUUID(), workspaceId, tiktokUsername,
      });
      if (result.ok) subscribe();
      return result;
    },
    disconnectLive: () => command('live:disconnect', { commandId: crypto.randomUUID(), workspaceId }),
    close: () => socket.close(),
  };
}
