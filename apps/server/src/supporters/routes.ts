import type { FastifyPluginAsync } from 'fastify';
import { workspaceParamsSchema, type WorkspaceParams } from '@tiktok-helper/contracts';

import type { SupporterRepository } from './repository.js';

export interface SupporterRoutesOptions {
  repository: Pick<SupporterRepository, 'resetWorkspaceStatistics'>;
  onReset?: (workspaceId: string) => void;
}

const resetResponseSchema = {
  $id: 'supporterStatisticsResetResponse',
  type: 'object',
  additionalProperties: false,
  required: ['deletedSupporters'],
  properties: { deletedSupporters: { type: 'integer', minimum: 0 } },
} as const;

export const supporterRoutes: FastifyPluginAsync<SupporterRoutesOptions> = async (app, options) => {
  app.delete<{ Params: WorkspaceParams; Reply: { deletedSupporters: number } }>(
    '/api/workspaces/:workspaceId/supporters/statistics',
    { schema: { params: workspaceParamsSchema, response: { 200: resetResponseSchema } } },
    async (request) => {
      const { workspaceId } = request.params;
      const deletedSupporters = await options.repository.resetWorkspaceStatistics(workspaceId);
      options.onReset?.(workspaceId);
      request.log.info({
        event: 'supporter_statistics_reset', workspaceId, deletedSupporters,
        actorUserId: request.authPrincipal?.userId,
      }, 'supporter statistics reset');
      return { deletedSupporters };
    },
  );
};
