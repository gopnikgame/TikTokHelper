import { randomUUID } from 'node:crypto';

import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  apiErrorSchema, authSessionSchema, GIFT_GOAL_OVERLAY_TOKEN_HEADER, healthResponseSchema, readinessResponseSchema, STREAM_OVERLAY_KINDS,
  type ApiErrorResponse, type AuthSessionResponse, type GiftGoalConfiguration, type HealthResponse, type LikeGoalConfiguration, type ReadinessResponse,
  type StreamOverlayKind, type StreamOverlaySnapshotByKind,
} from '@tiktok-helper/contracts';
import { settingsRoutes } from './settings/routes.js';
import type { SettingsRepository } from './settings/repository.js';
import { soundRoutes } from './sounds/routes.js';
import type { SoundRepository } from './sounds/repository.js';
import type { SoundUploadStore } from './sounds/upload.js';
import { tiktokRoutes } from './tiktok/routes.js';
import type { TikTokSessionManager } from './tiktok/session-manager.js';
import { livePollRoutes } from './live-polls/routes.js';
import { giftRoutes } from './gifts/routes.js';
import type { GiftCatalogRepository } from './gifts/repository.js';
import { regionalGiftRoutes } from './gifts/regional-routes.js';
import type { RegionalGiftCatalogReader } from './gifts/regional-catalog.js';
import { giftGoalRoutes } from './gift-goals/routes.js';
import type { GiftGoalRepository } from './gift-goals/repository.js';
import { overlayRoutes } from './overlays/routes.js';
import { likeGoalRoutes } from './like-goals/routes.js';
import type { LikeGoalRepository } from './like-goals/repository.js';
import { recentChannelRoutes } from './channels/routes.js';
import type { RecentChannelRepository } from './channels/repository.js';
import { authRoutes } from './auth/routes.js';
import type { AuthService } from './auth/service.js';
import { authorizeLiveConnect, localPrincipal, resolveAccessPrincipal } from './auth/local-access.js';
import { automationRoutes } from './automation/routes.js';
import type { AutomationRepository } from './automation/repository.js';
import { ttsAssetRoutes } from './tts-assets/routes.js';
import { supporterRoutes } from './supporters/routes.js';
import type { SupporterRepository } from './supporters/repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    authPrincipal?: import('@tiktok-helper/contracts').AuthPrincipal;
  }
}

export type ReadinessCheck = () => boolean | Promise<boolean>;
type OverlaySnapshotReaders = {
  [Kind in StreamOverlayKind]?: (workspaceId: string) => StreamOverlaySnapshotByKind[Kind] | null;
};

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  readinessCheck?: ReadinessCheck;
  settingsRepository?: SettingsRepository;
  soundRepository?: SoundRepository;
  giftCatalogRepository?: GiftCatalogRepository;
  regionalGiftCatalog?: RegionalGiftCatalogReader;
  giftGoalRepository?: GiftGoalRepository;
  overlaySnapshots?: OverlaySnapshotReaders;
  likeGoalRepository?: LikeGoalRepository;
  recentChannelRepository?: RecentChannelRepository;
  automationRepository?: AutomationRepository;
  supporterRepository?: Pick<SupporterRepository, 'resetWorkspaceStatistics'>;
  soundRoot?: string;
  soundUploadRoot?: string;
  soundUploadStore?: SoundUploadStore;
  tiktokManager?: TikTokSessionManager;
  staticRoot?: string;
  authService?: AuthService;
  ttsAssetRoot?: string;
  localWorkspaceId?: string;
  onSoundChanged?: (soundId: string) => void;
  onGiftGoalChanged?: (workspaceId: string, configuration: GiftGoalConfiguration) => void;
  onLikeGoalChanged?: (workspaceId: string, configuration: LikeGoalConfiguration) => void;
  onAutomationChanged?: (workspaceId: string) => void;
  onSupporterStatisticsReset?: (workspaceId: string) => void;
}

