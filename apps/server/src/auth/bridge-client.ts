import type { AuthAccessResponse } from '@tiktok-helper/contracts';
import type { BridgeIdentity, IdentityBridge } from './service.js';

export class HttpIdentityBridge implements IdentityBridge {
  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly entitlement?: { url: string; credentials: { clientId: string; clientSecret: string } },
  ) {}

  private post(url: string | URL, body: object, clientId = this.clientId, clientSecret = this.clientSecret): Promise<Response> {
    return fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/json', accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async exchange(code: string, verifier: string): Promise<BridgeIdentity> {
    const response = await this.post(this.tokenUrl, {
      grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: verifier,
    });
    if (!response.ok) throw new Error('identity exchange failed');
    const body = await response.json() as Partial<BridgeIdentity>;
    if (!body || typeof body.subject !== 'string' ||
        (body.displayName !== null && typeof body.displayName !== 'string') || typeof body.authenticatedAt !== 'string') {
      throw new Error('invalid identity exchange response');
    }
    return { subject: body.subject, displayName: body.displayName, authenticatedAt: body.authenticatedAt,
      ...(typeof body.grant === 'string' ? { grant: body.grant } : {}) };
  }

  private endpoint(suffix: 'session' | 'entitlement'): URL {
    const url = new URL(this.tokenUrl);
    if (!url.pathname.endsWith('/token')) throw new Error('invalid identity token URL');
    url.pathname = `${url.pathname.slice(0, -'token'.length)}${suffix}`;
    url.search = '';
    url.hash = '';
    return url;
  }

  async checkSession(grant: string, subject: string): Promise<boolean> {
    const response = await this.post(this.endpoint('session'), { grant, subject });
    if (!response.ok) throw new Error('cabinet session verification failed');
    const body = await response.json() as { active?: unknown } | null;
    if (typeof body?.active !== 'boolean') throw new Error('invalid cabinet session verification response');
    return body.active;
  }

  async checkAccess(subject: string): Promise<AuthAccessResponse> {
    const response = this.entitlement
      ? await this.post(this.entitlement.url, { subject }, this.entitlement.credentials.clientId, this.entitlement.credentials.clientSecret)
      : await this.post(this.endpoint('entitlement'), { subject });
    if (!response.ok) throw new Error('access verification failed');
    const body = await response.json() as Partial<AuthAccessResponse>;
    const allowedReasons = new Set(['admin', 'active_subscription']);
    const deniedReasons = new Set(['subscription_required', 'subscription_expired', 'subscription_frozen', 'account_disabled']);
    if (body?.allowed === true && typeof body.reason === 'string' && allowedReasons.has(body.reason) &&
        (body.validUntil === null || (typeof body.validUntil === 'number' && Number.isSafeInteger(body.validUntil) && body.validUntil > 0))) {
      return body as AuthAccessResponse;
    }
    if (body?.allowed === false && typeof body.reason === 'string' && deniedReasons.has(body.reason) && body.validUntil === null) {
      return body as AuthAccessResponse;
    }
    throw new Error('invalid access verification response');
  }
}
