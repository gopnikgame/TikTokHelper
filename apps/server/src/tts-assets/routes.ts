import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyPluginAsync } from 'fastify';

import type { AuthService } from '../auth/service.js';
import { parseCookie } from '../auth/service.js';

const VOICE_IDS = new Set([
  'ru-RU-irina-medium-int8', 'ru-RU-denis-medium-int8', 'ru-RU-dmitri-medium-int8',
  'ru-RU-ruslan-medium-int8', 'en-US-lessac-medium-int8', 'en-US-amy-medium-int8',
  'en-US-hfc-female-medium-int8', 'en-US-hfc-male-medium-int8',
]);
const FILE_NAMES = new Set([
  'sherpa-onnx-tts.worker.js',
  'sherpa-onnx-tts.js',
  'sherpa-onnx-wasm-main-tts.js',
  'sherpa-onnx-wasm-main-tts.wasm',
  'sherpa-onnx-wasm-main-tts.data',
]);

const contentType = (fileName: string): string => fileName.endsWith('.js')
  ? 'text/javascript; charset=utf-8'
  : fileName.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';

export interface TtsAssetRoutesOptions { root: string; authService: AuthService }

export const ttsAssetRoutes: FastifyPluginAsync<TtsAssetRoutesOptions> = async (app, options) => {
  app.get<{ Params: { voiceId: string; fileName: string } }>('/tts-assets/voices/:voiceId/:fileName', {
    preHandler: async (request, reply) => {
      const active = await options.authService.resolve(
        parseCookie(request.headers.cookie, options.authService.cookieName),
      );
      if (!active) return reply.code(401).send({ error: {
        code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id,
      } });
      if (!active.principal.isAdmin) return reply.code(403).send({ error: {
        code: 'FORBIDDEN', message: 'Administrator access required', requestId: request.id,
      } });
      request.authPrincipal = active.principal;
    },
  }, async (request, reply) => {
    const { voiceId, fileName } = request.params;
    if (!VOICE_IDS.has(voiceId) || !FILE_NAMES.has(fileName)) return reply.callNotFound();
    const path = join(options.root, voiceId, fileName);
    let metadata;
    try { metadata = await stat(path); } catch { return reply.callNotFound(); }
    if (!metadata.isFile()) return reply.callNotFound();
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    reply.header('content-length', String(metadata.size));
    reply.header('content-type', contentType(fileName));
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(createReadStream(path));
  });
};
