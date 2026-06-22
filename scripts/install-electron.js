const { downloadArtifact } = require('@electron/get')
const extract = require('extract-zip')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const pkg = require('./node_modules/electron/package.json')
  const base = __dirname
  const zipPath = await downloadArtifact({ version: pkg.version, artifactName: 'electron' })
  await extract(zipPath, { dir: path.join(base, 'node_modules/electron/dist') })
  fs.writeFileSync(path.join(base, 'node_modules/electron/path.txt'), 'electron.exe')
}

main().catch((e) => {
  console.error('FAIL:', e.message, e.stack)
  process.exit(1)
})
