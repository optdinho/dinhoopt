#!/usr/bin/env node
/**
 * Sincroniza a seccao "Novidades" (e os badges de versao) do README publico em
 * `optdinho/dinhoopt-releases` com o `CHANGELOG.md` deste repositorio.
 *
 * Porque isto existe: o body de cada release ja e gerado do CHANGELOG
 * (`gen-release-notes.js`), mas o README publico era mantido a mao e divergiu —
 * em 2026-11-08 ainda dizia 2.1.12 e nao tinha a 2.1.13. A pagina de releases e
 * o README sao o que um utilizador ve: um deles desatualizado e pior do que
 * nenhum.
 *
 * Fonte das notas, por ordem:
 *   1. `readme-notes/<versao>.md` — prosa escrita a mao (opcional, tem prioridade);
 *   2. a seccao da versao no `CHANGELOG.md`, sem o bloco "### Interno" (notas
 *      tecnicas nao interessam numa pagina publica).
 * Nunca publica uma seccao vazia: sem nota em nenhuma das fontes, sai com exit 1.
 *
 * O README e editado cirurgicamente entre os marcadores
 * `<!-- novidades:start -->` / `<!-- novidades:end -->` (inseridos no primeiro
 * run); tudo o resto fica byte-identico. As versoes sao deduplicadas e as mais
 * antigas caem fora a partir de `MAX_ENTRIES`.
 *
 * Uso:
 *   node scripts/sync-releases-readme.js                       # le e escreve no GitHub (GH_TOKEN)
 *   node scripts/sync-releases-readme.js --dry-run             # mostra o que mudaria
 *   node scripts/sync-releases-readme.js --file README.md      # transforma um ficheiro local
 *   node scripts/sync-releases-readme.js --version 2.1.14      # forca a versao
 *
 * Exit: 0 = ok/ nada a fazer, 1 = erro.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve, join } = require('node:path')

const { extractVersionSection } = require('./gen-release-notes.js')

const PROJECT_ROOT = join(__dirname, '..')
const OWNER = 'optdinho'
// O README publico vive no repo de binarios: `dinhoopt` (fonte) e privado.
const REPO = 'dinhoopt-releases'
const BRANCH = 'main'
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`
const CONTENTS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/README.md`

const NOV_START = '<!-- novidades:start -->'
const NOV_END = '<!-- novidades:end -->'
const MAX_ENTRIES = 5

const NOV_HEADING_RE = /^##\s+.*Novidades\s*$/
const H2_RE = /^##\s+/
const HEADING_RE = /^(#{1,3})\s+(.*)$/

/**
 * Remove o bloco `### Interno` (ou `## Interno`) de uma seccao do CHANGELOG:
 * e a parte que faz sentido no changelog, nao na pagina publica.
 * @param {string} section corpo da seccao da versao
 * @returns {string} a mesma seccao sem o bloco interno
 */
