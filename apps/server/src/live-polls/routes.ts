import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  closeLivePollSchema, livePollParamsSchema, parseStartLivePoll, startLivePollSchema, workspaceParamsSchema,
  type ApiErrorResponse, type CloseLivePoll, type LivePollState, type StartLivePoll, type WorkspaceParams,
} from '@tiktok-helper/contracts';

import type { TikTokSessionManager } from '../tiktok/session-manager.js';

interface LivePollRoutesOptions {
  manager: Pick<TikTokSessionManager, 'startLivePoll' | 'closeLivePoll'>;
}

type PollParams = WorkspaceParams & { pollId: string };
const endpoint = '/api/workspaces/:workspaceId/live-polls';

function respondError(reply: FastifyReply, status: number, code: string, message: string, requestId: string): FastifyReply {
  return reply.code(status).send({ error: { code, message, requestId } } satisfies ApiErrorResponse);
}

async function validateStart(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const input = parseStartLivePoll(request.body);
  if (!input) {
    await respondError(reply, 400, 'VALIDATION_ERROR', 'Request validation failed', request.id);
    return;
  }
  request.body = input;
}

async function validateClose(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as Partial<CloseLivePoll> | null | undefined;
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1
    && Object.hasOwn(body, 'status') && body.status === 'closed') return;
  await respondError(reply, 400, 'VALIDATION_ERROR', 'Request validation failed', request.id);
}

export const livePollRoutes: FastifyPluginAsync<LivePollRoutesOptions> = async (app, { manager }) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store'); });
  app.addHook('preHandler', async (request, reply) => {
    if (request.authPrincipal) return;
    await respondError(reply, 401, 'UNAUTHENTICATED', 'Authentication required', request.id);
  });

  app.post<{ Params: WorkspaceParams; Body: StartLivePoll; Reply: LivePollState | ApiErrorResponse }>(endpoint,
    { schema: { params: workspaceParamsSchema, body: startLivePollSchema }, preValidation: validateStart },
    async (request, reply) => {
      const state = manager.startLivePoll(request.params.workspaceId, request.body);
      if (!state) return respondError(reply, 409, 'POLL_CONFLICT', 'Live poll state has changed', request.id);
      return reply.code(201).send(state);
    },
  );

  app.patch<{ Params: PollParams; Body: CloseLivePoll; Reply: LivePollState | ApiErrorResponse }>(`${endpoint}/:pollId`,
    { schema: { params: livePollParamsSchema, body: closeLivePollSchema }, preValidation: validateClose },
    async (request, reply) => {
      const { workspaceId, pollId } = request.params;
      const state = manager.closeLivePoll(workspaceId, pollId);
      if (!state) return respondError(reply, 409, 'POLL_CONFLICT', 'Live poll state has changed', request.id);
      return state;
    },
  );
};
