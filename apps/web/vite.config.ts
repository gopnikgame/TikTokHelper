import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function serviceWorkerPlugin(): Plugin {
  return {
    name: 'tiktok-helper-service-worker',
    apply: 'build',
    generateBundle() {
      const revision = process.env.VITE_SOURCE_REVISION ?? 'development';
      const template = readFileSync(new URL('./src/pwa/service-worker.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__SOURCE_REVISION__', JSON.stringify(revision)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
