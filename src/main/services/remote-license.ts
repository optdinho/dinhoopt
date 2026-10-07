import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_MARKER_FILENAME } from '@shared/e2e-license-marker'
import { app, net } from 'electron'
import { getSecret } from './env-sanitize'
import { generateHwid, getHwidSync } from './hwid'
import { deleteSavedKey, initStore, readSavedKey, writeSavedKey } from './license-store'

const NETWORK_TIMEOUT = 20_000
const MAX_RETRIES = 2

const FALLBACK_URL = 'https://crimson-wildflower-4de0.mirandaotabol.workers.dev'

// O app so usa a rota publica `validate`, que nao exige token de admin.
// Nao ha nenhum fallback hardcoded de proposito: um token embutido no
// binario e extraivel por qualquer pessoa que baixe o app, e o repo e
// publico. O token, quando existir, vem do build (secret do CI) ou do
// license-config.json do usuario.
function getLicenseConfig(): { url: string; token: string } {
  const configPath = join(app.getPath('userData'), 'license-config.json')
  if (existsSync(configPath)) {
    try {
      const config: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
      const url = (config as { url?: unknown })?.url
      const token = (config as { token?: unknown })?.token
      if (typeof url === 'string' && url && typeof token === 'string' && token) {
        return { url, token }
      }
      // O ficheiro existe mas nao serve: sem este aviso a implantacao
      // auto-hospedada cai para o endpoint publico sem que ninguem veja.
      console.warn(`[license] ${configPath} sem url/token validos — a usar o endpoint publico`)
    } catch (err) {
      console.warn(`[license] ${configPath} ilegivel — a usar o endpoint publico`, err)
    }
  }
  const url = process.env.LICENSE_API_URL || FALLBACK_URL
  return { url, token: getSecret('LICENSE_API_TOKEN') || '' }
}

let initialized = false

/** Razoes oficiais de "sem rede" — `checkLicense` compara com esta constante
 *  para decidir o fallback offline. Nao trocar a string sem trocar aqui. */
export const OFFLINE_FALLBACK_REASON = 'Sem conexao com o servidor'

/** Resolve o `Location` de um redirect e recusa qualquer destino que nao seja
 *  a mesma origem (protocolo + host + porta) do endpoint configurado.
 *  Sem isto, um `Location:` no corpo da resposta (paginas de erro, HTML de
 *  proxy, 302 mal configurado) reencaminhava o header `Authorization` e o
 *  token no body para um host arbitrario. */
function resolveRedirectTarget(from: string, loc: string, origin: string): string {
  let target: URL
  try {
    target = new URL(loc, from)
  } catch {
    throw new Error(`redirect invalido: ${loc}`)
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error(`redirect para esquema nao permitido: ${target.protocol}`)
  }
  if (target.origin !== origin) {
    throw new Error(`redirect cross-origin recusado: ${target.origin}`)
  }
  return target.toString()
}

function ensureInit(): void {
  if (initialized) return
  const userData = app.getPath('userData')
  initStore({
    keyFile: join(userData, 'remote-license.key'),
    saltFile: join(userData, '.store-salt'),
  })
  initialized = true
}

