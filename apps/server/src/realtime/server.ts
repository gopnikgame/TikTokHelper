import type { FastifyInstance } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import { Server } from 'socket.io';
import {
  type ClientToServerEvents, type CommandAcknowledgement, type RealtimeEvent,
  type RealtimeSnapshot, type ServerToClientEvents, validateClientEvent,
  type GiftCompletedEvent, type GiftGoalState, type GiftGoalUpdate, type LiveActivityState, type SupportLevelGrantedEvent,
} from '@tiktok-helper/contracts';
import type { TikTokSessionManager } from '../tiktok/session-manager.js';
import { RecentEventBuffer } from './buffer.js';
import type { AuthPrincipal } from '@tiktok-helper/contracts';

const roomFor = (workspaceId: string, diagnostics: boolean) =>
  `workspace:${workspaceId}:${diagnostics ? 'diagnostics' : 'standard'}`;
const workspaceRooms = (workspaceId: string) => [roomFor(workspaceId, false), roomFor(workspaceId, true)];

function eventForPrincipal(event: RealtimeEvent, isAdmin: boolean): RealtimeEvent {
  if (isAdmin || event.type !== 'chat.message') return event;
  return {
    type: event.type, generation: event.generation, sequence: event.sequence, eventId: event.eventId,
    senderDisplayName: event.senderDisplayName, senderUsername: event.senderUsername, text: event.text,
    ...(event.emotes ? { emotes: event.emotes } : {}),
    ...(event.language ? { language: event.language } : {}),
    ...(event.mentionedUsernames ? { mentionedUsernames: event.mentionedUsernames } : {}),
    ...(event.speakerContext ? { speakerContext: event.speakerContext } : {}),
    ...(event.historical ? { historical: event.historical } : {}),
  };
}
const invalidCommand: CommandAcknowledgement = {
  ok: false, error: { code: 'INVALID_COMMAND', message: 'Command validation failed' },
};
const forbidden: CommandAcknowledgement = {
  ok: false, error: { code: 'FORBIDDEN', message: 'Workspace access denied' },
};

export interface RealtimeServerOptions {
  authenticate?: (headers: IncomingHttpHeaders) => AuthPrincipal | null | Promise<AuthPrincipal | null>;
  authorizeWorkspace?: (workspaceId: string, principal?: AuthPrincipal) => boolean | Promise<boolean>;
  authorizeLiveConnect?: (headers: IncomingHttpHeaders) => CommandAcknowledgement | Promise<CommandAcknowledgement>;
  bufferCapacity?: number;
  origin?: string;
  sessionRecheckIntervalMs?: number;
  giftGoals?: {
    prepare(workspaceId: string): Promise<void>;
    snapshot(workspaceId: string): GiftGoalState | undefined;
  };
  prepareLiveActivity?(workspaceId: string): Promise<void>;
}

export interface RealtimeServer {
  publish(workspaceId: string, event: RealtimeEvent): void;
  publishSoundLibraryChanged(soundId: string): void;
  publishSupportLevelGranted(workspaceId: string, event: SupportLevelGrantedEvent): void;
  publishGiftCompleted(event: GiftCompletedEvent): void;
  publishGiftGoal(update: GiftGoalUpdate): void;
  scheduleLiveActivity(workspaceId: string): void;
  scheduleLivePoll(workspaceId: string): void;
  close(): Promise<void>;
}

