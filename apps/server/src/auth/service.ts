import { createHash, randomBytes } from 'node:crypto';
import type { AuthPrincipal } from '@tiktok-helper/contracts';
import type { AccessDenialReason, AuthAccessResponse } from '@tiktok-helper/contracts';
import type { PublicBasePath } from './configuration.js';
import type { AuthRepository } from './repository.js';
import { hashSessionToken, issueSessionToken } from './session-token.js';

const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface BridgeIdentity {
  subject: string;
  displayName: string | null;
  authenticatedAt: string;
  grant?: string;
}

export interface IdentityBridge {
  exchange(code: string, verifier: string): Promise<BridgeIdentity>;
  checkAccess?(subject: string): Promise<AuthAccessResponse>;
  checkSession?(grant: string, subject: string): Promise<boolean>;
}

export interface AuthConfiguration {
  basePath?: PublicBasePath;
  bridgeAuthorizeUrl: string;
  clientId: string;
  redirectUri: string;
  sessionCookieName?: string;
  sessionIdleMs?: number;
  sessionAbsoluteMs?: number;
  loginStateTtlMs?: number;
}

type PendingLogin = { verifier: string; expiresAt: number; browserNonceHash?: string };
type CabinetGrant = { grant: string; expiresAt: number; browserNonceHash: string };

export class CabinetSessionUnavailable extends Error {
  readonly statusCode = 503;
  constructor() { super('Cabinet session verification unavailable'); }
}

export class LoginAccessDenied extends Error {
  constructor(readonly reason: AccessDenialReason) { super('TikTokHelper access denied'); }
}

