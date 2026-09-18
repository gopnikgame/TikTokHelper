import { neuralPackageBaseUrl, type NeuralVoicePackage } from './neural-assets.js';

interface WorkerResult { type: string; samples?: Float32Array; sampleRate?: number; message?: string }
export interface NeuralBenchmarkResult { initializationMs: number; generationMs: number; audioSeconds: number; rtf: number }
export interface NeuralSynthesisResult extends NeuralBenchmarkResult { samples: Float32Array; sampleRate: number }

export class NeuralTtsWorkerClient {
  async synthesize(asset: NeuralVoicePackage, text: string): Promise<NeuralSynthesisResult> {
    if (text.length < 1 || text.length > 240) throw new Error('Benchmark text length is invalid');
    const startedAt = performance.now();
    const worker = new Worker(new URL('sherpa-onnx-tts.worker.js', neuralPackageBaseUrl(asset)));
    return new Promise((resolve, reject) => {
      let readyAt = 0; let timeout = 0;
      const finish = (callback: () => void) => { window.clearTimeout(timeout); worker.terminate(); callback(); };
      timeout = window.setTimeout(() => finish(() => reject(new Error('TTS worker timed out'))), 180_000);
      worker.onerror = (event) => finish(() => reject(new Error(event.message || 'TTS worker failed')));
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const data = event.data;
        if (data.type === 'error') { finish(() => reject(new Error(data.message || 'TTS worker failed'))); return; }
        if (data.type === 'sherpa-onnx-tts-ready') { readyAt = performance.now(); worker.postMessage({ type: 'generate', text, sid: 0, speed: 1 }); return; }
        if (data.type !== 'sherpa-onnx-tts-result' || !data.samples || !data.sampleRate || readyAt === 0) return;
        const finishedAt = performance.now(); const audioSeconds = data.samples.length / data.sampleRate;
        finish(() => resolve({
          initializationMs: readyAt - startedAt, generationMs: finishedAt - readyAt,
          audioSeconds, rtf: (finishedAt - readyAt) / 1000 / audioSeconds,
          samples: data.samples!, sampleRate: data.sampleRate!,
        }));
      };
    });
  }

  async benchmark(asset: NeuralVoicePackage, text: string): Promise<NeuralBenchmarkResult> {
    const result = await this.synthesize(asset, text);
    return {
      initializationMs: result.initializationMs, generationMs: result.generationMs,
      audioSeconds: result.audioSeconds, rtf: result.rtf,
    };
  }
}
