#!/usr/bin/env node
/**
 * Garante que a release do GitHub para a versao atual existe ANTES de o
 * electron-builder publicar os assets.
 *
 * Porque isto existe: o electron-builder publica cada artefacto em paralelo
 * (nsis + portable) e o `getOrCreatePublisher` tem uma corrida - ambos fazem
 * `GET /releases` (404) e depois ambos `POST /releases`; o primeiro cria a
 * release, o segundo recebe `422 already_exists` e o run morre a meio
 * ("Cannot cleanup"). Foi exactamente o que aconteceu no run 37928024831: a
 * release v2.0.8 foi criada, mas so o `.blockmap` subiu (o `.exe` e o
 * `latest.yml` ficaram de fora).
 *
 * Criando a release aqui de forma idempotente, os publishers encontram-na no
 * `GET` do `getOrCreateRelease` e apenas fazem upload dos assets - a corrida
 * deixa de existir.
 *
 * Se a release ja existir, atualiza o body (mantem as notas frescas) e segue.
 *
 * Requer `GH_TOKEN` no ambiente. Corre depois de `release:notes` (le
 * `release-notes.md`) e antes de `electron-builder`.
 *
 * Uso: node scripts/ensure-release.js
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const https = require('node:https')

const OWNER = 'optdinho'
const REPO = 'dinhoopt'
const PROJECT_ROOT = join(__dirname, '..')

/**
 * Payload de criacao da release (mesmos valores que o electron-builder usa:
 * tag `v<version>`, name = version, nao-draft).
 * @param {string} version
 * @param {string} notes
 * @param {string} [targetCommitish]
 */
function buildReleasePayload(version, notes, targetCommitish) {
  const payload = {
    tag_name: `v${version}`,
    name: version,
    body: notes,
    draft: false,
    prerelease: false,
  }
  if (targetCommitish) {
    payload.target_commitish = targetCommitish
  }
  return payload
}

/**
 * Cliente HTTP injetavel (testavel). Devolve o JSON da resposta e lanca um erro
 * com `status` em respostas nao-2xx.
 */
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'dinho-optimizer-release',
          Accept: 'application/vnd.github+json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => (raw += chunk))
        res.on('end', () => {
          const status = res.statusCode || 0
          if (status >= 200 && status < 300) {
            try {
              resolve(raw ? JSON.parse(raw) : null)
            } catch (e) {
              reject(new Error(`resposta invalida de ${method} ${path}: ${e.message}`))
            }
          } else {
            const err = new Error(`GitHub ${method} ${path} -> ${status}: ${raw}`)
            err.status = status
            reject(err)
          }
        })
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

/**
 * @param {{ version: string, notes: string, token: string, request: Function, targetCommitish?: string }} opts
 * @returns {Promise<{ action: 'created' | 'updated', id: number }>}
 */
async function ensureRelease({ version, notes, token, request: doRequest, targetCommitish }) {
  const base = `/repos/${OWNER}/${REPO}`
  const tagPath = `${base}/releases/tags/${encodeURIComponent(`v${version}`)}`

  try {
    const existing = await doRequest('GET', tagPath, token)
    await doRequest('PATCH', `${base}/releases/${existing.id}`, token, { body: notes })
    return { action: 'updated', id: existing.id }
  } catch (e) {
    if (e.status !== 404) {
      throw e
    }
  }

  const created = await doRequest('POST', `${base}/releases`, token, buildReleasePayload(version, notes, targetCommitish))
  return { action: 'created', id: created.id }
}

async function main() {
  const token = process.env.GH_TOKEN
  if (!token) {
    console.error('[ensure-release] GH_TOKEN nao definido no ambiente')
    process.exit(1)
  }
  const version = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')).version
  const notes = readFileSync(join(PROJECT_ROOT, 'release-notes.md'), 'utf-8').trim()
  const targetCommitish = process.env.GITHUB_SHA || undefined

  const result = await ensureRelease({ version, notes, token, request, targetCommitish })
  console.log(`[ensure-release] release v${version} ${result.action} (id=${result.id})`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[ensure-release] ${e.message}`)
    process.exit(1)
  })
}

module.exports = { buildReleasePayload, ensureRelease }
