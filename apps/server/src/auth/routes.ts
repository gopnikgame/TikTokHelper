import type { FastifyPluginAsync } from 'fastify';
import {
  apiErrorSchema, authCallbackQuerySchema, authLoginResponseSchema, authSessionSchema,
  type ApiErrorResponse, type AuthCallbackQuery, type AuthLoginResponse, type AuthSessionResponse,
} from '@tiktok-helper/contracts';
import { clearSessionCookie, parseCookie, sessionCookie, type AuthService } from './service.js';

export const authRoutes: FastifyPluginAsync<{ service: AuthService }> = async (app, { service }) => {
  app.get<{ Reply: AuthLoginResponse }>('/api/auth/login', {
    schema: { response: { 200: authLoginResponseSchema } },
  }, async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { authorizationUrl: service.beginLogin() };
  });

  app.get<{ Querystring: AuthCallbackQuery }>('/auth/callback', {
    schema: { querystring: authCallbackQuerySchema },
  }, async (request, reply) => {
    try {
      const result = await service.completeLogin(request.query.code, request.query.state);
      reply.header('set-cookie', sessionCookie(service.cookieName, result.token, service.cookieMaxAgeSeconds));
      return reply.redirect('/');
    } catch {
      return reply.code(400).send({ error: {
        code: 'AUTH_CALLBACK_FAILED', message: 'Authentication response is invalid or expired', requestId: request.id,
      } });
    }
  });

  app.get<{ Reply: AuthSessionResponse | ApiErrorResponse }>('/api/auth/session', {
    schema: { response: { 200: authSessionSchema, 401: apiErrorSchema } },
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const active = await service.resolve(parseCookie(request.headers.cookie, service.cookieName));
    if (!active) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } });
    return { authenticated: true, user: active.principal };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await service.logout(parseCookie(request.headers.cookie, service.cookieName));
    reply.header('set-cookie', clearSessionCookie(service.cookieName));
    return reply.code(204).send();
  });
};
