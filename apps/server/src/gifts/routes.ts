import type { FastifyPluginAsync } from 'fastify';
import { observedGiftsSchema, workspaceParamsSchema, type WorkspaceParams } from '@tiktok-helper/contracts';
import type { GiftCatalogRepository } from './repository.js';

export interface GiftRoutesOptions { repository: GiftCatalogRepository }
export const giftRoutes: FastifyPluginAsync<GiftRoutesOptions> = async (app, options) => {
  app.get<{ Params: WorkspaceParams }>('/api/workspaces/:workspaceId/gifts', {
    schema: { params: workspaceParamsSchema, response: { 200: observedGiftsSchema } },
  }, async (request) => options.repository.list(request.params.workspaceId));
};
