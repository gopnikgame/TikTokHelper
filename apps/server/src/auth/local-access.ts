import type { IncomingHttpHeaders } from 'node:http';
import type { AuthPrincipal } from '@tiktok-helper/contracts';

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
