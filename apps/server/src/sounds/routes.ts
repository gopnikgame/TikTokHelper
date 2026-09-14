import type { FastifyPluginAsync } from 'fastify';
import {
  apiErrorSchema, giftSoundMappingSchema, giftSoundMappingsSchema, soundAssetsSchema,
  updateGiftSoundMappingSchema, workspaceParamsSchema, type UpdateGiftSoundMapping, type WorkspaceParams,
} from '@tiktok-helper/contracts';
import type { SoundRepository } from './repository.js';

export interface SoundRoutesOptions { repository: SoundRepository }
export const soundRoutes: FastifyPluginAsync<SoundRoutesOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/sounds', {
    schema: { params: workspaceParamsSchema, response: { 200: soundAssetsSchema } },
  }, async (request) => options.repository.listSounds(request.params.workspaceId));
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/gift-mappings', {
    schema: { params: workspaceParamsSchema, response: { 200: giftSoundMappingsSchema } },
  }, async (request) => options.repository.listMappings(request.params.workspaceId));
  app.put<{ Params: WorkspaceParams; Body: UpdateGiftSoundMapping }>('/api/workspaces/:workspaceId/gift-mappings', {
    schema: {
      params: workspaceParamsSchema, body: updateGiftSoundMappingSchema,
      response: { 200: giftSoundMappingSchema, 404: apiErrorSchema },
    },
  }, async (request, reply) => {
    const mapping = await options.repository.saveMapping(request.params.workspaceId, request.body);
    return mapping ?? reply.code(404).send({ error: {
      code: 'SOUND_NOT_FOUND', message: 'Sound not found', requestId: request.id,
    } });
  });
};
