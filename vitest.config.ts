import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Los tests de integracion/e2e usan el emulador de Firestore y deben correr
    // en serie para no pelearse por los mismos documentos.
    poolOptions: {
      threads: { singleThread: true }
    },
    testTimeout: 20000,
    hookTimeout: 30000
  }
});
