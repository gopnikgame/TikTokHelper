import type { AuthAccessResponse } from '@tiktok-helper/contracts';
import type { BridgeIdentity, IdentityBridge } from './service.js';

export class HttpIdentityBridge implements IdentityBridge {
  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  async exchange(code: string, verifier: string): Promise<BridgeIdentity> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'content-type': 'application/json', accept: 'application/json',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: verifier }),
    });
    if (!response.ok) throw new Error('identity exchange failed');
    const body = await response.json() as Partial<BridgeIdentity>;
    if (typeof body.subject !== 'string' || (body.displayName !== null && typeof body.displayName !== 'string') || typeof body.authenticatedAt !== 'string') {
      throw new Error('invalid identity exchange response');
    }
    return body as BridgeIdentity;
  }

  async checkAccess(subject: string): Promise<AuthAccessResponse> {
    const entitlementUrl = new URL(this.tokenUrl);
    if (!entitlementUrl.pathname.endsWith('/token')) throw new Error('invalid identity token URL');
    entitlementUrl.pathname = `${entitlementUrl.pathname.slice(0, -'/token'.length)}/entitlement`;
    entitlementUrl.search = '';
    entitlementUrl.hash = '';
    const response = await fetch(entitlementUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'content-type': 'application/json', accept: 'application/json',
      },
      body: JSON.stringify({ subject }),
    });
    if (!response.ok) throw new Error('access verification failed');
    const body = await response.json() as Partial<AuthAccessResponse>;
    const allowedReasons = new Set(['admin', 'active_subscription']);
    const deniedReasons = new Set(['subscription_required', 'subscription_expired', 'subscription_frozen', 'account_disabled']);
    if (body.allowed === true && typeof body.reason === 'string' && allowedReasons.has(body.reason) &&
        (body.validUntil === null || (typeof body.validUntil === 'number' && Number.isSafeInteger(body.validUntil) && body.validUntil > 0))) {
      return body as AuthAccessResponse;
    }
    if (body.allowed === false && typeof body.reason === 'string' && deniedReasons.has(body.reason) && body.validUntil === null) {
      return body as AuthAccessResponse;
    }
    throw new Error('invalid access verification response');
  }
}
