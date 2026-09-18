import { createHash, randomBytes } from 'node:crypto';
import type { AuthPrincipal } from '@tiktok-helper/contracts';
import type { AuthRepository } from './repository.js';
import { hashSessionToken, issueSessionToken } from './session-token.js';

const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface BridgeIdentity {
  subject: string;
  displayName: string | null;
  authenticatedAt: string;
}

export interface IdentityBridge {
  exchange(code: string, verifier: string): Promise<BridgeIdentity>;
}

export interface AuthConfiguration {
  bridgeAuthorizeUrl: string;
  clientId: string;
  redirectUri: string;
  sessionCookieName?: string;
  sessionIdleMs?: number;
  sessionAbsoluteMs?: number;
  loginStateTtlMs?: number;
}

type PendingLogin = { verifier: string; expiresAt: number };

export class AuthService {
  readonly cookieName: string;
  readonly cookieMaxAgeSeconds: number;
  readonly #pending = new Map<string, PendingLogin>();
  readonly #idleMs: number;
  readonly #absoluteMs: number;
  readonly #stateTtlMs: number;

  constructor(
    private readonly repository: AuthRepository,
    private readonly bridge: IdentityBridge,
    private readonly config: AuthConfiguration,
    private readonly now: () => number = Date.now,
  ) {
    this.cookieName = config.sessionCookieName ?? 'tiktok_helper_session';
    this.#idleMs = config.sessionIdleMs ?? 24 * 60 * 60 * 1000;
    this.#absoluteMs = config.sessionAbsoluteMs ?? 30 * 24 * 60 * 60 * 1000;
    this.cookieMaxAgeSeconds = Math.floor(this.#absoluteMs / 1000);
    this.#stateTtlMs = config.loginStateTtlMs ?? 5 * 60 * 1000;
  }

  beginLogin(): string {
    this.#prune();
    if (this.#pending.size >= 1_000) throw new Error('login state capacity reached');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    this.#pending.set(digest(state), { verifier, expiresAt: this.now() + this.#stateTtlMs });
    const url = new URL(this.config.bridgeAuthorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('code_challenge', digest(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
  }

  consumeDeniedLogin(state: string): boolean {
    const key = digest(state);
    const pending = this.#pending.get(key);
    this.#pending.delete(key);
    return Boolean(pending && pending.expiresAt > this.now());
  }

  async completeLogin(code: string, state: string): Promise<{ token: string; principal: AuthPrincipal }> {
    const pending = this.#pending.get(digest(state));
    this.#pending.delete(digest(state));
    if (!pending || pending.expiresAt <= this.now()) throw new Error('invalid login state');
    const identity = await this.bridge.exchange(code, pending.verifier);
    const authenticatedAt = new Date(identity.authenticatedAt);
    if (!identity.subject.trim() || identity.subject.length > 128 ||
        (identity.displayName !== null && identity.displayName.length > 120) ||
        Number.isNaN(authenticatedAt.valueOf())) throw new Error('invalid bridge identity');
    const user = await this.repository.upsertIdentity({
      provider: 'vline', subject: identity.subject, displayName: identity.displayName, authenticatedAt,
    });
    let workspaces = await this.repository.listWorkspaces(user.id);
    if (workspaces.length === 0) {
      const membership = await this.repository.createWorkspaceForUser(user.id, identity.displayName ?? 'Мой эфир');
      workspaces = [{ id: membership.workspaceId, displayName: identity.displayName ?? 'Мой эфир' }];
    }
    const issued = issueSessionToken();
    const now = new Date(this.now());
    await this.repository.issueSession({
      userId: user.id, tokenHash: issued.tokenHash,
      idleExpiresAt: new Date(now.valueOf() + this.#idleMs),
      absoluteExpiresAt: new Date(now.valueOf() + this.#absoluteMs),
    });
    return { token: issued.token, principal: { userId: user.id, displayName: user.displayName, isAdmin: user.globalRole === 'admin', workspaces } };
  }

  async resolve(token: string | undefined): Promise<{ principal: AuthPrincipal; sessionId: string } | null> {
    if (!token || !SESSION_PATTERN.test(token)) return null;
    const now = new Date(this.now());
    const active = await this.repository.findActiveSession(hashSessionToken(token), now);
    if (!active) return null;
    const workspaces = await this.repository.listWorkspaces(active.user.id);
    const idleExpiresAt = new Date(Math.min(now.valueOf() + this.#idleMs, active.session.absoluteExpiresAt.valueOf()));
    await this.repository.touchSession(active.session.id, now, idleExpiresAt);
    return {
      sessionId: active.session.id,
      principal: { userId: active.user.id, displayName: active.user.displayName, isAdmin: active.user.globalRole === 'admin', workspaces },
    };
  }

  async logout(token: string | undefined): Promise<void> {
    const active = await this.resolve(token);
    if (active) await this.repository.revokeSession(active.sessionId, active.principal.userId, new Date(this.now()));
  }

  #prune(): void {
    const now = this.now();
    for (const [key, value] of this.#pending) if (value.expiresAt <= now) this.#pending.delete(key);
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number): string {
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
