import { describe, expect, it } from 'vitest';
import { measurePcm } from './neural-worker.js';

describe('measurePcm', () => {
  it('reports peak and RMS for generated mono PCM', () => {
    const result = measurePcm(new Float32Array([0, -0.5, 0.5, 1]));
    expect(result.signalPeak).toBe(1);
    expect(result.signalRms).toBeCloseTo(Math.sqrt(1.5 / 4));
  });

  it('reports silence for an empty buffer', () => {
    expect(measurePcm(new Float32Array())).toEqual({ signalPeak: 0, signalRms: 0 });
  });
});
