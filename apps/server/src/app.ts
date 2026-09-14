import Fastify, { type FastifyInstance } from 'fastify';

import { healthResponseSchema, type HealthResponse } from '@tiktok-helper/contracts';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({ status: 'ok' }),
  );

  return app;
}