export const LOG_REDACTION_PATHS = [
  'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
  'req.headers["' + GIFT_GOAL_OVERLAY_TOKEN_HEADER + '"]',
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
    if (request.routeOptions.url === '/gift-goal-overlay.html') {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
        .header('x-robots-tag', 'noindex, nofollow').header('x-content-type-options', 'nosniff')
        .header('content-security-policy',
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'");
    }
    if (options.authService?.integrated) {
      reply.header('x-robots-tag', 'noindex, nofollow').header('x-content-type-options', 'nosniff');
      if (request.url.startsWith('/api/') || reply.statusCode >= 400) reply.header('cache-control', 'no-store');
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if (request.routeOptions.url?.startsWith('/api/overlays/') && reply.statusCode === 200) return;
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

  const { authService, localWorkspaceId } = options;
  const standalonePrincipal = !authService && localWorkspaceId ? localPrincipal(localWorkspaceId) : null;
  if (authService) {
    if (authService.integrated) app.addHook('onRequest', async (request, reply) => {
      if (request.routeOptions.url?.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          request.headers.origin !== authService.publicOrigin) {
        return reply.code(403).send(errorResponse('FORBIDDEN', 'Request origin denied', request.id));
      }
    });
    app.register(authRoutes, { service: authService, localWorkspaceId });
  } else if (standalonePrincipal) {
    app.get<{ Reply: AuthSessionResponse }>('/api/auth/session', {
      schema: { response: { 200: authSessionSchema } },
    }, async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return { authenticated: true, mode: 'local', user: standalonePrincipal };
    });
  }
  if (authService || standalonePrincipal) {
    app.addHook('preHandler', async (request, reply) => {
      const route = request.routeOptions.url ?? '';
      const protectedRoute = route.startsWith('/api/workspaces/') || route.startsWith('/api/live/');
      if (!protectedRoute) return;
      const active = authService ? await resolveAccessPrincipal(request.headers, authService, localWorkspaceId) : null;
      const principal = active?.principal ?? standalonePrincipal;
      if (!principal) {
        return reply.code(401).send(errorResponse('UNAUTHENTICATED', 'Authentication required', request.id));
      }
      const params = request.params as { workspaceId?: unknown };
      const body = request.body as { workspaceId?: unknown } | undefined;
      const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : body?.workspaceId;
      if (typeof workspaceId !== 'string' || !principal.workspaces.some((workspace) => workspace.id === workspaceId)) {
        return reply.code(403).send(errorResponse('FORBIDDEN', 'Workspace access denied', request.id));
      }
      if (authService && route === '/api/live/connect' && request.method === 'POST') {
        const access = await authorizeLiveConnect(authService, active);
        if (!access.ok) return reply.code(access.error.code === 'ACCESS_UNAVAILABLE' ? 503 : 403)
          .send(errorResponse(access.error.code, access.error.message, request.id));
      }
      request.authPrincipal = principal;
    });
  }

  if (options.settingsRepository) {
    app.register(settingsRoutes, { repository: options.settingsRepository });
  }

  if (options.tiktokManager) {
    app.register(tiktokRoutes, { manager: options.tiktokManager });
    app.register(livePollRoutes, { manager: options.tiktokManager });
    app.addHook('onClose', async () => options.tiktokManager?.close());
  }

  if (options.soundRepository) {
    app.register(soundRoutes, {
      repository: options.soundRepository, regionalCatalog: options.regionalGiftCatalog,
      uploadStore: options.soundUploadStore, onSoundChanged: options.onSoundChanged,
    });
  }

  if (options.giftCatalogRepository) {
    app.register(giftRoutes, { repository: options.giftCatalogRepository });
  }

  if (options.regionalGiftCatalog) {
    app.register(regionalGiftRoutes, { catalog: options.regionalGiftCatalog });
  }

  if (options.giftGoalRepository) {
    app.register(giftGoalRoutes, { repository: options.giftGoalRepository, onChanged: options.onGiftGoalChanged });
  }

  for (const kind of STREAM_OVERLAY_KINDS) {
    const snapshot = options.overlaySnapshots?.[kind];
    if (snapshot) app.register(overlayRoutes, { kind, snapshot });
  }

  if (options.likeGoalRepository) {
    app.register(likeGoalRoutes, { repository: options.likeGoalRepository, onChanged: options.onLikeGoalChanged });
  }

  if (options.recentChannelRepository) {
    app.register(recentChannelRoutes, { repository: options.recentChannelRepository });
  }

  if (options.automationRepository) {
    app.register(automationRoutes, { repository: options.automationRepository, onChanged: options.onAutomationChanged });
  }

  if (options.supporterRepository) {
    app.register(supporterRoutes, {
      repository: options.supporterRepository,
      onReset: options.onSupporterStatisticsReset,
    });
  }

  if (options.ttsAssetRoot && options.authService) {
    app.register(ttsAssetRoutes, { root: options.ttsAssetRoot, authService: options.authService });
  }

  if (options.soundRoot) {
    app.register(fastifyStatic, {
      root: options.soundRoot, prefix: '/sounds/', decorateReply: false,
      cacheControl: true, maxAge: '1d', immutable: false,
    });
  }

  if (options.soundUploadRoot) {
    app.register(fastifyStatic, {
      root: options.soundUploadRoot, prefix: '/media/sounds/', decorateReply: false,
      cacheControl: true, maxAge: '1d', immutable: true,
      ...(options.authService?.integrated ? {
        allowedPath: (pathName: string) => /^\/?[0-9a-f-]+\.(wav|mp3|ogg|m4a)$/.test(pathName),
      } : {}),
    });
  }

  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot, wildcard: false });
  }

  return app;
}
