import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Config separada para os harnesses de dívida (R4/R5).
 *
 * NÃO é o `vitest.config.mts` default de propósito: os harnesses TOCAM o SO real
 * (reg.exe / ficheiros de clip) e por isso nunca podem correr em CI nem na
 * contagem "0 skipped" da suite normal. Correr só explicitamente:
 *
 *   npm run test:harness
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/harness/**/*.harness.ts'],
    reporters: ['verbose'],
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
})
