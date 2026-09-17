import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  automationItemParamsSchema, saveEventReactionSchema, saveSupportLevelSchema,
  updateWorkspaceSpeechPolicySchema, workspaceParamsSchema,
  type ApiErrorResponse, type AutomationItemParams,
  type EventReaction, type SaveEventReaction, type SaveSupportLevel, type SupportLevel,
  type UpdateWorkspaceSpeechPolicy, type WorkspaceParams, type WorkspaceSpeechPolicy,
} from '@tiktok-helper/contracts';

import type { AutomationRepository } from './repository.js';

export interface AutomationRoutesOptions {
  repository: AutomationRepository;
  onChanged?: (workspaceId: string) => void;
}

function missing(reply: FastifyReply, requestId: string): FastifyReply {
  return reply.code(404).send({ error: {
    code: 'AUTOMATION_ITEM_NOT_FOUND',
    message: 'Rule was not found or its selected sound is unavailable', requestId,
  } } satisfies ApiErrorResponse);
}

export const automationRoutes: FastifyPluginAsync<AutomationRoutesOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/automation', {
    schema: { params: workspaceParamsSchema },
  }, async (request) => options.repository.get(request.params.workspaceId));

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
    { schema: { params: workspaceParamsSchema, body: saveEventReactionSchema } },
    async (request, reply) => {
      const item = await options.repository.createEventReaction(request.params.workspaceId, request.body);
      return item ? reply.code(201).send(item) : missing(reply, request.id);
    },
  );
  app.put<{ Params: AutomationItemParams; Body: SaveEventReaction; Reply: EventReaction | ApiErrorResponse }>(
    '/api/workspaces/:workspaceId/automation/event-reactions/:itemId',
    { schema: { params: automationItemParamsSchema, body: saveEventReactionSchema } },
    async (request, reply) => {
      const item = await options.repository.updateEventReaction(request.params.workspaceId, request.params.itemId, request.body);
      return item ?? missing(reply, request.id);
    },
  );
  app.delete<{ Params: AutomationItemParams }>('/api/workspaces/:workspaceId/automation/event-reactions/:itemId', {
    schema: { params: automationItemParamsSchema },
  }, async (request, reply) => await options.repository.deleteEventReaction(request.params.workspaceId, request.params.itemId)
    ? reply.code(204).send()
    : missing(reply, request.id));
};
