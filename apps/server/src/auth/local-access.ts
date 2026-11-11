import type { IncomingHttpHeaders } from 'node:http';
import type { AuthPrincipal } from '@tiktok-helper/contracts';
import type { CommandAcknowledgement } from '@tiktok-helper/contracts';
import type { AuthService } from './service.js';

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

type AccessPrincipal =
  | { mode: 'local'; principal: AuthPrincipal }
  | { mode: 'vline'; principal: AuthPrincipal; identitySubject: string };

export async function resolveAccessPrincipal(
  headers: IncomingHttpHeaders,
  authService: AuthService,
  localWorkspaceId?: string,
): Promise<AccessPrincipal | null> {
  const active = await authService.resolveCookie(headers.cookie);
  if (active) return { mode: 'vline', principal: active.principal, identitySubject: active.identitySubject };
  if (!authService.integrated && localWorkspaceId && isTrustedLocalAccess(headers)) {
    return { mode: 'local', principal: localPrincipal(localWorkspaceId) };
  }
  return null;
}

export async function authorizeLiveConnect(service: AuthService, principal: AccessPrincipal | null): Promise<CommandAcknowledgement> {
  if (principal?.mode === 'local') return { ok: true };
  try {
    const access = principal?.mode === 'vline' ? await service.checkEntitlement(principal.identitySubject) : null;
    if (access?.allowed) return { ok: true };
    return { ok: false, error: { code: 'ACCESS_DENIED', message: access?.reason ?? 'subscription_required' } };
  } catch {
    return { ok: false, error: { code: 'ACCESS_UNAVAILABLE', message: 'access_verification_unavailable' } };
  }
}
