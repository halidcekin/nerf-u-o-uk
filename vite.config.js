import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
  server: { port: 5199 },
});
