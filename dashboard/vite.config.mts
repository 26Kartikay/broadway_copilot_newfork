import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
// Use .mts so Node treats this as ESM under package.json "type": "module"
// (avoids "exports is not defined" when a .js config is emitted as CommonJS).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/admin': 'http://localhost:8090',
    },
  },
  build: {
    outDir: 'dist',
  },
});
