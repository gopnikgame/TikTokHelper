import type { FastifyPluginAsync } from 'fastify';
import {
  apiErrorSchema, updateWorkspaceSettingsSchema, workspaceParamsSchema, workspaceSettingsSchema,
  type ApiErrorResponse, type UpdateWorkspaceSettings, type WorkspaceParams, type WorkspaceSettings,
} from '@tiktok-helper/contracts';

import type { SettingsRepository } from './repository.js';

export interface SettingsRoutesOptions { repository: SettingsRepository; }

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams; Reply: WorkspaceSettings | ApiErrorResponse }>(
    '/api/workspaces/:workspaceId/settings',
    { schema: { params: workspaceParamsSchema, response: { 200: workspaceSettingsSchema, 404: apiErrorSchema } } },
    async (request, reply) => {
      const settings = await options.repository.get(request.params.workspaceId);
      if (!settings) return reply.code(404).send({ error: {
        code: 'SETTINGS_NOT_FOUND', message: 'Workspace settings not found', requestId: request.id,
      } });
      return settings;
    },
  );

  app.put<{ Params: WorkspaceParams; Body: UpdateWorkspaceSettings; Reply: WorkspaceSettings }>(
    '/api/workspaces/:workspaceId/settings',
    { schema: { params: workspaceParamsSchema, body: updateWorkspaceSettingsSchema, response: { 200: workspaceSettingsSchema } } },
    async (request) => options.repository.save(request.params.workspaceId, request.body),
  );
};
