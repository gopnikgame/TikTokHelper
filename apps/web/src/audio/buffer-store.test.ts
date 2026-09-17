import { describe, expect, it } from 'vitest';
import { AudioBufferStore } from './buffer-store.js';

const buffer = (length: number) => ({ length, numberOfChannels: 1 }) as AudioBuffer;

describe('AudioBufferStore', () => {
  it('evicts the least recently used decoded buffer within its byte budget', () => {
    const store = new AudioBufferStore(16);
    store.set('first', buffer(2));
    store.set('second', buffer(2));
    expect(store.get('first')).toBeDefined();
    store.set('third', buffer(2));
    expect(store.get('second')).toBeUndefined();
    expect(store.get('first')).toBeDefined();
    expect(store.get('third')).toBeDefined();
  });

  it('drops decoded entries that are no longer referenced', () => {
    const store = new AudioBufferStore();
    store.set('kept', buffer(2)); store.set('removed', buffer(2));
    store.retain(new Set(['kept']));
    expect(store.size).toBe(1);
    expect(store.get('removed')).toBeUndefined();
  });
});