export class AuthService {
  readonly cookieName: string;
  readonly cookieMaxAgeSeconds: number;
  readonly basePath: PublicBasePath;
  readonly publicOrigin: string | undefined;
  readonly integrated: boolean;
  readonly loginCookieName: string;
  readonly loginCookieMaxAgeSeconds: number;
  readonly #pending = new Map<string, PendingLogin>();
  readonly #grants = new Map<string, CabinetGrant>();
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
    this.loginCookieName = '__Host-tiktok_helper_browser';
    this.basePath = config.basePath ?? '/';
    this.integrated = this.basePath !== '/';
    this.publicOrigin = this.integrated ? new URL(config.redirectUri).origin : undefined;
    if (this.integrated && (!bridge.checkSession || !bridge.checkAccess)) {
      throw new Error('Cabinet login requires session and access verification');
    }
    this.#idleMs = config.sessionIdleMs ?? 24 * 60 * 60 * 1000;
    this.#absoluteMs = config.sessionAbsoluteMs ?? 30 * 24 * 60 * 60 * 1000;
    this.cookieMaxAgeSeconds = Math.floor(this.#absoluteMs / 1000);
    this.#stateTtlMs = config.loginStateTtlMs ?? 5 * 60 * 1000;
    this.loginCookieMaxAgeSeconds = Math.ceil(this.#stateTtlMs / 1000);
  }

  beginLogin(browserNonce?: string): string {
    this.#prune(this.#pending);
    if (this.integrated && (!browserNonce || !SESSION_PATTERN.test(browserNonce))) throw new Error('invalid browser nonce');
    if (this.#pending.size >= 1_000) throw new Error('login state capacity reached');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    this.#pending.set(digest(state), {
      verifier, expiresAt: this.now() + this.#stateTtlMs,
      ...(browserNonce ? { browserNonceHash: digest(browserNonce) } : {}),
    });
    const url = new URL(this.config.bridgeAuthorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('code_challenge', digest(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
  }

  #consumePending(state: string, browserNonce: string | undefined): PendingLogin | undefined {
    const key = digest(state);
    const pending = this.#pending.get(key);
    if (!pending || pending.expiresAt <= this.now()) {
      this.#pending.delete(key);
      return;
    }
    if (this.integrated && (!browserNonce || digest(browserNonce) !== pending.browserNonceHash)) return;
    this.#pending.delete(key);
    return pending;
  }

  consumeDeniedLogin(state: string, browserNonce?: string): boolean {
    return Boolean(this.#consumePending(state, browserNonce));
  }

  async completeLogin(code: string, state: string, browserNonce?: string): Promise<{ token: string; principal: AuthPrincipal }> {
    const pending = this.#consumePending(state, browserNonce);
    if (!pending) throw new Error('invalid login state');
    const identity = await this.bridge.exchange(code, pending.verifier);
    const authenticatedAt = new Date(identity.authenticatedAt);
    if (!identity.subject.trim() || identity.subject.length > 128 ||
        (identity.displayName !== null && identity.displayName.length > 120) ||
        Number.isNaN(authenticatedAt.valueOf())) throw new Error('invalid bridge identity');
    if (this.integrated) {
      if (!identity.grant || !SESSION_PATTERN.test(identity.grant)) throw new Error('invalid cabinet grant');
      let access: AuthAccessResponse;
      try { access = await this.bridge.checkAccess!(identity.subject); }
      catch { throw new CabinetSessionUnavailable(); }
      if (!access.allowed) throw new LoginAccessDenied(access.reason);
      if (!await this.#checkCabinetGrant(identity.grant, identity.subject)) throw new Error('invalid cabinet session');
    }
    const user = await this.repository.upsertIdentity({
      provider: 'vline', subject: identity.subject, displayName: identity.displayName, authenticatedAt,
    });
    let workspaces = await this.repository.listWorkspaces(user.id);
    if (workspaces.length === 0) {
      await this.repository.createWorkspaceForUser(user.id, identity.displayName ?? 'Мой эфир');
      workspaces = await this.repository.listWorkspaces(user.id);
    }
    const issued = issueSessionToken();
    const now = new Date(this.now());
    const absoluteExpiresAt = now.valueOf() + this.#absoluteMs;
    if (this.integrated && identity.grant && pending.browserNonceHash) {
      this.#prune(this.#grants);
      if (this.#grants.size >= 10_000) throw new CabinetSessionUnavailable();
      this.#grants.set(issued.tokenHash, { grant: identity.grant, expiresAt: absoluteExpiresAt, browserNonceHash: pending.browserNonceHash });
    }
    try {
      await this.repository.issueSession({ userId: user.id, tokenHash: issued.tokenHash,
        idleExpiresAt: new Date(now.valueOf() + this.#idleMs), absoluteExpiresAt: new Date(absoluteExpiresAt) });
    } catch (error) {
      this.#grants.delete(issued.tokenHash);
      throw error;
    }
    return { token: issued.token, principal: { userId: user.id, displayName: user.displayName, isAdmin: user.globalRole === 'admin', workspaces } };
  }

  resolveCookie(cookieHeader: string | undefined) {
    return this.resolve(parseCookie(cookieHeader, this.cookieName), parseCookie(cookieHeader, this.loginCookieName));
  }

  private async resolve(token: string | undefined, browserNonce: string | undefined): Promise<{
    principal: AuthPrincipal; sessionId: string; identitySubject: string;
  } | null> {
    if (!token || !SESSION_PATTERN.test(token)) return null;
    const now = new Date(this.now());
    const tokenHash = hashSessionToken(token);
    const active = await this.repository.findActiveSession(tokenHash, now);
    if (!active) {
      this.#grants.delete(tokenHash);
      return null;
    }
    if (this.integrated) {
      const grant = this.#grants.get(tokenHash);
      if (!grant || !browserNonce || digest(browserNonce) !== grant.browserNonceHash) return null;
      if (!await this.#checkCabinetGrant(grant.grant, active.user.identitySubject)) {
        this.#grants.delete(tokenHash);
        return null;
      }
      // A parallel logout can remove the binding during the backchannel request.
      if (this.#grants.get(tokenHash) !== grant) return null;
    }
    const workspaces = await this.repository.listWorkspaces(active.user.id);
    const idleExpiresAt = new Date(Math.min(now.valueOf() + this.#idleMs, active.session.absoluteExpiresAt.valueOf()));
    await this.repository.touchSession(active.session.id, now, idleExpiresAt);
    return {
      sessionId: active.session.id,
      identitySubject: active.user.identitySubject,
      principal: { userId: active.user.id, displayName: active.user.displayName, isAdmin: active.user.globalRole === 'admin', workspaces },
    };
  }

  checkEntitlement(subject: string): Promise<AuthAccessResponse> {
    if (!this.bridge.checkAccess) throw new Error('access verification is not configured');
    return this.bridge.checkAccess(subject);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !SESSION_PATTERN.test(token)) return;
    const tokenHash = hashSessionToken(token);
    this.#grants.delete(tokenHash);
    const now = new Date(this.now());
    const active = await this.repository.findActiveSession(tokenHash, now);
    if (active) await this.repository.revokeSession(active.session.id, active.user.id, now);
  }

  async #checkCabinetGrant(grant: string, subject: string): Promise<boolean> {
    try { return await this.bridge.checkSession!(grant, subject); }
    catch { throw new CabinetSessionUnavailable(); }
  }

  #prune(records: Map<string, { expiresAt: number }>): void {
    const now = this.now();
    for (const [key, value] of records) if (value.expiresAt <= now) records.delete(key);
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  let value: string | undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    if (value !== undefined) return undefined;
    value = part.slice(separator + 1).trim();
  }
  return value;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number, path: PublicBasePath = '/'): string {
  return `${name}=${token}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(name: string, path: PublicBasePath = '/'): string {
  return sessionCookie(name, '', 0, path);
}
