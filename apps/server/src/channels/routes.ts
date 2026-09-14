import type { FastifyPluginAsync } from 'fastify';
import { recentChannelsSchema, workspaceParamsSchema, type WorkspaceParams } from '@tiktok-helper/contracts';
import type { RecentChannelRepository } from './repository.js';

export interface RecentChannelRoutesOptions { repository: RecentChannelRepository }
export const recentChannelRoutes: FastifyPluginAsync<RecentChannelRoutesOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/recent-channels', {
    schema: { params: workspaceParamsSchema, response: { 200: recentChannelsSchema } },
  }, async (request) => options.repository.list(request.params.workspaceId));
};
