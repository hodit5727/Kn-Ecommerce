import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read plain env names (PORT / BACKEND_URL) from .env files. These are
  // connectivity settings only — no secrets are ever read here, and the
  // defaults exactly match .env.example for local development.
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.BACKEND_URL || `http://localhost:${env.PORT || '3001'}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      open: false,
      allowedHosts: true,
      // Dev-only proxy: the frontend calls same-origin `/api/v1` (see
      // src/api/config.ts) and Vite forwards it to the Express backend.
      // Production serves this path from the real API host instead.
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              // eslint-disable-next-line no-console
              console.warn(`[vite-proxy] Backend at ${backendTarget} is offline or booting up: ${err.message}`);
              if (!res.headersSent && typeof (res as any).writeHead === 'function') {
                (res as any).writeHead(503, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({
                  error: {
                    message: 'Backend server is temporarily starting up or offline on port 3001. Please ensure backend is running.',
                    code: 'BACKEND_OFFLINE',
                  },
                }));
              }
            });
          },
        },
      },
    },
    preview: {
      allowedHosts: true,
    },
    build: {
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
                return 'vendor-react';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
            }
          },
        },
      },
    },
  };
});
