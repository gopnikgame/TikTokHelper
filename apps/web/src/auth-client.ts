import type { AuthAccessResponse, AuthLoginResponse, AuthSessionResponse } from '@tiktok-helper/contracts';
import { appPath, USES_CABINET } from './app-path.js';

export async function loadSession(signal?: AbortSignal): Promise<AuthSessionResponse | null> {
  const response = await fetch(appPath('api/auth/session'), { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('session unavailable');
  return response.json() as Promise<AuthSessionResponse>;
}

export async function beginLogin(): Promise<void> {
  const response = await fetch(appPath('api/auth/login'), { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('login unavailable');
  const { authorizationUrl } = await response.json() as AuthLoginResponse;
  if (!USES_CABINET) {
    window.location.assign(authorizationUrl);
    return;
  }
  const target = new URL(authorizationUrl);
  if (target.origin !== window.location.origin || target.pathname !== '/api/integrations/tiktokhelper/authorize' || target.username || target.password) {
    throw new Error('invalid cabinet login URL');
  }
  window.location.replace(target.href);
}

export async function endSession(): Promise<void> {
  const response = await fetch(appPath('api/auth/logout'), { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error('logout failed');
}

export async function loadAccess(signal?: AbortSignal): Promise<AuthAccessResponse> {
  const response = await fetch(appPath('api/auth/access'), { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 401 ? 'unauthenticated' : 'access unavailable');
  return response.json() as Promise<AuthAccessResponse>;
}
