import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The API needs no debug listener; avoid automatic inspector port discovery.
  plugins: [react(), cloudflare({ inspectorPort: false })],
  server: {
    port: 5173,
    strictPort: true,
    cors: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
    cors: false,
  },
});
