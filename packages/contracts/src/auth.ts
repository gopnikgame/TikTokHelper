export interface AuthPrincipal {
  userId: string;
  displayName: string | null;
  isAdmin: boolean;
  workspaces: Array<{ id: string; displayName: string }>;
}

export const authSessionSchema = {
  $id: 'AuthSession', type: 'object', additionalProperties: false,
  required: ['authenticated', 'mode', 'user'],
  properties: {
    authenticated: { const: true },
    mode: { type: 'string', enum: ['local', 'vline'] },
    user: {
      type: 'object', additionalProperties: false,
      required: ['userId', 'displayName', 'isAdmin', 'workspaces'],
      properties: {
        userId: { type: 'string', format: 'uuid' },
        displayName: { type: ['string', 'null'], maxLength: 120 },
        isAdmin: { type: 'boolean' },
        workspaces: {
          type: 'array', maxItems: 100,
          items: { type: 'object', additionalProperties: false, required: ['id', 'displayName'], properties: {
            id: { type: 'string', minLength: 1, maxLength: 64 },
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
          } },
        },
      },
    },
  },
} as const;

export interface AuthSessionResponse { authenticated: true; mode: 'local' | 'vline'; user: AuthPrincipal }

export type AccessDenialReason = 'subscription_required' | 'subscription_expired' | 'subscription_frozen' | 'account_disabled';
export const authAccessSchema = {
  $id: 'AuthAccess', type: 'object', additionalProperties: false,
  required: ['allowed', 'reason', 'validUntil'],
  properties: {
    allowed: { type: 'boolean' },
    reason: { type: 'string', enum: ['local', 'admin', 'active_subscription', 'subscription_required', 'subscription_expired', 'subscription_frozen', 'account_disabled'] },
    validUntil: { type: ['integer', 'null'], minimum: 1 },
  },
} as const;
export type AuthAccessResponse =
  | { allowed: true; reason: 'local' | 'admin' | 'active_subscription'; validUntil: number | null }
  | { allowed: false; reason: AccessDenialReason; validUntil: null };

export const authLoginResponseSchema = {
  $id: 'AuthLoginResponse', type: 'object', additionalProperties: false,
  required: ['authorizationUrl'],
  properties: { authorizationUrl: { type: 'string', format: 'uri', maxLength: 2048 } },
} as const;

export interface AuthLoginResponse { authorizationUrl: string }

export const authCallbackQuerySchema = {
  $id: 'AuthCallbackQuery', type: 'object', additionalProperties: false,
  required: ['state'],
  properties: {
    code: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
    state: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
    error: { type: 'string', enum: ['access_denied'] },
    error_code: { type: 'string', enum: ['subscription_required', 'subscription_expired', 'subscription_frozen', 'account_disabled'] },
  },
  oneOf: [
    { required: ['code'], not: { anyOf: [{ required: ['error'] }, { required: ['error_code'] }] } },
    { required: ['error', 'error_code'], not: { required: ['code'] } },
  ],
} as const;

export interface AuthCallbackQuery {
  state: string;
  code?: string;
  error?: 'access_denied';
  error_code?: 'subscription_required' | 'subscription_expired' | 'subscription_frozen' | 'account_disabled';
}
