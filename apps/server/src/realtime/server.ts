import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import {
  type ClientToServerEvents, type CommandAcknowledgement, type RealtimeEvent,
  type RealtimeSnapshot, type ServerToClientEvents, validateClientEvent,
} from '@tiktok-helper/contracts';
import type { TikTokSessionManager } from '../tiktok/session-manager.js';
import { RecentEventBuffer } from './buffer.js';

const roomFor = (workspaceId: string) => `workspace:${workspaceId}`;
const invalidCommand: CommandAcknowledgement = {
  ok: false, error: { code: 'INVALID_COMMAND', message: 'Command validation failed' },
};
const forbidden: CommandAcknowledgement = {
  ok: false, error: { code: 'FORBIDDEN', message: 'Workspace access denied' },
};

export interface RealtimeServerOptions {
  authorizeWorkspace?: (workspaceId: string) => boolean | Promise<boolean>;
  bufferCapacity?: number;
}

export interface RealtimeServer {
  publish(workspaceId: string, event: RealtimeEvent): void;
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

  const remember = (commandId: string, result: CommandAcknowledgement): void => {
    commandResults.set(commandId, result);
    if (commandResults.size > 1_000) {
      const oldest = commandResults.keys().next().value as string | undefined;
      if (oldest) commandResults.delete(oldest);
    }
  };

  io.on('connection', (socket) => {
    socket.on('workspace:subscribe', async (raw, acknowledge) => {
      const parsed = validateClientEvent('workspace:subscribe', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      if (!await authorize(parsed.value.workspaceId)) return acknowledge(forbidden);
      const status = manager.status(parsed.value.workspaceId);
      const replay = buffer.replay(
        parsed.value.workspaceId, parsed.value.generation, parsed.value.lastSequence,
      );
      const snapshot: RealtimeSnapshot = {
        workspaceId: parsed.value.workspaceId,
        generation: status.generation,
        lastSequence: status.lastSequence,
        connectionState: status.state,
        replay: replay.events,
        requiresFullRefresh: replay.requiresFullRefresh,
      };
      socket.emit('snapshot', snapshot);
      await socket.join(roomFor(parsed.value.workspaceId));
      for (const event of buffer.replay(
        parsed.value.workspaceId, snapshot.generation, snapshot.lastSequence,
      ).events) socket.emit('event', event);
      acknowledge({ ok: true });
    });

    socket.on('live:connect', async (raw, acknowledge) => {
      const parsed = validateClientEvent('live:connect', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      const cached = commandResults.get(parsed.value.commandId);
      if (cached) return acknowledge(cached.ok ? { ...cached, duplicate: true } : cached);
      if (!await authorize(parsed.value.workspaceId)) return acknowledge(forbidden);
      try {
        await manager.start(parsed.value.workspaceId, parsed.value.tiktokUsername);
        const result: CommandAcknowledgement = { ok: true };
        remember(parsed.value.commandId, result);
        acknowledge(result);
      } catch {
        const result: CommandAcknowledgement = {
          ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to connect to LIVE' },
        };
        remember(parsed.value.commandId, result);
        acknowledge(result);
      }
    });

    socket.on('live:disconnect', async (raw, acknowledge) => {
      const parsed = validateClientEvent('live:disconnect', raw);
      if (!parsed.ok) return acknowledge(invalidCommand);
      const cached = commandResults.get(parsed.value.commandId);
      if (cached) return acknowledge(cached.ok ? { ...cached, duplicate: true } : cached);
      if (!await authorize(parsed.value.workspaceId)) return acknowledge(forbidden);
      await manager.stop(parsed.value.workspaceId);
      const result: CommandAcknowledgement = { ok: true };
      remember(parsed.value.commandId, result);
      acknowledge(result);
    });
  });

  return {
    publish(workspaceId, event) {
      buffer.add(workspaceId, event);
      io.to(roomFor(workspaceId)).emit('event', event);
    },
    async close() { io.local.disconnectSockets(true); },
  };
}
