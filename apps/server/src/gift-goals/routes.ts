import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  saveGiftGoalSchema, workspaceParamsSchema,
  type ApiErrorResponse, type GiftGoalConfiguration, type SaveGiftGoal, type WorkspaceParams,
} from '@tiktok-helper/contracts';

import type { GiftGoalRepository } from './repository.js';

export interface GiftGoalRoutesOptions {
  repository: GiftGoalRepository;
  onChanged?(workspaceId: string, configuration: GiftGoalConfiguration): void;
}

function respondError(reply: FastifyReply, status: number, code: string, message: string, requestId: string): FastifyReply {
  return reply.code(status).send({ error: { code, message, requestId } } satisfies ApiErrorResponse);
}

async function validateInput(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as Partial<Record<keyof SaveGiftGoal, unknown>> | null | undefined;
  // Fastify's default Ajv configuration can coerce numeric strings, booleans and nulls.
  if (body && typeof body === 'object' && !Array.isArray(body)
    && typeof body.giftId === 'string' && typeof body.targetCount === 'number' && typeof body.isEnabled === 'boolean'
    && (body.soundAssetId === null || typeof body.soundAssetId === 'string')) return;
  await respondError(reply, 400, 'VALIDATION_ERROR', 'Request validation failed', request.id);
}

const endpoint = '/api/workspaces/:workspaceId/gift-goal';

export const giftGoalRoutes: FastifyPluginAsync<GiftGoalRoutesOptions> = async (app, options) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store'); });
  app.addHook('preHandler', async (request, reply) => {
    if (request.authPrincipal?.isAdmin === true) return;
    await respondError(reply, 403, 'FORBIDDEN', 'Administrator permission required', request.id);
  });

  app.get<{ Params: WorkspaceParams; Reply: GiftGoalConfiguration | null | ApiErrorResponse }>(endpoint,
    { schema: { params: workspaceParamsSchema } },
    async (request, reply) => reply.send(await options.repository.get(request.params.workspaceId)),
  );

  app.put<{ Params: WorkspaceParams; Body: SaveGiftGoal; Reply: GiftGoalConfiguration | ApiErrorResponse }>(endpoint,
    { schema: { params: workspaceParamsSchema, body: saveGiftGoalSchema }, preValidation: validateInput },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const saved = await options.repository.save(workspaceId, request.body);
      if (!saved) return respondError(reply, 422, 'GIFT_GOAL_ASSET_UNAVAILABLE', 'Selected gift or sound is unavailable', request.id);
      options.onChanged?.(workspaceId, saved);
      return saved;
    },
  );
};