function stripInternalSections(section) {
  const out = []
  let skipping = false

  for (const line of String(section ?? '').split(/\r?\n/)) {
    const heading = line.match(HEADING_RE)
    if (heading) skipping = /^interno$/i.test(heading[2].trim())
    if (skipping) continue
    out.push(line)
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Escapa os pontos da versao: `### 2.1.13` vira `### 2\.1\.13`, senao o GitHub
 * transforma o numero num link para uma issue e o cabecalho fica ilegivel.
 * @param {string} version
 * @returns {string}
 */
function escapeVersion(version) {
  return String(version).replace(/\./g, '\\.')
}

/**
 * Separa as entradas `### <versao>` do interior da seccao Novidades.
 * @param {string} inner
 * @returns {Array<{ version: string, text: string }>} por ordem de aparicao
 */
function parseEntries(inner) {
  // So um `### <versao>` abre entrada. Um `### Alterado` (o CHANGELOG usa
  // sub-seccoes) faz parte do corpo da entrada anterior — sem esta distincao, o
  // segundo run promovia-o a entrada propria e duplicava as notas.
  const ENTRY_RE = /^(?=###\s+v?[\d.\\]+\s*$)/m
  return String(inner ?? '')
    .split(ENTRY_RE)
    .map((block) => block.trim())
    .filter((block) => /^###\s+v?[\d.\\]+\s*$/m.test(block.split('\n')[0]))
    .map((text) => {
      const first = text.split('\n')[0]
      const match = first.match(/^###\s+v?([\d.\\]+)/)
      return { version: match ? match[1].replace(/\\/g, '') : '', text }
    })
}

/**
 * Constroi a entrada da versao. Se as notas ja trouxerem o cabecalho
 * `### <versao>` (caso do override em prosa), nao o duplica.
 * @param {string} version
 * @param {string} notes
 * @returns {string}
 */
function buildEntry(version, notes) {
  const body = String(notes ?? '').trim()
  if (!body) throw new Error(`[readme] notas vazias para a versao ${version}`)

  const first = body.split('\n')[0]
  if (/^###\s/.test(first)) {
    const heading = first.replace(/^###\s+v?/, '').replace(/\\/g, '').trim()
    if (heading === String(version)) return body
  }

  return `### ${escapeVersion(version)}\n\n${body}`
}

/**
 * Substitui (ou insere) a seccao Novidades mantendo o resto do README intacto.
 * @param {string} readme
 * @param {string} entry entrada ja formatada
 * @param {number} [maxEntries]
 * @returns {string}
 */
function upsertNovidades(readme, entry, maxEntries = MAX_ENTRIES) {
  const lines = String(readme ?? '').split('\n')
  const headingIdx = lines.findIndex((line) => NOV_HEADING_RE.test(line))
  if (headingIdx === -1) throw new Error('[readme] README sem seccao "## 📝 Novidades"')

  let endIdx = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i])) {
      endIdx = i
      break
    }
  }

  const sectionLines = lines.slice(headingIdx, endIdx)
  const sectionText = sectionLines.join('\n')
  const hasRule = /(^|\n)---\s*$/.test(sectionText.replace(/\s+$/, ''))

  const quote =
    sectionLines.find((line) => /^>/.test(line)) ??
    `> Histórico completo das versões anteriores em **[Todas as versões](${RELEASES_URL})**.`

  const start = sectionText.indexOf(NOV_START)
  const end = sectionText.indexOf(NOV_END)
  let inner
  if (start !== -1 && end > start) {
    inner = sectionText.slice(start + NOV_START.length, end)
  } else {
    inner = sectionText
      .replace(NOV_HEADING_RE, '')
      .split('\n')
      .filter((line) => !/^>/.test(line))
      .join('\n')
      .replace(/(^|\n)---\s*$/, '')
  }

  const version = parseEntries(entry)[0]?.version ?? ''
  const kept = parseEntries(inner).filter((item) => item.version !== version)
  const rebuilt = [entry, ...kept.map((item) => item.text)].slice(0, maxEntries)

  const rebuiltLines = [
    sectionLines[0],
    '',
    quote,
    '',
    NOV_START,
    '',
    ...rebuilt.join('\n\n').split('\n'),
    '',
    NOV_END,
  ]
  if (hasRule) rebuiltLines.push('', '---', '')

  return [...lines.slice(0, headingIdx), ...rebuiltLines, ...lines.slice(endIdx)].join('\n')
}

/**
 * Atualiza os dois badges (versao e botao de download).
 * @param {string} readme
 * @param {string} version
 * @returns {string}
 */
function updateBadges(readme, version) {
  const escaped = escapeVersion(version)
  return String(readme ?? '')
    .replace(/(badge\/vers[ãa]o-)[\d\\.]+(-)/, `$1${escaped}$2`)
    .replace(/(badge\/Baixar-DiNho_Optimizer_)[\d\\.]+(-)/, `$1${escaped}$2`)
}

/**
 * O `CHANGELOG.md` so existe no repo privado: depois do flip o link relativo da
 * 404. Passa a apontar para a pagina de releases.
 * @param {string} readme
 * @returns {string}
 */
function updateChangelogLink(readme) {
  return String(readme ?? '')
    .replace(/\*\*\[CHANGELOG\.md\]\(CHANGELOG\.md\)\*\*/g, `**[Todas as versões](${RELEASES_URL})**`)
    .replace(/\[CHANGELOG\.md\]\(CHANGELOG\.md\)/g, `[Todas as versões](${RELEASES_URL})`)
}

/**
 * Aplica as tres transformacoes. Idempotente: correr duas vezes com os mesmos
 * argumentos produz o mesmo byte a byte, para o step do CI poder repetir.
 * @param {string} readme
 * @param {{ version: string, notes: string, maxEntries?: number }} args
 * @returns {string}
 */
function transformReadme(readme, { version, notes, maxEntries = MAX_ENTRIES }) {
  if (!String(notes ?? '').trim()) {
    throw new Error(`[readme] notas vazias para a versao ${version} (nem override nem CHANGELOG)`)
  }
  let out = updateBadges(readme, version)
  out = updateChangelogLink(out)
  out = upsertNovidades(out, buildEntry(version, notes), maxEntries)
  return out
}

/**
 * Escolhe a fonte das notas: prosa do override por versao, senao o CHANGELOG
 * sem o bloco "### Interno".
 * @param {{ version: string, notesDir: string, changelogSection: string }} args
 * @returns {string} notas nunca vazias (ou excepcao)
 */
function pickNotes({ version, notesDir, changelogSection }) {
  const overridePath = join(notesDir, `${version}.md`)
  if (existsSync(overridePath)) {
    const override = readFileSync(overridePath, 'utf-8').trim()
    if (override) return override
  }

  const fallback = stripInternalSections(changelogSection)
  if (!fallback) {
    throw new Error(
      `[readme] sem notas para ${version}: cria readme-notes/${version}.md ou uma seccao no CHANGELOG.md`,
    )
  }
  return fallback
}

function parseArgs(argv) {
  const valueOf = (flag) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    file: valueOf('--file'),
    version: valueOf('--version'),
    dryRun: argv.includes('--dry-run'),
  }
}

function summarize(before, after) {
  const versions = parseEntries(
    after.split(NOV_START)[1]?.split(NOV_END)[0] ?? '',
  ).map((entry) => entry.version)
  console.log(`[readme] ${before.length} -> ${after.length} chars`)
  console.log(`[readme] versoes no README: ${versions.join(', ') || '(nenhuma)'}`)
  console.log(`[readme] ${before === after ? 'sem alteracoes' : 'alterado'}`)
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dinho-sync-readme',
  }
}

