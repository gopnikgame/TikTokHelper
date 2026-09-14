import { randomUUID } from 'node:crypto';

import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  apiErrorSchema, healthResponseSchema, readinessResponseSchema,
  type ApiErrorResponse, type HealthResponse, type ReadinessResponse,
} from '@tiktok-helper/contracts';
import { settingsRoutes } from './settings/routes.js';
import type { SettingsRepository } from './settings/repository.js';
import { soundRoutes } from './sounds/routes.js';
import type { SoundRepository } from './sounds/repository.js';
import { tiktokRoutes } from './tiktok/routes.js';
import type { TikTokSessionManager } from './tiktok/session-manager.js';
import { giftRoutes } from './gifts/routes.js';
import type { GiftCatalogRepository } from './gifts/repository.js';

export type ReadinessCheck = () => boolean | Promise<boolean>;
export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  readinessCheck?: ReadinessCheck;
  settingsRepository?: SettingsRepository;
  soundRepository?: SoundRepository;
  giftCatalogRepository?: GiftCatalogRepository;
  soundRoot?: string;
  tiktokManager?: TikTokSessionManager;
  staticRoot?: string;
}

export const LOG_REDACTION_PATHS = [
  'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
  'authorization', 'cookie', 'password', 'secret', 'token', 'chatText',
  '*.authorization', '*.cookie', '*.password', '*.secret', '*.token', '*.chatText',
] as const;

const logRedaction = { paths: [...LOG_REDACTION_PATHS], censor: '[REDACTED]' };

const defaultLogger: NonNullable<FastifyServerOptions['logger']> = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: logRedaction,
};

function resolveLogger(logger: BuildAppOptions['logger']): FastifyServerOptions['logger'] {
  if (logger === false) return false;
  if (logger === true || logger === undefined) return defaultLogger;
  return {
    ...logger,
    redact: logRedaction,
  };
}

function errorResponse(code: string, message: string, requestId: string): ApiErrorResponse {
  return { error: { code, message, requestId } };
}

function hasValidation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'validation' in error
    && Array.isArray(error.validation);
}

function getErrorStatusCode(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return 500;
  return typeof error.statusCode === 'number' && error.statusCode >= 400
    ? error.statusCode
    : 500;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const readinessCheck = options.readinessCheck ?? (() => true);
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
    logger: resolveLogger(options.logger),
  });

  app.addSchema(apiErrorSchema);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      event: 'http_request_completed', method: request.method, requestId: request.id,
      responseTimeMs: reply.elapsedTime, route: request.routeOptions.url, statusCode: reply.statusCode,
    }, 'request completed');
  });

  app.setNotFoundHandler(async (request, reply) => reply
    .code(404)
    .send(errorResponse('NOT_FOUND', 'Resource not found', request.id)));

  app.setErrorHandler(async (error, request, reply) => {
    if (hasValidation(error)) {
      request.log.warn(
        { event: 'http_request_rejected', requestId: request.id, reason: 'validation' },
        'request rejected',
      );
      return reply.code(400).send(
        errorResponse('VALIDATION_ERROR', 'Request validation failed', request.id),
      );
    }

    const statusCode = getErrorStatusCode(error);
    request.log.error({
      event: 'http_request_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      requestId: request.id, statusCode,
    }, 'request failed');
    return reply.code(statusCode).send(
      errorResponse('INTERNAL_ERROR', 'Internal server error', request.id),
    );
  });

  app.get<{ Reply: HealthResponse }>('/health', {
    schema: { response: { 200: healthResponseSchema } },
  }, async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });

  app.get<{ Reply: ReadinessResponse }>('/ready', {
    schema: { response: { 200: readinessResponseSchema, 503: readinessResponseSchema } },
  }, async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return await readinessCheck()
      ? { status: 'ready' }
      : reply.code(503).send({ status: 'not_ready' });
  });

  if (options.settingsRepository) {
    app.register(settingsRoutes, { repository: options.settingsRepository });
  }

  if (options.tiktokManager) {
    app.register(tiktokRoutes, { manager: options.tiktokManager });
    app.addHook('onClose', async () => options.tiktokManager?.close());
  }

  if (options.soundRepository) {
    app.register(soundRoutes, { repository: options.soundRepository });
  }

  if (options.giftCatalogRepository) {
    app.register(giftRoutes, { repository: options.giftCatalogRepository });
  }

  if (options.soundRoot) {
    app.register(fastifyStatic, {
      root: options.soundRoot, prefix: '/sounds/', decorateReply: false,
      cacheControl: true, maxAge: '1d', immutable: false,
    });
  }

  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot, wildcard: false });
  }

  return app;
}
