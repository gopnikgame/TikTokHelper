import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  apiErrorSchema, authAccessSchema, authCallbackQuerySchema, authLoginResponseSchema, authSessionSchema,
  type ApiErrorResponse, type AuthAccessResponse, type AuthCallbackQuery, type AuthLoginResponse, type AuthSessionResponse,
} from '@tiktok-helper/contracts';
import { CabinetSessionUnavailable, clearSessionCookie, LoginAccessDenied, parseCookie, sessionCookie, type AuthService } from './service.js';
import { resolveAccessPrincipal } from './local-access.js';

export const authRoutes: FastifyPluginAsync<{ service: AuthService; localWorkspaceId?: string }> = async (app, { service, localWorkspaceId }) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
  });

  app.get<{ Reply: AuthLoginResponse }>('/api/auth/login', {
    schema: { response: { 200: authLoginResponseSchema } },
  }, async (request, reply) => {
    if (!service.integrated) return { authorizationUrl: service.beginLogin() };
    const current = parseCookie(request.headers.cookie, service.loginCookieName);
    const browserBound = current && /^[A-Za-z0-9_-]{43}$/.test(current);
    const nonce = browserBound ? current : randomBytes(32).toString('base64url');
    const authorizationUrl = service.beginLogin(nonce);
    if (!browserBound) reply.header('set-cookie', sessionCookie(service.loginCookieName, nonce, service.loginCookieMaxAgeSeconds));
    return { authorizationUrl };
  });

  app.get<{ Querystring: AuthCallbackQuery }>('/auth/callback', {
    schema: { querystring: authCallbackQuerySchema },
  }, async (request, reply) => {
    const nonce = parseCookie(request.headers.cookie, service.loginCookieName);
    if (request.query.error === 'access_denied' && request.query.error_code) {
      if (!service.consumeDeniedLogin(request.query.state, nonce)) {
        return reply.code(400).send({ error: {
          code: 'AUTH_CALLBACK_FAILED', message: 'Authentication response is invalid or expired', requestId: request.id,
        } });
      }
      return reply.redirect(`${service.basePath}?auth_error=${encodeURIComponent(request.query.error_code)}`);
    }
    try {
      const result = await service.completeLogin(request.query.code!, request.query.state, nonce);
      const cookies = [sessionCookie(service.cookieName, result.token, service.cookieMaxAgeSeconds, service.basePath)];
      if (service.integrated && nonce) cookies.push(sessionCookie(service.loginCookieName, nonce, service.cookieMaxAgeSeconds));
      reply.header('set-cookie', cookies);
      return reply.redirect(service.basePath);
    } catch (error) {
      if (service.integrated) {
        const reason = error instanceof LoginAccessDenied ? error.reason
          : error instanceof CabinetSessionUnavailable ? 'access_verification_unavailable' : 'authentication_failed';
        return reply.redirect(`${service.basePath}?auth_error=${reason}`);
      }
      return reply.code(400).send({ error: {
        code: 'AUTH_CALLBACK_FAILED', message: 'Authentication response is invalid or expired', requestId: request.id,
      } });
    }
  });

  app.get<{ Reply: AuthSessionResponse | ApiErrorResponse }>('/api/auth/session', {
    schema: { response: { 200: authSessionSchema, 401: apiErrorSchema } },
  }, async (request, reply) => {
    const access = await resolveAccessPrincipal(request.headers, service, localWorkspaceId);
    if (!access) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } });
    return { authenticated: true, mode: access.mode, user: access.principal };
  });

  app.get<{ Reply: AuthAccessResponse | ApiErrorResponse }>('/api/auth/access', {
    schema: { response: { 200: authAccessSchema, 401: apiErrorSchema, 503: apiErrorSchema } },
  }, async (request, reply) => {
    try {
      const active = await resolveAccessPrincipal(request.headers, service, localWorkspaceId);
      if (active?.mode === 'vline') return await service.checkEntitlement(active.identitySubject);
      if (active?.mode === 'local') return { allowed: true, reason: 'local', validUntil: null };
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } });
    } catch {
      return reply.code(503).send({ error: { code: 'ACCESS_UNAVAILABLE', message: 'Access verification unavailable', requestId: request.id } });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await service.logout(parseCookie(request.headers.cookie, service.cookieName));
    reply.header('set-cookie', clearSessionCookie(service.cookieName, service.basePath));
    return reply.code(204).send();
  });
};
