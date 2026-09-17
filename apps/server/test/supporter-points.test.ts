import { describe, expect, it } from 'vitest';
import { giftPoints } from '../src/supporters/repository.js';

describe('support point calculation', () => {
  it('uses diamond value multiplied by the normalized incremental count', () => {
    expect(giftPoints({ diamondCount: 5, repeatCount: 1 })).toBe(5);
    expect(giftPoints({ diamondCount: 5, repeatCount: 2 })).toBe(10);
  });

  it('does not invent points for unknown, free, negative, or unsafe values', () => {
    expect(giftPoints({ repeatCount: 1 })).toBe(0);
    expect(giftPoints({ diamondCount: 0, repeatCount: 100 })).toBe(0);
    expect(giftPoints({ diamondCount: -1, repeatCount: 1 })).toBe(0);
    expect(giftPoints({ diamondCount: Number.MAX_SAFE_INTEGER, repeatCount: 2 })).toBe(0);
  });
});
