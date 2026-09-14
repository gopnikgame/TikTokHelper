import type { FastifyPluginAsync } from 'fastify';
import { connectLiveCommandSchema, disconnectLiveCommandSchema, type ConnectLiveCommand, type DisconnectLiveCommand } from '@tiktok-helper/contracts';
import type { TikTokSessionManager } from './session-manager.js';

const snapshotSchema = {
  type: 'object', additionalProperties: false,
  required: ['workspaceId', 'tiktokUsername', 'generation', 'lastSequence', 'state'],
  properties: {
    workspaceId: { type: 'string' }, tiktokUsername: { type: ['string', 'null'] },
    generation: { type: 'integer', minimum: 0 }, lastSequence: { type: 'integer', minimum: 0 },
    state: { enum: ['stopped', 'connecting', 'live', 'reconnecting', 'offline', 'failed'] },
  },
} as const;

export interface TikTokRoutesOptions { manager: TikTokSessionManager }

export const tiktokRoutes: FastifyPluginAsync<TikTokRoutesOptions> = async (app, options) => {
  app.post<{ Body: ConnectLiveCommand }>('/api/live/connect', {
    schema: { body: connectLiveCommandSchema, response: { 200: snapshotSchema } },
  }, async (request) => options.manager.start(
    request.body.workspaceId, request.body.tiktokUsername,
  ));

  app.post<{ Body: DisconnectLiveCommand }>('/api/live/disconnect', {
    schema: { body: disconnectLiveCommandSchema, response: { 200: snapshotSchema } },
  }, async (request) => options.manager.stop(request.body.workspaceId));

  app.get<{ Params: { workspaceId: string } }>('/api/live/:workspaceId', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['workspaceId'],
        properties: { workspaceId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' } },
      },
      response: { 200: snapshotSchema },
    },
  }, async (request) => options.manager.status(request.params.workspaceId));
};
