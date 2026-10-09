// Vite: kaksi sivua – uusi pelimaailma (index.html) ja alkuperäinen v0.1-katselin (viewer-v01.html).
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), v01: resolve(__dirname, 'viewer-v01.html') } },
  },
});
