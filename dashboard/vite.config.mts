import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
// Use .mts so Node treats this as ESM under package.json "type": "module"
// (avoids "exports is not defined" when a .js config is emitted as CommonJS).
export default defineConfig(({ mode }) => {
  const envRepo = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const envDash = loadEnv(mode, __dirname, '');
  // Must match analysis_agent / Dockerfile.api listen port (default 8000). Docker Compose sets ANALYTICS_API_URL for the server; Vite reads the same var when present.
  let analyticsProxyTarget =
    envDash.ANALYTICS_API_URL || envRepo.ANALYTICS_API_URL || 'http://localhost:8000';
  // Host dev cannot reach the Docker service hostname; fall back to localhost.
  if (analyticsProxyTarget.includes('analytics-api')) {
    analyticsProxyTarget = 'http://localhost:8000';
  }

  return {
    plugins: [react()],
    // Prefer TypeScript sources over any stray .js next to them (default order is .js before .ts).
    resolve: {
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json'],
    },
    server: {
      port: 3000,
      proxy: {
        '/admin': 'http://localhost:8090',
        '/analytics-api': {
          target: analyticsProxyTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/analytics-api/, '/api'),
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
