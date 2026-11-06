import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  retries: 1,
  // O relatório HTML guarda só o que falhou: numa corrida de ~24 min com 40 testes,
  // arrastar todos os que passaram torna o artefacto inútil e pesado.
  reporter: [['list'], ['failures'], ['html', { onlyFailures: true, open: 'never' }]],
  use: {
    headless: true,
  },
  projects: [
    {
      name: 'electron',
    },
  ],
})
