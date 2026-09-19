import type { FastifyInstance } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import { Server } from 'socket.io';
import {
  type ClientToServerEvents, type CommandAcknowledgement, type RealtimeEvent,
  type RealtimeSnapshot, type ServerToClientEvents, validateClientEvent,
  type SupportLevelGrantedEvent,
} from '@tiktok-helper/contracts';
import type { TikTokSessionManager } from '../tiktok/session-manager.js';
import { RecentEventBuffer } from './buffer.js';
import type { AuthPrincipal } from '@tiktok-helper/contracts';

const roomFor = (workspaceId: string, diagnostics: boolean) =>
  `workspace:${workspaceId}:${diagnostics ? 'diagnostics' : 'standard'}`;

function eventForPrincipal(event: RealtimeEvent, isAdmin: boolean): RealtimeEvent {
  if (isAdmin || event.type !== 'chat.message') return event;
  return {
    type: event.type, generation: event.generation, sequence: event.sequence, eventId: event.eventId,
    senderDisplayName: event.senderDisplayName, senderUsername: event.senderUsername, text: event.text,
    ...(event.emotes ? { emotes: event.emotes } : {}),
    ...(event.language ? { language: event.language } : {}),
    ...(event.mentionedUsernames ? { mentionedUsernames: event.mentionedUsernames } : {}),
    ...(event.speakerContext ? { speakerContext: event.speakerContext } : {}),
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
}

export interface RealtimeServer {
  publish(workspaceId: string, event: RealtimeEvent): void;
  publishSoundLibraryChanged(soundId: string): void;
  publishSupportLevelGranted(workspaceId: string, event: SupportLevelGrantedEvent): void;
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
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 16 * 1024,
  });
  const connectedSocketsByUser = new Map<string, number>();
  const presencePayload = () => ({ onlineUsers: connectedSocketsByUser.size });
  const broadcastPresence = () => io.emit('presence:update', presencePayload());

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
    socket.on('workspace:subscribe', async (raw, acknowledge) => {
      const parsed = validateClientEvent('workspace:subscribe', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await authorize(parsed.value.workspaceId, socket.data.authPrincipal as AuthPrincipal | undefined)) return acknowledge(forbidden);
      const status = manager.status(parsed.value.workspaceId);
      const replay = buffer.replay(
        parsed.value.workspaceId, parsed.value.generation, parsed.value.lastSequence,
      );
      const diagnostics = (socket.data.authPrincipal as AuthPrincipal | undefined)?.isAdmin === true;
      const snapshot: RealtimeSnapshot = {
        workspaceId: parsed.value.workspaceId,
        generation: status.generation,
        lastSequence: status.lastSequence,
        connectionState: status.state,
        replay: replay.events.map((event) => eventForPrincipal(event, diagnostics)),
        requiresFullRefresh: replay.requiresFullRefresh,
      };
      socket.emit('snapshot', snapshot);
      socket.emit('presence:update', presencePayload());
      await socket.join(roomFor(parsed.value.workspaceId, diagnostics));
      for (const event of buffer.replay(
        parsed.value.workspaceId, snapshot.generation, snapshot.lastSequence,
      ).events) socket.emit('event', eventForPrincipal(event, diagnostics));
      acknowledge({ ok: true });
    });

    socket.on('live:connect', async (raw, acknowledge) => {
      const parsed = validateClientEvent('live:connect', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await authorize(parsed.value.workspaceId, socket.data.authPrincipal as AuthPrincipal | undefined)) return acknowledge(forbidden);
      if (options.authorizeLiveConnect) {
        const access = await options.authorizeLiveConnect(socket.handshake.headers);
        if (!access.ok) return acknowledge(access);
      }
      const cached = commandResults.get(commandKey(parsed.value.workspaceId, parsed.value.commandId));
      if (cached) return acknowledge(cached.ok ? { ...cached, duplicate: true } : cached);
      try {
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
      const parsed = validateClientEvent('live:disconnect', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await authorize(parsed.value.workspaceId, socket.data.authPrincipal as AuthPrincipal | undefined)) return acknowledge(forbidden);
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
    async close() { io.local.disconnectSockets(true); },
  };
}
