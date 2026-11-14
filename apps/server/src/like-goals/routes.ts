import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  LIKE_GOAL_MAX_TARGET, saveLikeGoalSchema, workspaceParamsSchema,
  type ApiErrorResponse, type LikeGoalConfiguration, type SaveLikeGoal, type WorkspaceParams,
} from '@tiktok-helper/contracts';

import type { LikeGoalRepository } from './repository.js';

export interface LikeGoalRoutesOptions {
  repository: LikeGoalRepository;
  onChanged?(workspaceId: string, configuration: LikeGoalConfiguration): void;
}

async function validateInput(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as Partial<SaveLikeGoal> | null | undefined;
  const target = body?.targetCount;
  // Validate the raw JSON types before Fastify applies its default Ajv coercion.
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1
    && Object.hasOwn(body, 'targetCount') && (target === null
      || (typeof target === 'number' && Number.isInteger(target) && target >= 1 && target <= LIKE_GOAL_MAX_TARGET))) return;
  await reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id },
  } satisfies ApiErrorResponse);
}

const endpoint = '/api/workspaces/:workspaceId/like-goal';

export const likeGoalRoutes: FastifyPluginAsync<LikeGoalRoutesOptions> = async (app, options) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store'); });
  app.addHook('preHandler', async (request, reply) => {
    if (request.authPrincipal?.isAdmin === true) return;
    await reply.code(403).send({
      error: { code: 'FORBIDDEN', message: 'Administrator permission required', requestId: request.id },
    } satisfies ApiErrorResponse);
  });

  app.get<{ Params: WorkspaceParams; Reply: LikeGoalConfiguration | ApiErrorResponse }>(endpoint,
    { schema: { params: workspaceParamsSchema } },
    async (request) => options.repository.get(request.params.workspaceId),
  );

  app.put<{ Params: WorkspaceParams; Body: SaveLikeGoal; Reply: LikeGoalConfiguration | ApiErrorResponse }>(endpoint,
    { schema: { params: workspaceParamsSchema, body: saveLikeGoalSchema }, preValidation: validateInput },
    async (request) => {
      const { workspaceId } = request.params;
      const saved = await options.repository.save(workspaceId, request.body);
      options.onChanged?.(workspaceId, saved);
      return saved;
    },
  );
};
