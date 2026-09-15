import { createHash, randomBytes } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;

export interface IssuedSessionToken {
  token: string;
  tokenHash: string;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueSessionToken(): IssuedSessionToken {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}
