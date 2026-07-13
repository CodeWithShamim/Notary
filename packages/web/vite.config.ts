import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Some SDK deps probe for a Node global.
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Route bare `buffer` imports to the polyfill instead of externalizing.
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: { port: 5173 },
  // `vite preview` serves the built SPA in production (Railway). Railway hands
  // us a dynamic *.up.railway.app host, so don't block on host name.
  preview: { host: true, allowedHosts: true },
});
