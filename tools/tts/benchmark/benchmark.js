'use strict';

const params = new URLSearchParams(location.search);
const language = params.get('language') === 'ru-RU' ? 'ru-RU' : 'en-US';
const texts = {
  'ru-RU': 'Добро пожаловать в наш эфир. Ваше сообщение сейчас будет прочитано вслух.',
  'en-US': 'Welcome to our live stream. Your message will now be read aloud.',
};
const runs = [];
const startedAt = performance.now();
let generationStartedAt = 0;
let readyAt = 0;
let worker;

function fail(message) {
  document.getElementById('status').textContent = 'Failed';
  document.getElementById('result').textContent = JSON.stringify({ language, error: String(message) }, null, 2);
  document.body.dataset.complete = 'error';
  worker?.terminate();
}

function generate() {
  generationStartedAt = performance.now();
  worker.postMessage({ type: 'generate', text: texts[language], sid: 0, speed: 1 });
}

try {
  worker = new Worker('sherpa-onnx-tts.worker.js');
  const timeout = setTimeout(() => fail('Benchmark timed out'), 180_000);
  worker.onerror = (event) => fail(event.message || 'Worker failed');
  worker.onmessage = (event) => {
    const data = event.data;
    if (data.type === 'error') { clearTimeout(timeout); fail(data.message); return; }
    if (data.type === 'sherpa-onnx-tts-progress') {
      document.getElementById('status').textContent = data.status || 'Initializing model…';
      return;
    }
    if (data.type === 'sherpa-onnx-tts-ready') {
      readyAt = performance.now();
      document.getElementById('status').textContent = 'Generating…';
      generate();
      return;
    }
    if (data.type !== 'sherpa-onnx-tts-result') return;
    const elapsedMs = performance.now() - generationStartedAt;
    const audioSeconds = data.samples.length / data.sampleRate;
    runs.push({ elapsedMs: Math.round(elapsedMs * 10) / 10, audioSeconds: Math.round(audioSeconds * 1000) / 1000, rtf: Math.round((elapsedMs / 1000 / audioSeconds) * 1000) / 1000 });
    if (runs.length < 3) { generate(); return; }
    clearTimeout(timeout);
    const result = {
      language,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      initializationMs: Math.round((readyAt - startedAt) * 10) / 10,
      runs,
    };
    document.getElementById('status').textContent = 'Complete';
    document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    document.body.dataset.complete = 'true';
    worker.terminate();
  };
} catch (error) {
  fail(error instanceof Error ? error.message : error);
}
