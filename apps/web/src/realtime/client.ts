import { io, type Socket } from 'socket.io-client';
import { isGiftCompletedEvent } from '@tiktok-helper/contracts/gift-completion';
import { isGiftGoalState } from '@tiktok-helper/contracts/gift-goal';
import { isLiveActivityState } from '@tiktok-helper/contracts/live-activity';
import type {
  ClientToServerEvents, CommandAcknowledgement, GiftCompletedEvent, GiftGoalState, LiveActivityState, RealtimeEvent, RealtimeSnapshot,
  ServerToClientEvents, SupportLevelGrantedEvent,
} from '@tiktok-helper/contracts';
import { appPath } from '../app-path.js';

export interface RealtimeViewState {
  connectionState: RealtimeSnapshot['connectionState'];
  events: RealtimeEvent[];
  generation: number;
  connectionId?: string;
  lastSequence: number;
  isTransportConnected: boolean;
  hasCurrentSnapshot: boolean;
  onlineUsers: number | null;
  giftGoal: GiftGoalState | null;
  liveActivity: LiveActivityState | null;
}

export const EMPTY_REALTIME_STATE: RealtimeViewState = {
  connectionState: 'stopped', events: [], generation: 0, lastSequence: 0,
  isTransportConnected: false, hasCurrentSnapshot: false, onlineUsers: null, giftGoal: null, liveActivity: null,
};

type StateUpdate = 'applied' | 'ignored' | 'resync';

export class RealtimeStateModel {
  #state: RealtimeViewState = EMPTY_REALTIME_STATE;
  #snapshotOnTransport = false;
  #beforeSnapshot: RealtimeEvent[] = [];

  constructor(private readonly eventCapacity = 200) {}

  get state(): RealtimeViewState { return this.#state; }
  get snapshotOnTransport(): boolean { return this.#snapshotOnTransport; }

  setTransportConnected(value: boolean): void {
    if (!value) {
      this.#snapshotOnTransport = false;
      this.#beforeSnapshot = [];
    }
    this.#state = {
      ...this.#state, isTransportConnected: value,
      ...(!value ? { onlineUsers: null, hasCurrentSnapshot: false } : {}),
    };
  }

  setOnlineUsers(onlineUsers: number): void {
    this.#state = { ...this.#state, onlineUsers };
  }

  applySnapshot(snapshot: RealtimeSnapshot): StateUpdate {
    const previous = this.#state;
    const sameGeneration = snapshot.generation === previous.generation;
    const sameConnection = !previous.connectionId || !snapshot.connectionId || snapshot.connectionId === previous.connectionId;
    const older = snapshot.generation < previous.generation || (sameGeneration && snapshot.lastSequence < previous.lastSequence);
    const sameCursor = sameGeneration && snapshot.lastSequence === previous.lastSequence;
    const goal = snapshot.giftGoal;
    const activity = snapshot.liveActivity;
    const freshGoal = goal && (!previous.giftGoal || goal.revision > previous.giftGoal.revision);
    const freshActivity = activity && (!previous.liveActivity || activity.revision > previous.liveActivity.revision);
    if (this.#snapshotOnTransport && (older || (sameCursor && previous.hasCurrentSnapshot && !freshGoal && !freshActivity))) return 'ignored';

    const bySequence = new Map<number, RealtimeEvent>();
    if (!snapshot.requiresFullRefresh && sameGeneration && sameConnection && snapshot.lastSequence >= previous.lastSequence) {
      for (const event of previous.events) bySequence.set(event.sequence, event);
    }
    for (const event of snapshot.replay) {
      if (event.generation === snapshot.generation && event.sequence <= snapshot.lastSequence) {
        bySequence.set(event.sequence, event);
      }
    }
    this.#state = {
      ...previous,
      connectionState: snapshot.connectionState,
      events: [...bySequence.values()].sort((left, right) => left.sequence - right.sequence).slice(-this.eventCapacity),
      generation: snapshot.generation,
      connectionId: snapshot.connectionId,
      lastSequence: snapshot.lastSequence,
      hasCurrentSnapshot: true,
      giftGoal: sameGeneration && sameConnection && this.#snapshotOnTransport && previous.giftGoal
        && (!goal || previous.giftGoal.revision > goal.revision) ? previous.giftGoal : goal ?? null,
      liveActivity: sameGeneration && sameConnection && this.#snapshotOnTransport && previous.liveActivity
        && (!activity || previous.liveActivity.revision > activity.revision) ? previous.liveActivity : activity ?? null,
    };
    this.#snapshotOnTransport = true;
    const queued = this.#beforeSnapshot.sort((left, right) => left.generation - right.generation || left.sequence - right.sequence);
    this.#beforeSnapshot = [];
    // Events received while the cursor was uncertain only restore the feed.
    for (const event of queued) this.applyEvent(event);
    return this.#state.hasCurrentSnapshot ? 'applied' : 'resync';
  }

  applyEvent(event: RealtimeEvent): StateUpdate {
    if (!this.#state.hasCurrentSnapshot) {
      this.#queueBeforeSnapshot(event);
      return 'ignored';
    }
    const previous = this.#state;
    const sameGeneration = event.generation === previous.generation;
    if (event.generation < previous.generation || (sameGeneration && event.sequence <= previous.lastSequence)) return 'ignored';
    const expectedSequence = sameGeneration ? previous.lastSequence + 1 : 1;
    if (event.sequence !== expectedSequence) {
      this.#queueBeforeSnapshot(event);
      this.#state = { ...this.#state, hasCurrentSnapshot: false };
      return 'resync';
    }
    const recent = sameGeneration ? previous.events : [];
    const connectionState = sameGeneration ? previous.connectionState : 'connecting';
    const connectionId = event.type === 'connection.state' ? event.connectionId : undefined;
    this.#state = {
      ...previous,
      generation: event.generation,
      connectionId: connectionId ?? (sameGeneration ? previous.connectionId : undefined),
      giftGoal: sameGeneration && (!connectionId || connectionId === previous.connectionId) ? previous.giftGoal : null,
      liveActivity: sameGeneration && (!connectionId || connectionId === previous.connectionId) ? previous.liveActivity : null,
      connectionState: event.type === 'connection.state' ? event.state : connectionState,
      events: [...recent, event].slice(-this.eventCapacity),
      lastSequence: event.sequence,
    };
    return 'applied';
  }

