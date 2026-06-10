import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  retries: 1,
  use: {
    headless: true,
  },
  projects: [
    {
      name: 'electron',
    },
  ],
})
