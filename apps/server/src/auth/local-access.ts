import type { IncomingHttpHeaders } from 'node:http';
import type { AuthPrincipal } from '@tiktok-helper/contracts';
import { parseCookie, type AuthService } from './service.js';

export const LOCAL_ACCESS_HEADER = 'x-tiktok-local-access';
export const LOCAL_ACCESS_USER_ID = '00000000-0000-4000-8000-000000000001';

export function isTrustedLocalAccess(headers: IncomingHttpHeaders): boolean {
  return headers[LOCAL_ACCESS_HEADER] === '1';
}

export function localPrincipal(workspaceId: string): AuthPrincipal {
  return {
    userId: LOCAL_ACCESS_USER_ID,
    displayName: 'Локальный доступ',
    isAdmin: false,
    workspaces: [{ id: workspaceId, displayName: 'Основной эфир' }],
  };
}

export async function resolveAccessPrincipal(
  headers: IncomingHttpHeaders,
  authService: AuthService,
  localWorkspaceId?: string,
): Promise<{ mode: 'local' | 'vline'; principal: AuthPrincipal } | null> {
  const active = await authService.resolve(parseCookie(headers.cookie, authService.cookieName));
  if (active) return { mode: 'vline', principal: active.principal };
  if (localWorkspaceId && isTrustedLocalAccess(headers)) {
    return { mode: 'local', principal: localPrincipal(localWorkspaceId) };
  }
  return null;
}
