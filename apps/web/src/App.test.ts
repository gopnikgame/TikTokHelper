import { describe, expect, it } from 'vitest';

import { getHealthLabel } from './health-label.js';

describe('health label', () => {
  it('describes the ready scaffold', () => {
    expect(getHealthLabel({ status: 'ok' })).toBe('Каркас приложения готов');
  });
});
