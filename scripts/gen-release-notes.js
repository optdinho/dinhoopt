#!/usr/bin/env node
/**
 * Gera `release-notes.md` (raiz do projeto) a partir do `CHANGELOG.md`, para a
 * versao declarada no `package.json`.
 *
 * Porque isto existe: o electron-builder usa o `release-notes.md` do projeto
 * como body da release do GitHub
 * (`app-builder-lib/out/publish/PublishManager.js` -> `resolveReleaseBody`, que
 * cai no fallback `release-notes.md`; e o `releaseInfo.releaseNotesFile` que
 * declaramos em `electron-builder.yml`). Sem isto, cada release nascia com o
 * body vazio e tinha de ser corrigido a mao via API (`PATCH /releases/...`).
 *
 * Se o CHANGELOG nao tiver uma seccao para a versao atual, o script FALHA com
 * exit 1 em vez de escrever um ficheiro vazio - publicar com body vazio foi
 * exactamente o defeito que isto resolve, e um exit >0 aborta o release antes
 * do upload.
 *
 * Uso: node scripts/gen-release-notes.js
 */

const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const PROJECT_ROOT = join(__dirname, '..')
const CHANGELOG_PATH = join(PROJECT_ROOT, 'CHANGELOG.md')
const OUTPUT_PATH = join(PROJECT_ROOT, 'release-notes.md')

/**
 * Extrai o corpo da seccao `## <version>` do CHANGELOG, sem o proprio cabecalho.
 * @param {string} changelog conteudo integral do CHANGELOG.md
 * @param {string} version versao alvo (ex.: "2.0.8")
 * @returns {string | null} o corpo trimado, ou null se nao houver seccao/conteudo
 */
function extractVersionSection(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headerRe = new RegExp(`^##\\s+\\[?v?${escaped}\\]?\\s*$`)
  const nextHeaderRe = /^##\s+/

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return null

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (nextHeaderRe.test(lines[i])) {
      end = i
      break
    }
  }

  const body = lines
    .slice(start + 1, end)
    .join('\n')
    // remove a regra horizontal de separacao (o `---` que precede a proxima seccao)
    .replace(/(\n\s*---\s*)+$/, '')
    .trim()

  return body.length > 0 ? body : null
}

function main() {
  const version = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')).version
  const changelog = readFileSync(CHANGELOG_PATH, 'utf-8')
  const section = extractVersionSection(changelog, version)

  if (section == null) {
    console.error(`[release-notes] CHANGELOG.md nao tem seccao para a versao ${version}`)
    process.exit(1)
  }

  const output = `# DiNho Optimizer v${version}\n\n${section}\n`
  writeFileSync(OUTPUT_PATH, output, 'utf-8')
  console.log(`[release-notes] release-notes.md escrito para v${version} (${output.length} chars)`)
}

if (require.main === module) {
  main()
}

module.exports = { extractVersionSection, main }
