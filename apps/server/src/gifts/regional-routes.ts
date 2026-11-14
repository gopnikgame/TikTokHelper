import type { FastifyPluginAsync } from 'fastify';
import {
  apiErrorSchema, regionalGiftPageSchema, regionalGiftParamsSchema, regionalGiftQuerySchema, regionalGiftRefreshSchema,
  type RegionalGiftRegion, type WorkspaceParams,
} from '@tiktok-helper/contracts';
import type { RegionalGiftCatalogReader } from './regional-catalog.js';

interface RegionParams extends WorkspaceParams { region: RegionalGiftRegion }
interface RegionQuery { q?: string; page?: number }
interface RegionRefresh { force: boolean }
const endpoint = '/api/workspaces/:workspaceId/regional-gifts/:region';

export const regionalGiftRoutes: FastifyPluginAsync<{ catalog: RegionalGiftCatalogReader }> = async (app, { catalog }) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store'); });
  app.addHook('preHandler', async (request, reply) => {
    if (request.authPrincipal?.isAdmin) return;
    return reply.code(403).send({
      error: { code: 'FORBIDDEN', message: 'Administrator permission required', requestId: request.id },
    });
  });
  app.get<{ Params: RegionParams; Querystring: RegionQuery }>(endpoint, {
    schema: {
      params: regionalGiftParamsSchema, querystring: regionalGiftQuerySchema,
      response: { 200: regionalGiftPageSchema, 403: apiErrorSchema },
    },
  }, async (request) => catalog.search(request.params.region, request.query.q ?? '', request.query.page ?? 1));
  app.post<{ Params: RegionParams; Body: RegionRefresh }>(`${endpoint}/refresh`, {
    bodyLimit: 256,
    schema: {
      params: regionalGiftParamsSchema, body: regionalGiftRefreshSchema,
      response: { 204: { type: 'null' }, 403: apiErrorSchema },
    },
  }, async (request, reply) => {
    await catalog.refresh(request.params.region, request.body.force);
    return reply.code(204).send();
  });
};
