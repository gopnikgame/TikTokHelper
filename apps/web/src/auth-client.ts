import type { AuthLoginResponse, AuthSessionResponse } from '@tiktok-helper/contracts';

export async function loadSession(signal?: AbortSignal): Promise<AuthSessionResponse | null> {
  const response = await fetch('/api/auth/session', { signal, headers: { accept: 'application/json' } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('session unavailable');
  return response.json() as Promise<AuthSessionResponse>;
}

export async function beginLogin(): Promise<void> {
  const response = await fetch('/api/auth/login', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('login unavailable');
  const { authorizationUrl } = await response.json() as AuthLoginResponse;
  window.location.assign(authorizationUrl);
}

export async function endSession(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('logout failed');
}
