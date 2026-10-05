#!/usr/bin/env node
/**
 * Verifica que a release publicada no GitHub esta coerente e que o app
 * instalado consegue chegar a ela.
 *
 * O ponto critico: descarrega o feed pelo MESMO URL que o electron-updater usa
 * (`releases/latest/download/latest.yml`) em vez de pela API. A API pode dizer
 * que a release existe enquanto o CDN ainda serve um `latest.yml` antigo — foi
 * exactamente o que aconteceu com o `dist\latest.yml` orfao do build de 00:03.
 *
 * Uso:
 *   node scripts/verify-release.js                    # verifica e descarrega (~250 MB)
 *   node scripts/verify-release.js --skip-download    # so metadados, segundos
 *   node scripts/verify-release.js --expect 2.0.6     # exige esta versao no feed
 *
 * Saida: exit 0 = PASS, exit 1 = FAIL.
 */

const { createHash } = require('node:crypto')

const OWNER = 'optdinho'
const REPO = 'dinhoopt'
const FEED_URL = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.yml`
const API_LATEST = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const skipDownload = has('--skip-download')
const expectedVersion = valueOf('--expect')

const failures = []
const notes = []

function ok(msg) {
  console.log(`  OK    ${msg}`)
}
function fail(msg) {
  failures.push(msg)
  console.log(`  FALHA ${msg}`)
}
function note(msg) {
  notes.push(msg)
  console.log(`  nota  ${msg}`)
}

/**
 * O `latest.yml` e YAML, mas so interessam 4 campos e nenhum valor tem
 * caracteres que precisem de escape. Parse minimo em vez de trazer uma
 * dependencia para 30 linhas.
 *
 * A indentacao e o que separa as chaves: `files:` a 0, `  - url:` a 2,
 * `    sha512:` a 4 e o `sha512:` de topo a 0. Sem a distinguir, o sha512 de
 * dentro de `files[0]` sobrescrevia o de topo e a verificacao de integridade
 * passava a ler vazio.
 */
function parseFeed(raw) {
  const out = { files: [] }
  let inFiles = false
  const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '')

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    if (indent === 0) {
      const kv = trimmed.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/)
      if (kv) {
        if (kv[1] === 'files') inFiles = true
        else out[kv[1]] = unquote(kv[2])
      }
      continue
    }

    if (!inFiles) continue

    const item = trimmed.match(/^-\s*url:\s*(.+)$/)
    if (item) {
      out.files.push({ url: unquote(item[1]) })
      continue
    }
    const sub = trimmed.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/)
    if (sub && out.files.length > 0) {
      out.files[out.files.length - 1][sub[1]] = unquote(sub[2])
    }
  }
  return out
}

/**
 * A tag que o CDN esta a servir. `releases/latest/download/` responde 302 com a
 * tag no `location`; seguir os redirects perde-a porque o asset final vive em
 * objects.githubusercontent.com.
 */
async function resolveServedTag() {
  try {
    const res = await fetch(FEED_URL, { redirect: 'manual' })
    const loc = res.headers.get('location') ?? ''
    return loc.match(/\/releases\/download\/([^/]+)\//)?.[1] ?? null
  } catch {
    return null
  }
}

async function main() {
  console.log(`\nVerificando feed de auto-update do DiNho Optimizer`)
  console.log(`  feed: ${FEED_URL}\n`)

  let feedRes
  try {
    feedRes = await fetch(FEED_URL, { redirect: 'follow' })
  } catch (err) {
    fail(`feed inacessivel: ${err.message}`)
    return 1
  }

  if (!feedRes.ok) {
    fail(`feed devolveu HTTP ${feedRes.status} — nenhuma release com latest.yml`)
    return 1
  }

  const servedTag = (await resolveServedTag()) ?? 'desconhecida'
  const raw = await feedRes.text()
  const feed = parseFeed(raw)

  console.log(`  versao no feed : ${feed.version ?? '(ausente)'}`)
  console.log(`  tag servida    : ${servedTag}`)
  console.log(`  releaseDate    : ${feed.releaseDate ?? '(ausente)'}\n`)

  if (!feed.version) fail(`feed sem 'version' — malformado`)
  if (!feed.files.length) fail(`feed sem 'files[]' — o updater nao tem o que descarregar`)

  if (expectedVersion) {
    if (feed.version === expectedVersion) ok(`feed expoe ${expectedVersion} (esperado)`)
    else fail(`feed expoe ${feed.version}, esperado ${expectedVersion}`)
  }

  // --- coerencia do feed com a API -----------------------------------------
  try {
    const apiRes = await fetch(API_LATEST, { headers: { 'User-Agent': 'verify-release' } })
    if (apiRes.ok) {
      const rel = await apiRes.json()
      if (rel.tag_name?.replace(/^v/, '') === feed.version) {
        ok(`API e feed concordam na versao ${feed.version} (tag ${rel.tag_name})`)
      } else {
        fail(`API diz ${rel.tag_name} mas o feed diz ${feed.version}`)
      }
      if (!rel.assets.some((a) => a.name === 'latest.yml')) {
        fail(`release ${rel.tag_name} nao tem 'latest.yml' como asset`)
      } else {
        ok(`'latest.yml' esta anexado a ${rel.tag_name}`)
      }
    }
  } catch {
    note('nao consegui consultar a API (offline?) — verificacao parcial')
  }

  // --- coerencia feed vs binario real --------------------------------------
  const file = feed.files[0]
  if (!file?.url) {
    fail(`files[0] sem 'url'`)
    return 1
  }

  if (!file.sha512) {
    fail(`files[0] sem 'sha512' — o electron-updater nao podria validar o download`)
  } else {
    ok(`sha512 declarado no feed (${file.sha512.slice(0, 16)}...)`)
  }

  if (skipDownload) {
    console.log(`\n--skip-download: integridade do binario por verificar.`)
  } else {
    const binUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${file.url}`
    process.stdout.write(`  a descarregar ${file.url} (~${Math.round((file.size ?? 0) / 1048576)} MB)... `)
    let res
    try {
      res = await fetch(binUrl, { redirect: 'follow' })
    } catch (err) {
      console.log('erro')
      fail(`descarregamento falhou: ${err.message}`)
      return 1
    }

    if (!res.ok) {
      console.log('erro')
      fail(`binario ${file.url} devolveu HTTP ${res.status} — o feed aponta para nada`)
      return 1
    }

    const buf = Buffer.from(await res.arrayBuffer())
    const actualSha512 = createHash('sha512').update(buf).digest('base64')
    const actualSize = buf.length
    console.log('feito')

    if (actualSha512 === file.sha512) {
      ok(`sha512 do binario bate certo com o feed`)
    } else {
      fail(`sha512 DIVERGENTE — feed diz ${file.sha512}, binario e ${actualSha512}`)
    }

    if (file.size != null) {
      if (actualSize === Number(file.size)) ok(`tamanho bate certo (${actualSize} bytes)`)
      else fail(`tamanho DIVERGENTE — feed diz ${file.size}, binario e ${actualSize}`)
    }
  }

  // --- veredicto -------------------------------------------------------------
  console.log('')
  if (failures.length === 0) {
    console.log(`PASS — a release esta publicada e coerente.`)
    return 0
  }
  console.log(`FAIL — ${failures.length} problema(s):`)
  for (const f of failures) console.log(`  - ${f}`)
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`erro inesperado: ${err.message}`)
    process.exit(1)
  })