async function callApi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { url: apiUrl, token: apiToken } = getLicenseConfig()
  // So anexa token quando existe — `validate` e rota publica e rejects
  // payload com token vazio em algumas implementacoes.
  const payload = JSON.stringify(apiToken ? { ...body, token: apiToken } : body)
  let lastBodySnippet = ''
  let lastError: unknown = null
  let origin = ''
  try {
    origin = new URL(apiUrl).origin
  } catch {
    throw new Error(`URL de licenca invalida: ${apiUrl}`)
  }

  async function fetchOnce(url: string): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const req = net.request({ method: 'POST', url, useSessionCookies: false } as {
        method: string
        url: string
        useSessionCookies: boolean
      })
      const timer = setTimeout(() => req.abort(), NETWORK_TIMEOUT)

      req.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(err.message || 'network error'))
      })
      req.on('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted/connection closed'))
      })
      req.on('response', (resp: Electron.IncomingMessage) => {
        clearTimeout(timer)
        const code = resp.statusCode ?? 0
        const stream = (resp as Electron.IncomingMessage & { response?: Electron.IncomingMessage }).response ?? resp
        if (!stream || typeof stream.on !== 'function') {
          reject(new Error('invalid response stream'))
          return
        }
        const onStreamError = (err: Error) => {
          clearTimeout(timer)
          reject(new Error(err.message || 'response stream error'))
        }
        const onStreamAborted = () => {
          clearTimeout(timer)
          reject(new Error('response aborted/stream closed'))
        }
        stream.on('error', onStreamError)
        stream.on('aborted' as unknown as 'aborted', onStreamAborted)
        stream.on('data', (d: unknown) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d as string)))
        stream.on('end', () => {
          clearTimeout(timer)
          resolve({ status: code, body: Buffer.concat(chunks) })
        })
      })
      req.setHeader('Content-Type', 'application/json')
      if (apiToken) req.setHeader('Authorization', `Bearer ${apiToken}`)
      req.setHeader('Accept', 'application/json')
      req.write(payload)
      req.end()
    })
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let url = apiUrl
      for (let hop = 0; hop < 5; hop++) {
        const { status, body } = await fetchOnce(url)
        lastBodySnippet = body.toString('utf8').slice(0, 500)
        if (status >= 300 && status < 400) {
          const loc =
            lastBodySnippet.match(/Location:\s*(\S+)/i)?.[1] ?? lastBodySnippet.match(/<A HREF="([^"]+)">/)?.[1]
          if (!loc) throw new Error(`redirect ${status} sem Location`)
          url = resolveRedirectTarget(url, loc, origin)
          continue
        }
        const parsed = JSON.parse(body.toString('utf8'))
        if (parsed && typeof parsed === 'object') return parsed
        throw new Error(`invalid response (not a JSON object): ${lastBodySnippet}`)
      }
      throw new Error('muitos redirects')
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(
    `Falha ao conectar com o servidor de licenca${detail ? `: ${detail}` : ''}${
      lastBodySnippet && !detail.includes(lastBodySnippet) ? ` | resposta: ${lastBodySnippet}` : ''
    }`,
  )
}

export interface RemoteLicenseResult {
  valid: boolean
  reason?: string
  type?: string
  expires_at?: string | null
}

const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000

// Semente constante: a assinatura NAO e segredo — o seu papel e ligar o cache
// a esta maquina (via HWID). Um ficheiro copiado de outro PC ou reescrito a mao
// nao produz a assinatura certa e e rejeitado. Nao usar getSecret: sem config
// o token seria vazio e a semente teria de ser igual na escrita e na leitura
// em todas as instalacoes.
const CACHE_SIGNING_SEED = 'dinho-license-cache-hmac-v1'

interface CacheEntry {
  valid: boolean
  reason?: string
  type?: string
  expires_at?: string | null
  timestamp: number
}

function getCachePath(): string {
  return join(app.getPath('userData'), '.license-cache.json')
}

function cacheSigningKey(): Buffer {
  return createHmac('sha256', CACHE_SIGNING_SEED).update(getHwidSync()).digest()
}

function signCachePayload(payload: string): string {
  return createHmac('sha256', cacheSigningKey()).update(payload).digest('hex')
}

function verifyCacheSignature(payload: string, sig: string): boolean {
  try {
    const expected = createHmac('sha256', cacheSigningKey()).update(payload).digest()
    const provided = Buffer.from(sig, 'hex')
    return provided.length === expected.length && timingSafeEqual(provided, expected)
  } catch {
    return false
  }
}

function readCache(): CacheEntry | null {
  try {
    const cachePath = getCachePath()
    if (existsSync(cachePath)) {
      const outer: unknown = JSON.parse(readFileSync(cachePath, 'utf-8'))
      const wrap = outer as { payload?: unknown; sig?: unknown }
      if (typeof wrap.payload !== 'string' || typeof wrap.sig !== 'string') return null
      // assinatura errada (ficheiro de outra maquina, editado a mao ou
      // falsificado) => o cache nao vale nada, trata-se como ausente
      if (!verifyCacheSignature(wrap.payload, wrap.sig)) return null
      const data: unknown = JSON.parse(wrap.payload)
      if (data && typeof (data as CacheEntry).timestamp === 'number') return data as CacheEntry
    }
  } catch {
    return null
  }
  return null
}

