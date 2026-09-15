import type { FastifyPluginAsync } from 'fastify';
import {
  apiErrorSchema, giftSoundMappingSchema, giftSoundMappingsSchema, soundAssetSchema, soundAssetsSchema,
  quarantineSoundInputSchema, soundParamsSchema, updateGiftSoundMappingSchema, uploadSoundQuerySchema, workspaceParamsSchema,
  type QuarantineSoundInput, type UpdateGiftSoundMapping, type UploadSoundQuery, type WorkspaceParams,
} from '@tiktok-helper/contracts';
import type { SoundRepository } from './repository.js';
import { MAX_SOUND_BYTES, type SoundUploadStore } from './upload.js';
import { LOCAL_ACCESS_USER_ID } from '../auth/local-access.js';

export interface SoundRoutesOptions { repository: SoundRepository; uploadStore?: SoundUploadStore; onSoundChanged?: (soundId: string) => void }
interface SoundParams extends WorkspaceParams { soundId: string }
const actor = (request: { authPrincipal?: { userId: string; isAdmin: boolean } }) => request.authPrincipal
  ? { userId: request.authPrincipal.userId, isAdmin: request.authPrincipal.isAdmin }
  : undefined;
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
        const createdByUserId = request.authPrincipal?.userId === LOCAL_ACCESS_USER_ID ? undefined : request.authPrincipal?.userId;
        const sound = await options.repository.createSound(request.params.workspaceId, { displayName, storageKey: stored.storageKey, mimeType: stored.mimeType }, createdByUserId);
        return reply.code(201).send(sound);
      } catch (error) {
        await stored.remove();
        throw error;
      }
    });
  }
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/sounds', {
    schema: { params: workspaceParamsSchema, response: { 200: soundAssetsSchema } },
  }, async (request) => options.repository.listSounds(request.params.workspaceId, actor(request)));
  app.patch<{ Params: SoundParams; Body: QuarantineSoundInput }>('/api/workspaces/:workspaceId/sounds/:soundId/quarantine', {
    schema: { params: soundParamsSchema, body: quarantineSoundInputSchema, response: { 200: soundAssetSchema, 400: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema } },
  }, async (request, reply) => {
    const current = actor(request);
    if (!current?.isAdmin) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Administrator permission required', requestId: request.id } });
    const reason = request.body.reason.trim();
    if (!reason) return reply.code(400).send({ error: { code: 'INVALID_REASON', message: 'Quarantine reason is required', requestId: request.id } });
    const sound = await options.repository.quarantineSound(request.params.soundId, current, reason);
    if (sound) options.onSoundChanged?.(sound.id);
    return sound ?? reply.code(404).send({ error: { code: 'SOUND_NOT_FOUND', message: 'Active sound not found', requestId: request.id } });
  });
  app.delete<{ Params: SoundParams }>('/api/workspaces/:workspaceId/sounds/:soundId', {
    schema: { params: soundParamsSchema, response: { 204: { type: 'null' }, 403: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema } },
  }, async (request, reply) => {
    const current = actor(request);
    if (!current) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Authenticated user required', requestId: request.id } });
    const result = await options.repository.deleteSound(request.params.soundId, current);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'forbidden' ? 403 : 409;
      const message = result.reason === 'in_use' ? `Sound is used by ${result.usageCount ?? 0} mappings` : result.reason === 'not_quarantined' ? 'Administrator must quarantine sound before deletion' : result.reason === 'forbidden' ? 'Only the uploader or administrator can delete this sound' : 'Sound not found';
      return reply.code(status).send({ error: { code: result.reason.toUpperCase(), message, requestId: request.id } });
    }
    await options.uploadStore?.remove(result.storageKey);
    options.onSoundChanged?.(request.params.soundId);
    return reply.code(204).send();
  });
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
