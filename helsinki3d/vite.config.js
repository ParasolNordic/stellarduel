// Vite: sivut – pelimaailma (index.html), alkuperäinen v0.1 (viewer-v01.html) ja moninpeli-FPS (fps.html).
// Kehityksessä Socket.IO välitetään tuotantopalvelimelle (node server.js, portti 3010).
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/socket.io': { target: 'http://127.0.0.1:3010', ws: true } } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), v01: resolve(__dirname, 'viewer-v01.html'), fps: resolve(__dirname, 'fps.html') } },
  },
});