export function attachRealtimeServer(
  app: FastifyInstance,
  manager: TikTokSessionManager,
  options: RealtimeServerOptions = {},
): RealtimeServer {
  const authorize = options.authorizeWorkspace ?? ((workspaceId: string) => workspaceId === 'primary');
  const buffer = new RecentEventBuffer(options.bufferCapacity);
  const commandResults = new Map<string, CommandAcknowledgement>();
  const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 16 * 1024,
    ...(options.origin ? { allowRequest: (request, done) => done(null, request.headers.origin === options.origin) } : {}),
  });
  const connectedSocketsByUser = new Map<string, number>();
  const presencePayload = () => ({ onlineUsers: connectedSocketsByUser.size });
  const broadcastPresence = () => io.emit('presence:update', presencePayload());

  function scheduleWorkspaceUpdate(
    workspaceId: string,
    timers: typeof activityTimers,
    publish: (rooms: string[]) => void,
  ): void {
    const rooms = workspaceRooms(workspaceId);
    const hasSubscribers = () => rooms.some((room) => io.sockets.adapter.rooms.has(room));
    if (timers.has(workspaceId) || !hasSubscribers()) return;
    const timer = setTimeout(() => {
      timers.delete(workspaceId);
      if (hasSubscribers()) publish(rooms);
    }, 500);
    timers.set(workspaceId, timer);
    timer.unref();
  }

  if (options.authenticate) {
    io.use(async (socket, next) => {
      try {
        const principal = await options.authenticate?.(socket.handshake.headers);
        if (!principal) return next(new Error('UNAUTHENTICATED'));
        socket.data.authPrincipal = principal;
        next();
      } catch { next(new Error('UNAUTHENTICATED')); }
    });
  }

  const commandKey = (workspaceId: string, commandId: string) => `${workspaceId}:${commandId}`;
  const remember = (workspaceId: string, commandId: string, result: CommandAcknowledgement): void => {
    commandResults.set(commandKey(workspaceId, commandId), result);
    if (commandResults.size > 1_000) {
      const oldest = commandResults.keys().next().value as string | undefined;
      if (oldest) commandResults.delete(oldest);
    }
  };

  io.on('connection', (socket) => {
    const principal = socket.data.authPrincipal as AuthPrincipal | undefined;
    if (principal) {
      connectedSocketsByUser.set(principal.userId, (connectedSocketsByUser.get(principal.userId) ?? 0) + 1);
      broadcastPresence();
      socket.once('disconnect', () => {
        const remaining = (connectedSocketsByUser.get(principal.userId) ?? 1) - 1;
        if (remaining > 0) connectedSocketsByUser.set(principal.userId, remaining);
        else connectedSocketsByUser.delete(principal.userId);
        broadcastPresence();
      });
    }
    let sessionCheck: Promise<boolean> | undefined;
    const validateSession = (): Promise<boolean> => {
      sessionCheck ??= (async () => {
        try {
          const current = await options.authenticate?.(socket.handshake.headers);
          if (current && principal && current.userId === principal.userId && current.isAdmin === principal.isAdmin &&
              principal.workspaces.every(({ id }) => current.workspaces.some((workspace) => workspace.id === id))) {
            socket.data.authPrincipal = current;
            return socket.connected;
          }
        } catch { /* An unavailable authority cannot confirm a private room. */ }
        socket.disconnect(true);
        return false;
      })().finally(() => { sessionCheck = undefined; });
      return sessionCheck;
    };
    if (options.sessionRecheckIntervalMs) {
      const recheck = setInterval(() => { void validateSession(); }, options.sessionRecheckIntervalMs);
      recheck.unref();
      socket.once('disconnect', () => clearInterval(recheck));
    }
    const canAccess = async (workspaceId: string): Promise<boolean> => {
      if (options.sessionRecheckIntervalMs && !await validateSession()) return false;
      return authorize(workspaceId, socket.data.authPrincipal as AuthPrincipal | undefined);
    };
    const isAdministrator = () => (socket.data.authPrincipal as AuthPrincipal | undefined)?.isAdmin === true;
    const prepareGiftGoal = async (workspaceId: string) => {
      try { await options.giftGoals?.prepare(workspaceId); }
      catch (error: unknown) {
        app.log.warn({ event: 'gift_goal_load_failed', errorName: error instanceof Error ? error.name : 'UnknownError' });
      }
    };
    socket.on('workspace:subscribe', async (raw, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const parsed = validateClientEvent('workspace:subscribe', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await canAccess(parsed.value.workspaceId)) return acknowledge(forbidden);
      const { workspaceId } = parsed.value;
      const diagnostics = isAdministrator();
      if (options.giftGoals || options.prepareLiveActivity) {
        await Promise.all([
          prepareGiftGoal(workspaceId),
          options.prepareLiveActivity?.(workspaceId).catch((error: unknown) => {
            app.log.warn({ event: 'like_goal_load_failed', errorName: error instanceof Error ? error.name : 'UnknownError' });
          }),
        ]);
      }
      if (!socket.connected) return;
      // The configured in-memory adapter joins synchronously. In the same turn we can
      // send the snapshot before any subsequent live delta reaches the new subscriber.
      await socket.join(roomFor(workspaceId, diagnostics));
      const status = manager.status(workspaceId);
      const replay = buffer.replay(
        workspaceId, parsed.value.generation ?? 0, parsed.value.lastSequence ?? 0,
      );
      const giftGoal = options.giftGoals?.snapshot(workspaceId);
      const liveActivity: LiveActivityState = manager.getLiveActivity(workspaceId);
      const livePoll = manager.getLivePoll(workspaceId);
      const snapshot: RealtimeSnapshot = {
        workspaceId,
        generation: status.generation,
        connectionId: status.connectionId,
        lastSequence: status.lastSequence,
        connectionState: status.state,
        replay: replay.events.map((event) => eventForPrincipal(event, diagnostics)),
        requiresFullRefresh: replay.requiresFullRefresh,
        ...(giftGoal ? { giftGoal } : {}),
        liveActivity,
        livePoll,
      };
      socket.emit('snapshot', snapshot);
      socket.emit('presence:update', presencePayload());
      acknowledge({ ok: true });
    });

    socket.on('live:connect', async (raw, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const parsed = validateClientEvent('live:connect', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await canAccess(parsed.value.workspaceId)) return acknowledge(forbidden);
      if (options.authorizeLiveConnect) {
        const access = await options.authorizeLiveConnect(socket.handshake.headers);
        if (!access.ok) return acknowledge(access);
      }
      if (!socket.connected) return;
      const cached = commandResults.get(commandKey(parsed.value.workspaceId, parsed.value.commandId));
      if (cached) return acknowledge(cached.ok ? { ...cached, duplicate: true } : cached);
      try {
        if (options.giftGoals) await prepareGiftGoal(parsed.value.workspaceId);
        if (!socket.connected) return;
        await manager.start(parsed.value.workspaceId, parsed.value.tiktokUsername);
        const result: CommandAcknowledgement = { ok: true };
        remember(parsed.value.workspaceId, parsed.value.commandId, result);
        acknowledge(result);
      } catch {
        const result: CommandAcknowledgement = {
          ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to connect to LIVE' },
        };
        remember(parsed.value.workspaceId, parsed.value.commandId, result);
        acknowledge(result);
      }
    });

    socket.on('live:disconnect', async (raw, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const parsed = validateClientEvent('live:disconnect', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await canAccess(parsed.value.workspaceId)) return acknowledge(forbidden);
      const cached = commandResults.get(commandKey(parsed.value.workspaceId, parsed.value.commandId));
      if (cached) return acknowledge(cached.ok ? { ...cached, duplicate: true } : cached);
      await manager.stop(parsed.value.workspaceId);
      const result: CommandAcknowledgement = { ok: true };
      remember(parsed.value.workspaceId, parsed.value.commandId, result);
      acknowledge(result);
    });
  });

  return {
    publish(workspaceId, event) {
      buffer.add(workspaceId, event);
      io.to(roomFor(workspaceId, false)).emit('event', eventForPrincipal(event, false));
      io.to(roomFor(workspaceId, true)).emit('event', event);
    },
    publishSoundLibraryChanged(soundId) { io.emit('sound-library:changed', { soundId }); },
    publishSupportLevelGranted(workspaceId, event) {
      if (event.workspaceId !== workspaceId) return;
      io.to(roomFor(workspaceId, false)).emit('support:level-granted', event);
      io.to(roomFor(workspaceId, true)).emit('support:level-granted', event);
    },
    publishGiftCompleted(event) {
      const current = manager.status(event.workspaceId);
      if (current.state !== 'live' || event.generation !== current.generation || event.connectionId !== current.connectionId) return;
      io.to(workspaceRooms(event.workspaceId)).emit('gift:completed', event);
    },
    publishGiftGoal(update) {
      const { state } = update;
      const current = manager.status(state.workspaceId);
      if (current.generation !== state.generation || (current.connectionId ?? null) !== state.connectionId) return;
      if (update.reached && current.state !== 'live') return;
      io.to(workspaceRooms(state.workspaceId)).emit('gift-goal:update', update);
    },
    scheduleLiveActivity(workspaceId) {
      scheduleWorkspaceUpdate(workspaceId, activityTimers,
        (rooms) => io.to(rooms).emit('live-activity:update', manager.getLiveActivity(workspaceId)));
    },
    scheduleLivePoll(workspaceId) {
      scheduleWorkspaceUpdate(workspaceId, pollTimers,
        (rooms) => io.to(rooms).emit('live-poll:update', manager.getLivePoll(workspaceId)));
    },
    async close() {
      for (const timers of [activityTimers, pollTimers]) {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      }
      io.local.disconnectSockets(true);
    },
  };
}
