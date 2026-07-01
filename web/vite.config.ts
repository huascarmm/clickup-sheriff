import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    port: 5173,
    // En desarrollo, redirige /api al backend local (Cloud Run se simula en :8080).
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
});
