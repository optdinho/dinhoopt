import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    reporters: ['verbose'],
    pool: 'threads',
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      enabled: true,
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
        'src/**/coverage/**',
        'src/renderer/src/**/constants.ts',
        'src/renderer/src/i18n.ts',
        'src/renderer/src/lib/hosts-recommendations.ts',
        'src/renderer/src/lib/languages.ts',
        'src/main/services/elevation.ts',
        'src/**/*.html',
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
