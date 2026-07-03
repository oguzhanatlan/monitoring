import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Geliştirmede API ve WebSocket istekleri backend'e (localhost:3000) proxy'lenir.
// Üretimde bu işi Nginx yapar (bkz. nginx/server-panel.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
});
