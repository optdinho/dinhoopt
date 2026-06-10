import { app, net } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { generateHwid } from './hwid'
import { initStore, readSavedKey, writeSavedKey, deleteSavedKey } from './license-store'

const API_URL = 'https://crimson-wildflower-4de0.mirandaotabol.workers.dev'
const API_TOKEN = 'DiNhoTOKEN0001'
const NETWORK_TIMEOUT = 20_000
const MAX_RETRIES = 2

let initialized = false

function ensureInit(): void {
  if (initialized) return
  const userData = app.getPath('userData')
  initStore({
    keyFile: join(userData, 'remote-license.key'),
    saltFile: join(userData, '.store-salt'),
  })
  initialized = true
}

async function callApi(body: Record<string, unknown>): Promise<any> {
  const payload = JSON.stringify({
    ...body,
    token: API_TOKEN,
  })
  let lastErr: Error | null = null
  let lastStatus: number | null = null
  let lastBodySnippet = ''

  async function fetchOnce(url: string): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const req = net.request({ method: 'POST', url, useSessionCookies: false } as any)
      const timer = setTimeout(() => req.abort(), NETWORK_TIMEOUT)

      req.on('error', (err: any) => { clearTimeout(timer); reject(new Error(err?.message || 'network error')) })
      req.on('aborted', () => { clearTimeout(timer); reject(new Error('aborted/connection closed')) })
      req.on('response', (resp: any) => {
        clearTimeout(timer)
        const code = resp.statusCode ?? 0
        const stream = resp.response ?? resp
        if (!stream || typeof stream.on !== 'function') { reject(new Error('invalid response stream')); return }
        stream.on('data', (d: any) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
        stream.on('end', () => {
          resolve({ status: code, body: Buffer.concat(chunks) })
        })
      })
      req.setHeader('Content-Type', 'application/json')
      req.setHeader('Accept', 'application/json')
      req.write(payload)
      req.end()
    })
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let url = API_URL
      for (let hop = 0; hop < 5; hop++) {
        const { status, body } = await fetchOnce(url)
        lastStatus = status
        lastBodySnippet = body.toString('utf8').slice(0, 500)
        if (status >= 300 && status < 400) {
          const loc = lastBodySnippet.match(/Location:\s*(\S+)/i)?.[1] ?? lastBodySnippet.match(/<A HREF="([^"]+)">/)?.[1]
          if (!loc) throw new Error(`redirect ${status} sem Location`)
          url = loc
          continue
        }
        const parsed = JSON.parse(body.toString('utf8'))
        if (parsed && typeof parsed === 'object') return parsed
        throw new Error(`invalid response (not a JSON object): ${lastBodySnippet}`)
      }
      throw new Error('muitos redirects')
    } catch (err: any) {
      lastErr = new Error(err?.message || String(err))
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  const detail = lastStatus !== null ? `HTTP ${lastStatus}` : 'no response'
  throw new Error(`Sem conexao com o servidor. [${detail}]`)
}

export interface RemoteLicenseResult {
  valid: boolean
  reason?: string
  type?: string
  expires_at?: string | null
}

export async function validateLicense(key: string, hwid: string): Promise<RemoteLicenseResult> {
  try {
    const data = await callApi({ action: 'validate', key, hwid })
    if (data?.valid) return { valid: true, type: data.type, expires_at: data.expires_at || null }
    return { valid: false, reason: data?.reason || 'Licença inválida', type: data?.type, expires_at: data?.expires_at || null }
  } catch (err: any) {
    return { valid: false, reason: err?.message || 'Sem conexao com o servidor' }
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

export async function checkLicense(): Promise<RemoteLicenseResult> {
  ensureInit()
  const userData = app.getPath('userData')
  const key = readSavedKey(join(userData, 'remote-license.key'))
  if (!key) return { valid: false, reason: 'Nenhuma licença encontrada' }
  const hwid = await generateHwid()
  return validateLicense(key, hwid)
}

export async function getHwid(): Promise<string> {
  return generateHwid()
}

/** @internal reset de estado para testes */
export function __resetForTest(): void {
  initialized = false
}
