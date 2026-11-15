import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  apiErrorSchema, GIFT_GOAL_OVERLAY_TOKEN_HEADER, giftGoalOverlayLinkSchema, saveGiftGoalOverlayLinkSchema,
  streamOverlaySnapshotSchemas, workspaceParamsSchema,
  type ApiErrorResponse, type GiftGoalOverlayLink, type SaveGiftGoalOverlayLink, type StreamOverlayKind,
  type StreamOverlaySnapshot, type WorkspaceParams,
} from '@tiktok-helper/contracts';

import { OverlayAccess } from './access.js';

export function overlayDataPath(kind: StreamOverlayKind): string {
  return '/api/overlays/' + kind;
}

interface OverlayRoutesOptions {
  kind: StreamOverlayKind;
  snapshot(workspaceId: string): StreamOverlaySnapshot | null;
}

type ManagementRequest = { Params: WorkspaceParams; Reply: GiftGoalOverlayLink | ApiErrorResponse };

async function requireWorkspaceMember(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.authPrincipal) return;
  await reply.code(401).send({
    error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id },
  } satisfies ApiErrorResponse);
}

async function validateInput(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as Partial<Record<keyof SaveGiftGoalOverlayLink, unknown>> | null | undefined;
  // Validate before Fastify can coerce JSON strings or numbers into booleans.
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'enabled')
    && Object.keys(body).length === 1 && typeof body.enabled === 'boolean') return;
  await reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id },
  } satisfies ApiErrorResponse);
}

const managementSchema = {
  params: workspaceParamsSchema,
  response: { 200: giftGoalOverlayLinkSchema, 401: apiErrorSchema, 403: apiErrorSchema },
};

export const overlayRoutes: FastifyPluginAsync<OverlayRoutesOptions> = async (app, { kind, snapshot }) => {
  const access = new OverlayAccess(kind);
  const managementPath = '/api/workspaces/:workspaceId/' + kind + '-overlay';
  app.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store'); });

  app.get<ManagementRequest>(managementPath, {
    schema: managementSchema, preHandler: requireWorkspaceMember,
  }, async ({ params }) => ({ token: access.tokenFor(params.workspaceId) }));

  app.put<ManagementRequest & { Body: SaveGiftGoalOverlayLink }>(managementPath, {
    bodyLimit: 256,
    schema: { ...managementSchema, body: saveGiftGoalOverlayLinkSchema },
    preValidation: validateInput,
    preHandler: requireWorkspaceMember,
  }, async ({ params, body }) => ({ token: access.setEnabled(params.workspaceId, body.enabled) }));

  app.get<{ Reply: StreamOverlaySnapshot | null | ApiErrorResponse }>(overlayDataPath(kind), {
    schema: { response: { 200: streamOverlaySnapshotSchemas[kind], 401: apiErrorSchema } },
  }, async (request, reply) => {
    const workspaceId = access.resolve(request.headers[GIFT_GOAL_OVERLAY_TOKEN_HEADER]);
    if (workspaceId === null) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Overlay link is not authorized', requestId: request.id },
      });
    }
    return reply.send(snapshot(workspaceId));
  });
};
