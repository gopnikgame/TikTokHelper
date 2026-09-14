import { describe, expect, it } from 'vitest';

import { healthResponseSchema, validateClientEvent } from './index.js';

describe('health response contract', () => {
  it('requires the ok status', () => {
    expect(healthResponseSchema.required).toEqual(['status']);
    expect(healthResponseSchema.properties.status.const).toBe('ok');
  });
});

describe('Socket.IO command contracts', () => {
  it('accepts a valid connect command', () => {
    expect(validateClientEvent('live:connect', {
      commandId: '123e4567-e89b-42d3-a456-426614174000',
      workspaceId: 'primary',
      tiktokUsername: '@operator.name',
    }).ok).toBe(true);
  });

  it('rejects malformed and additional fields', () => {
    expect(validateClientEvent('live:connect', {
      commandId: 'not-a-uuid', workspaceId: '../other', tiktokUsername: 'x', room: 'admin',
    }).ok).toBe(false);
  });
});
