import type { FastifyPluginAsync } from 'fastify';
import {
  apiErrorSchema, giftSoundMappingSchema, giftSoundMappingsSchema, soundAssetSchema, soundAssetsSchema,
  updateGiftSoundMappingSchema, uploadSoundQuerySchema, workspaceParamsSchema,
  type UpdateGiftSoundMapping, type UploadSoundQuery, type WorkspaceParams,
} from '@tiktok-helper/contracts';
import type { SoundRepository } from './repository.js';
import { MAX_SOUND_BYTES, type SoundUploadStore } from './upload.js';

export interface SoundRoutesOptions { repository: SoundRepository; uploadStore?: SoundUploadStore }
export const soundRoutes: FastifyPluginAsync<SoundRoutesOptions> = async (app, options) => {
  if (options.uploadStore) {
    app.addContentTypeParser([
      'application/octet-stream', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/x-wav',
    ], { parseAs: 'buffer', bodyLimit: MAX_SOUND_BYTES }, (_request, body, done) => done(null, body));
    app.post<{ Params: WorkspaceParams; Querystring: UploadSoundQuery; Body: Buffer }>('/api/workspaces/:workspaceId/sounds', {
      schema: {
        params: workspaceParamsSchema, querystring: uploadSoundQuerySchema,
        response: { 201: soundAssetSchema, 400: apiErrorSchema, 413: apiErrorSchema, 415: apiErrorSchema },
      },
    }, async (request, reply) => {
      const displayName = request.query.displayName.trim().replace(/\.(wav|mp3|ogg|m4a)$/i, '').trim();
      if (!displayName) return reply.code(400).send({ error: { code: 'INVALID_SOUND_NAME', message: 'Sound name is required', requestId: request.id } });
      let stored;
      try {
        stored = await options.uploadStore!.save(request.body, request.headers['content-type'] ?? 'application/octet-stream');
      } catch (error) {
        if (error instanceof RangeError) return reply.code(413).send({ error: { code: 'SOUND_TOO_LARGE', message: 'Sound must be between 1 byte and 10 MB', requestId: request.id } });
        return reply.code(415).send({ error: { code: 'UNSUPPORTED_SOUND', message: 'Use WAV, MP3, OGG or M4A audio', requestId: request.id } });
      }
      try {
        const sound = await options.repository.createSound(request.params.workspaceId, { displayName, storageKey: stored.storageKey, mimeType: stored.mimeType });
        return reply.code(201).send(sound);
      } catch (error) {
        await stored.remove();
        throw error;
      }
    });
  }
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
      code: 'GIFT_OR_SOUND_NOT_FOUND', message: 'Observed gift or sound not found', requestId: request.id,
    } });
  });
};
