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
}
