import { describe, expect, it } from 'vitest';

import { hashSessionToken, issueSessionToken } from '../src/auth/session-token.js';

describe('session token handling', () => {
  it('issues a high-entropy opaque token and stores only a stable SHA-256 hash', () => {
    const issued = issueSessionToken();
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.tokenHash).toBe(hashSessionToken(issued.token));
    expect(issued.tokenHash).not.toContain(issued.token);
  });

  it('does not reuse tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => issueSessionToken().token));
    expect(tokens.size).toBe(100);
  });

  it('changes the hash when the token changes', () => {
    expect(hashSessionToken('token-a')).not.toBe(hashSessionToken('token-b'));
  });
});