function writeCache(entry: CacheEntry): void {
  try {
    const payload = JSON.stringify(entry)
    writeFileSync(getCachePath(), JSON.stringify({ payload, sig: signCachePayload(payload) }), 'utf-8')
  } catch (err) {
    console.error('[license] falha ao gravar o cache de licenca:', err)
  }
}

export function validateLicenseOffline(): RemoteLicenseResult {
  const cached = readCache()
  if (cached && Date.now() - cached.timestamp < CACHE_VALIDITY_MS && cached.valid) {
    return {
      valid: true,
      ...(cached.type ? { type: cached.type } : {}),
      ...(cached.expires_at !== undefined ? { expires_at: cached.expires_at } : {}),
    }
  }
  return { valid: false, reason: 'Sem validação offline disponível' }
}

export async function validateLicense(key: string, hwid: string): Promise<RemoteLicenseResult> {
  try {
    const data = await callApi({ action: 'validate', key, hwid })
    if (data?.valid) {
      const result: RemoteLicenseResult = {
        valid: true,
        ...(typeof data.type === 'string' ? { type: data.type } : {}),
        ...(typeof data.expires_at === 'string' && data.expires_at !== ''
          ? { expires_at: data.expires_at }
          : { expires_at: null }),
      }
      writeCache({ ...result, timestamp: Date.now() } as CacheEntry)
      return result
    }
    return {
      valid: false,
      reason: typeof data?.reason === 'string' ? data.reason : 'Licença inválida',
      ...(typeof data.type === 'string' ? { type: data.type } : {}),
      ...(typeof data.expires_at === 'string' && data.expires_at !== ''
        ? { expires_at: data.expires_at }
        : { expires_at: null }),
    }
  } catch (err) {
    // A razao visivel ao utilizador tem de ser o sentinel (o `checkLicense`
    // compara com `OFFLINE_FALLBACK_REASON` para cair no fallback offline),
    // mas a causa real nao pode morrer aqui — registamo-la.
    console.error('[license] validate falhou:', err)
    return { valid: false, reason: OFFLINE_FALLBACK_REASON }
  }
}

export async function activateLicense(key: string): Promise<RemoteLicenseResult> {
  ensureInit()
  const hwid = await generateHwid()
  const result = await validateLicense(key.toUpperCase().trim(), hwid)
  const userData = app.getPath('userData')
  if (result.valid) writeSavedKey(join(userData, 'remote-license.key'), key.toUpperCase().trim())
  else deleteSavedKey(join(userData, 'remote-license.key'))
  return result
}

export function isE2EBypassEnabled(): boolean {
  if (process.env.DINHO_E2E !== '1') return false
  if (app.isPackaged) return false
  if (!process.env.DINHO_E2E_KEY) return false
  try {
    const markerPath = join(app.getPath('userData'), E2E_MARKER_FILENAME)
    return existsSync(markerPath)
  } catch {
    return false
  }
}

let revalidationInFlight = false

function scheduleBackgroundRevalidation(key: string): void {
  if (revalidationInFlight) return
  revalidationInFlight = true
  void generateHwid()
    .then((hwid) => validateLicense(key, hwid))
    .catch(() => {})
    .finally(() => {
      revalidationInFlight = false
    })
}

export async function checkLicense(): Promise<RemoteLicenseResult> {
  if (isE2EBypassEnabled()) {
    return { valid: true, type: 'test' }
  }
  ensureInit()
  const userData = app.getPath('userData')
  const key = readSavedKey(join(userData, 'remote-license.key'))
  if (!key) return { valid: false, reason: 'Nenhuma licença encontrada' }
  const cached = readCache()
  if (cached && Date.now() - cached.timestamp < CACHE_VALIDITY_MS && cached.valid) {
    scheduleBackgroundRevalidation(key)
    return {
      valid: true,
      ...(cached.type ? { type: cached.type } : {}),
      ...(cached.expires_at !== undefined ? { expires_at: cached.expires_at } : {}),
    }
  }
  const hwid = await generateHwid()
  const result = await validateLicense(key, hwid)
  if (!result.valid && result.reason === OFFLINE_FALLBACK_REASON) {
    return validateLicenseOffline()
  }
  return result
}

export async function getHwid(): Promise<string> {
  return generateHwid()
}

/** @internal reset de estado para testes */
export function __resetForTest(): void {
  initialized = false
}
