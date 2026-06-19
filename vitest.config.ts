import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['verbose'],
    pool: 'threads',
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/test-setup.ts',
        'src/test-utils.ts',
        'src/renderer/src/**/*.tsx',
        'src/renderer/src/src.d.ts',
        'src/shared/i18n/**',
        'src/shared/channels.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
