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
        source: template.replace('const SOURCE_REVISION = __SOURCE_REVISION__;', () => `const SOURCE_REVISION = ${JSON.stringify(revision)};`),
      });
    },
  };
}

const base = process.env.TIKTOK_HELPER_BASE_PATH ?? '/';
if (base !== '/' && base !== '/tiktokhelper/') throw new Error('Invalid TIKTOK_HELPER_BASE_PATH');

export default defineConfig({
  base,
  plugins: [react(), serviceWorkerPlugin()],
  server: {
    proxy: {
      [`^${base}(api/|auth/|socket\\.io/|sounds/|media/sounds/|tts-assets/)`]: {
        target: 'http://127.0.0.1:3000',
        ws: true,
        rewrite: (path) => `/${path.slice(base.length)}`,
      },
    },
  },
});