  applyGiftGoal(goal: GiftGoalState): boolean {
    const current = this.#state;
    if (!current.isTransportConnected || !current.hasCurrentSnapshot || goal.generation !== current.generation
      || goal.connectionId !== (current.connectionId ?? null)
      || (current.giftGoal && goal.revision <= current.giftGoal.revision)) return false;
    this.#state = { ...current, giftGoal: goal };
    return true;
  }

  applyLiveActivity(activity: LiveActivityState): boolean {
    const current = this.#state;
    if (!current.isTransportConnected || !current.hasCurrentSnapshot || activity.generation !== current.generation
      || activity.connectionId !== (current.connectionId ?? null)
      || (current.liveActivity && activity.revision <= current.liveActivity.revision)) return false;
    this.#state = { ...current, liveActivity: activity };
    return true;
  }

  #queueBeforeSnapshot(event: RealtimeEvent): void {
    this.#beforeSnapshot.push(event);
    if (this.#beforeSnapshot.length > 100) this.#beforeSnapshot.shift();
  }
}

export interface RealtimeClient {
  connectLive(tiktokUsername: string): Promise<CommandAcknowledgement>;
  disconnectLive(): Promise<CommandAcknowledgement>;
  refreshSnapshot(): void;
  close(): void;
}

export function createRealtimeClient(
  workspaceId: string,
  onState: (state: RealtimeViewState) => void,
  socketOverride?: Socket<ServerToClientEvents, ClientToServerEvents>,
  onSoundLibraryChanged?: (soundId: string) => void,
  onSupportLevelGranted?: (event: SupportLevelGrantedEvent) => void,
  onAuthenticationInterrupted?: () => void,
  onLiveEvent?: (event: RealtimeEvent) => void,
  onGiftCompleted?: (event: GiftCompletedEvent) => void,
  onGiftGoalReached?: (state: GiftGoalState) => void,
  includeLiveActivity = false,
): RealtimeClient {
  const model = new RealtimeStateModel();
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = socketOverride ?? io({
    autoConnect: true,
    transports: ['websocket'],
    path: appPath('socket.io/'),
  });

  let pendingSubscription: string | undefined;
  let resyncRequested = false;
  const notify = () => onState(model.state);

  function subscribe(): void {
    if (!model.state.isTransportConnected || pendingSubscription) return;
    const commandId = crypto.randomUUID();
    pendingSubscription = commandId;
    resyncRequested = false;
    // A new transport may attach to a restarted process with reused numeric cursors.
    const { generation, lastSequence } = model.snapshotOnTransport ? model.state : EMPTY_REALTIME_STATE;
    socket.emit('workspace:subscribe', {
      commandId, workspaceId, generation, lastSequence,
    }, (result) => {
      if (pendingSubscription !== commandId) return;
      pendingSubscription = undefined;
      if (result.ok && resyncRequested && !model.state.hasCurrentSnapshot) subscribe();
    });
  }

  function resync(): void {
    resyncRequested = true;
    subscribe();
  }

  socket.on('connect', () => { model.setTransportConnected(true); notify(); subscribe(); });
  socket.on('disconnect', (reason) => {
    pendingSubscription = undefined;
    resyncRequested = false;
    model.setTransportConnected(false); notify();
    if (reason === 'io server disconnect') onAuthenticationInterrupted?.();
  });
  socket.on('connect_error', (error) => {
    if (error.message === 'UNAUTHENTICATED') onAuthenticationInterrupted?.();
  });
  socket.on('snapshot', (snapshot) => {
    if (snapshot.workspaceId !== workspaceId) return;
    const goal = snapshot.giftGoal;
    const validGoal = onGiftGoalReached && isGiftGoalState(goal) && goal.workspaceId === workspaceId
      && goal.generation === snapshot.generation && goal.connectionId === (snapshot.connectionId ?? null);
    const activity = snapshot.liveActivity;
    const validActivity = includeLiveActivity && isLiveActivityState(activity) && activity.workspaceId === workspaceId
      && activity.generation === snapshot.generation && activity.connectionId === (snapshot.connectionId ?? null);
    const outcome = model.applySnapshot({ ...snapshot,
      giftGoal: validGoal ? goal : undefined, liveActivity: validActivity ? activity : undefined,
    });
    if (outcome !== 'ignored') notify();
    if (outcome === 'resync') resync();
  });
  socket.on('event', (event) => {
    const outcome = model.applyEvent(event);
    if (outcome === 'ignored') return;
    notify();
    if (outcome === 'resync') { resync(); return; }
    if (model.state.isTransportConnected && !('historical' in event && event.historical)) onLiveEvent?.(event);
  });
  socket.on('presence:update', ({ onlineUsers }) => { model.setOnlineUsers(onlineUsers); notify(); });
  socket.on('sound-library:changed', ({ soundId }) => onSoundLibraryChanged?.(soundId));
  socket.on('support:level-granted', (event) => {
    if (model.state.isTransportConnected && model.state.hasCurrentSnapshot && event.workspaceId === workspaceId) {
      onSupportLevelGranted?.(event);
    }
  });
  if (onGiftCompleted) socket.on('gift:completed', (event) => {
    const current = model.state;
    if (current.isTransportConnected && current.hasCurrentSnapshot && current.connectionState === 'live'
      && isGiftCompletedEvent(event) && event.workspaceId === workspaceId
      && event.generation === current.generation && event.connectionId === current.connectionId) {
      onGiftCompleted(event);
    }
  });
  if (onGiftGoalReached) socket.on('gift-goal:update', (message) => {
    const goal = message?.state;
    if (!isGiftGoalState(goal) || goal.workspaceId !== workspaceId || !model.applyGiftGoal(goal)) return;
    notify();
    if (message.reached === true && model.state.connectionState === 'live'
      && goal.configuration?.isEnabled && goal.progress >= goal.configuration.targetCount) onGiftGoalReached(goal);
  });
  if (includeLiveActivity) socket.on('live-activity:update', (activity) => {
    if (isLiveActivityState(activity) && activity.workspaceId === workspaceId && model.applyLiveActivity(activity)) notify();
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
      const previousGeneration = model.state.generation;
      const result = await command('live:connect', {
        commandId: crypto.randomUUID(), workspaceId, tiktokUsername,
      });
      if (result.ok && (!model.state.hasCurrentSnapshot || previousGeneration === model.state.generation)) subscribe();
      return result;
    },
    disconnectLive: () => command('live:disconnect', { commandId: crypto.randomUUID(), workspaceId }),
    refreshSnapshot: subscribe,
    close: () => socket.close(),
  };
}
