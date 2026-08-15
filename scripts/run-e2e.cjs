// E2E runner: injects DINHO_E2E_KEY for the build (the define embeds it in
// the main bundle), then runs the Playwright suite. The key alone is NOT
// enough to bypass the license: the marker file (.dinho-e2e-license in the
// app userData) and !app.isPackaged are also required, so this default only
// affects the E2E flow — `npm run dev` stays gated.
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')

process.env.DINHO_E2E_KEY ??= 'diNho-e2e-dev-key'

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('electron-vite', ['build'])
run('playwright', ['test', '--config', resolve(__dirname, '../e2e/playwright.config.ts')])
