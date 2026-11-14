import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  automationItemParamsSchema, saveEventReactionSchema, saveSupportLevelSchema,
  updateWorkspaceSpeechPolicySchema, workspaceParamsSchema,
  type ApiErrorResponse, type AutomationItemParams,
  type EventReaction, type SaveEventReaction, type SaveSupportLevel, type SupportLevel,
  type UpdateWorkspaceSpeechPolicy, type WorkspaceParams, type WorkspaceSpeechPolicy,
} from '@tiktok-helper/contracts';

import type { AutomationRepository, ReactionMoveDirection } from './repository.js';

export interface AutomationRoutesOptions {
  repository: AutomationRepository;
  onChanged?: (workspaceId: string) => void;
}

const moveEventReactionSchema = {
  type: 'object', additionalProperties: false, required: ['direction'],
  properties: { direction: { enum: ['up', 'down'] } },
} as const;

function missing(reply: FastifyReply, requestId: string): FastifyReply {
  return reply.code(404).send({ error: {
    code: 'AUTOMATION_ITEM_NOT_FOUND',
    message: 'Rule was not found or its selected gift or sound is unavailable', requestId,
  } } satisfies ApiErrorResponse);
}

function forbidden(reply: FastifyReply, requestId: string): FastifyReply {
  return reply.code(403).send({ error: {
    code: 'FORBIDDEN', message: 'Administrator permission required', requestId,
  } } satisfies ApiErrorResponse);
}

async function validateGiftFilterTypes(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as Partial<Record<'eventType' | 'giftId' | 'minimumGiftPoints' | 'supportLevelId', unknown>> | undefined;
  const eventType = Array.isArray(body?.eventType) ? body.eventType[0] : body?.eventType;
  if (eventType !== 'gift_completed') return;
  // Fastify's default type coercion would turn a missing-value placeholder such as null into a zero floor.
  if (body?.eventType === 'gift_completed' && typeof body.minimumGiftPoints === 'number'
      && (body.giftId === null || typeof body.giftId === 'string') && body.supportLevelId === null) return;
  await reply.code(400).send({ error: {
    code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id,
  } } satisfies ApiErrorResponse);
}

export const automationRoutes: FastifyPluginAsync<AutomationRoutesOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/automation', {
    schema: { params: workspaceParamsSchema },
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return options.repository.get(request.params.workspaceId, request.authPrincipal?.isAdmin === true);
  });

  app.put<{ Params: WorkspaceParams; Body: UpdateWorkspaceSpeechPolicy; Reply: WorkspaceSpeechPolicy }>(
    '/api/workspaces/:workspaceId/automation/policy',
    { schema: { params: workspaceParamsSchema, body: updateWorkspaceSpeechPolicySchema } },
    async (request) => options.repository.savePolicy(request.params.workspaceId, request.body),
  );

  app.post<{ Params: WorkspaceParams; Body: SaveSupportLevel; Reply: SupportLevel | ApiErrorResponse }>(
    '/api/workspaces/:workspaceId/automation/support-levels',
    { schema: { params: workspaceParamsSchema, body: saveSupportLevelSchema } },
    async (request, reply) => {
      const item = await options.repository.createSupportLevel(request.params.workspaceId, request.body);
      if (item) options.onChanged?.(request.params.workspaceId);
      return item ? reply.code(201).send(item) : missing(reply, request.id);
    },
  );
  app.put<{ Params: AutomationItemParams; Body: SaveSupportLevel; Reply: SupportLevel | ApiErrorResponse }>(
    '/api/workspaces/:workspaceId/automation/support-levels/:itemId',
    { schema: { params: automationItemParamsSchema, body: saveSupportLevelSchema } },
    async (request, reply) => {
      const item = await options.repository.updateSupportLevel(request.params.workspaceId, request.params.itemId, request.body);
      if (item) options.onChanged?.(request.params.workspaceId);
      return item ?? missing(reply, request.id);
    },
  );
  app.delete<{ Params: AutomationItemParams }>('/api/workspaces/:workspaceId/automation/support-levels/:itemId', {
    schema: { params: automationItemParamsSchema },
  }, async (request, reply) => {
    const deleted = await options.repository.deleteSupportLevel(request.params.workspaceId, request.params.itemId);
    if (deleted) options.onChanged?.(request.params.workspaceId);
    return deleted ? reply.code(204).send() : missing(reply, request.id);
  });

  app.post<{ Params: WorkspaceParams; Body: SaveEventReaction; Reply: EventReaction | ApiErrorResponse }>(
    '/api/workspaces/:workspaceId/automation/event-reactions',
    { schema: { params: workspaceParamsSchema, body: saveEventReactionSchema }, preValidation: validateGiftFilterTypes },
    async (request, reply) => {
      const allowGiftReactions = request.authPrincipal?.isAdmin === true;
      if (request.body.eventType === 'gift_completed' && !allowGiftReactions) return forbidden(reply, request.id);
      const item = await options.repository.createEventReaction(request.params.workspaceId, request.body, allowGiftReactions);
      return item ? reply.code(201).send(item) : missing(reply, request.id);
    },
  );
  app.put<{ Params: AutomationItemParams; Body: SaveEventReaction; Reply: EventReaction | ApiErrorResponse }>(
    '/api/workspaces/:workspaceId/automation/event-reactions/:itemId',
    { schema: { params: automationItemParamsSchema, body: saveEventReactionSchema }, preValidation: validateGiftFilterTypes },
    async (request, reply) => {
      const allowGiftReactions = request.authPrincipal?.isAdmin === true;
      if (request.body.eventType === 'gift_completed' && !allowGiftReactions) return forbidden(reply, request.id);
      const item = await options.repository.updateEventReaction(request.params.workspaceId, request.params.itemId, request.body, allowGiftReactions);
      return item ?? missing(reply, request.id);
    },
  );
  app.post<{ Params: AutomationItemParams; Body: { direction: ReactionMoveDirection } }>(
    '/api/workspaces/:workspaceId/automation/event-reactions/:itemId/move',
    { schema: { params: automationItemParamsSchema, body: moveEventReactionSchema } },
    async (request, reply) => {
      const moved = await options.repository.moveEventReaction(
        request.params.workspaceId, request.params.itemId, request.body.direction, request.authPrincipal?.isAdmin === true,
      );
      return moved ? reply.code(204).send() : missing(reply, request.id);
    },
  );
  app.delete<{ Params: AutomationItemParams }>('/api/workspaces/:workspaceId/automation/event-reactions/:itemId', {
    schema: { params: automationItemParamsSchema },
  }, async (request, reply) => {
    const deleted = await options.repository.deleteEventReaction(
      request.params.workspaceId, request.params.itemId, request.authPrincipal?.isAdmin === true,
    );
    return deleted ? reply.code(204).send() : missing(reply, request.id);
  });
};