async function runRemote({ version, notes, dryRun }) {
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('[readme] GH_TOKEN nao definido (precisa de write no dinhoopt-releases)')

  const res = await fetch(CONTENTS_URL, { headers: apiHeaders(token) })
  if (!res.ok) throw new Error(`[readme] GET README falhou: HTTP ${res.status}`)
  const payload = await res.json()
  const current = Buffer.from(payload.content, 'base64').toString('utf-8')

  const next = transformReadme(current, { version, notes })
  summarize(current, next)
  if (next === current) return 0
  if (dryRun) {
    console.log('[readme] --dry-run: nada escrito no GitHub')
    return 0
  }

  const put = await fetch(CONTENTS_URL, {
    method: 'PUT',
    headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `docs: novidades da v${version} no README`,
      content: Buffer.from(next, 'utf-8').toString('base64'),
      sha: payload.sha,
      branch: BRANCH,
    }),
  })
  if (!put.ok) {
    const body = await put.text()
    throw new Error(`[readme] PUT README falhou: HTTP ${put.status} ${body.slice(0, 300)}`)
  }
  console.log(`[readme] README do ${OWNER}/${REPO} atualizado com a v${version}`)
  return 0
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const version =
    args.version ?? JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')).version
  const changelog = readFileSync(join(PROJECT_ROOT, 'CHANGELOG.md'), 'utf-8')
  const section = extractVersionSection(changelog, version)

  const notes = pickNotes({
    version,
    notesDir: join(PROJECT_ROOT, 'readme-notes'),
    changelogSection: section ?? '',
  })

  if (args.file) {
    const path = resolve(PROJECT_ROOT, args.file)
    const current = readFileSync(path, 'utf-8')
    const next = transformReadme(current, { version, notes })
    summarize(current, next)
    if (next !== current && !args.dryRun) writeFileSync(path, next, 'utf-8')
    return 0
  }

  return runRemote({ version, notes, dryRun: args.dryRun })
}

module.exports = {
  NOV_START,
  NOV_END,
  MAX_ENTRIES,
  RELEASES_URL,
  stripInternalSections,
  escapeVersion,
  parseEntries,
  buildEntry,
  upsertNovidades,
  updateBadges,
  updateChangelogLink,
  transformReadme,
  pickNotes,
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message ?? err)
      process.exit(1)
    },
  )
}
