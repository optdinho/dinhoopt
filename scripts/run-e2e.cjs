// E2E runner: injects DINHO_E2E_KEY for the build (the define embeds it in
// the main bundle), then runs the Playwright suite. The key alone is NOT
// enough to bypass the license: the marker file (.dinho-e2e-license in the
// app userData) and !app.isPackaged are also required, so this default only
// affects the E2E flow — `npm run dev` stays gated.
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')

process.env.DINHO_E2E_KEY ??= 'diNho-e2e-dev-key'

// Node 26 emits DEP0190 when `shell: true` is combined with an args array:
// the arguments are concatenated into a command string and are not escaped.
// Spawning the local bins through `process.execPath` avoids the shell
// entirely, works when the script is called directly (no npm PATH), and
// keeps the child on the same Node runtime as this runner.
function run(bin, args) {
  const r = spawnSync(process.execPath, [bin, ...args], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(resolve(__dirname, '../node_modules/electron-vite/bin/electron-vite.js'), ['build'])
run(
  resolve(__dirname, '../node_modules/@playwright/test/cli.js'),
  ['test', '--config', resolve(__dirname, '../e2e/playwright.config.ts')],
)
