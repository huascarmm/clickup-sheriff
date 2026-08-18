import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Los tests de integracion/e2e comparten UNA base MySQL y cada uno la trunca
    // en su beforeEach, asi que los archivos deben correr en serie: si dos van a
    // la vez, el clearAll de uno borra los datos del otro a medio test.
    //
    // fileParallelism en vez de poolOptions.threads: desde Vitest 2 el pool por
    // defecto es 'forks', asi que la config de 'threads' se ignoraba en silencio
    // y los archivos corrian en paralelo igual. Esta opcion no depende del pool.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    reporters: ['verbose']
  }
});
