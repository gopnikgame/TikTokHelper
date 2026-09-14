export const healthResponseSchema = {
  $id: 'HealthResponse', type: 'object', additionalProperties: false, required: ['status'],
  properties: { status: { const: 'ok', type: 'string' } },
} as const;

export interface HealthResponse { status: 'ok'; }

export const readinessResponseSchema = {
  $id: 'ReadinessResponse', type: 'object', additionalProperties: false, required: ['status'],
  properties: { status: { enum: ['ready', 'not_ready'], type: 'string' } },
} as const;

export interface ReadinessResponse { status: 'ready' | 'not_ready'; }

export const apiErrorSchema = {
  $id: 'ApiError', type: 'object', additionalProperties: false, required: ['error'],
  properties: {
    error: {
      type: 'object', additionalProperties: false,
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 64 },
        message: { type: 'string', minLength: 1, maxLength: 256 },
        requestId: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  },
} as const;

export interface ApiErrorResponse {
  error: { code: string; message: string; requestId: string };
}
