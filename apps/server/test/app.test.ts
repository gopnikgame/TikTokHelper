import type { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema, connectLiveCommandSchema,
  type ApiErrorResponse, type ConnectLiveCommand,
} from '@tiktok-helper/contracts';
import { buildApp } from '../src/app.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => {
  await Promise.all([...apps].map(async (app) => app.close()));
  apps.clear();
});

describe('service probes', () => {
  it('returns liveness and correlation without opening a port', async () => {
    const app = buildApp({ logger: false });
    apps.add(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports a failed dependency as not ready', async () => {
    const app = buildApp({ logger: false, readinessCheck: () => false });
    apps.add(app);
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });
});

describe('local access mode', () => {
  it('bootstraps the configured workspace without exposing login or logout', async () => {
    const app = buildApp({ logger: false, localWorkspaceId: 'primary' });
    apps.add(app);

    const session = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(session.statusCode).toBe(200);
    expect(session.headers['cache-control']).toBe('no-store');
    expect(session.json()).toMatchObject({
      authenticated: true,
      mode: 'local',
      user: { displayName: 'Локальный доступ', workspaces: [{ id: 'primary' }] },
    });
    expect((await app.inject({ method: 'GET', url: '/api/auth/login' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(404);
  });
});

describe('HTTP boundary and errors', () => {
  it('validates a shared schema and returns the common error shape', async () => {
    const app = buildApp({ logger: false });
    apps.add(app);
    app.post<{ Body: ConnectLiveCommand }>('/test/connect', {
      schema: { body: connectLiveCommandSchema, response: { 400: apiErrorSchema } },
    }, async () => ({ accepted: true }));
    const response = await app.inject({
      method: 'POST', url: '/test/connect',
      payload: { workspaceId: '../other', tiktokUsername: 'x', room: 'admin' },
    });
    const body = response.json<ApiErrorResponse>();
    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('does not expose internal error details', async () => {
    const app = buildApp({ logger: false });
    apps.add(app);
    app.get('/test/failure', async () => { throw new Error('database password was hunter2'); });
    const response = await app.inject({ method: 'GET', url: '/test/failure' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    expect(response.json<ApiErrorResponse>().error.code).toBe('INTERNAL_ERROR');
  });

  it('uses the common error shape for unknown routes', async () => {
    const app = buildApp({ logger: false });
    apps.add(app);
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorResponse>().error.code).toBe('NOT_FOUND');
  });
});

describe('structured log safety', () => {
  it('redacts secrets and chat text from captured logs', async () => {
    const logLines: string[] = [];
    const stream = { write(chunk: string) { logLines.push(chunk); return true; } } as Writable;
    const app = buildApp({ logger: { level: 'info', stream } });
    apps.add(app);
    app.log.info({
      chatText: 'private chat phrase', password: 'password-value', token: 'token-value',
      nested: { chatText: 'nested chat phrase', secret: 'secret-value' },
    }, 'redaction check');
    app.get('/test/log-failure', async () => { throw new Error('private thrown detail'); });
    await app.inject({
      method: 'GET', url: '/test/log-failure',
      headers: { authorization: 'Bearer private-token', cookie: 'session=private-cookie' },
    });
    const captured = logLines.join('');
    expect(captured).toContain('http_request_failed');
    expect(captured).toContain('[REDACTED]');
    for (const sensitive of [
      'private chat phrase', 'nested chat phrase', 'password-value', 'token-value',
      'secret-value', 'private thrown detail', 'private-token', 'private-cookie',
    ]) expect(captured).not.toContain(sensitive);
  });
});
