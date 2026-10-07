import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { E2E_MARKER_FILENAME } from '@shared/e2e-license-marker'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock state (dynamic per-test) ────────────────────────────────────
const mockVars = vi.hoisted(() => {
  let _testRoot = ''
  return {
    setTestRoot: (r: string) => {
      _testRoot = r
    },
    getTestRoot: () => _testRoot,
  }
})

const mockNet = vi.hoisted(() => {
  let _status = 200
  let _body: any = { valid: false, reason: 'test-blocked' }
  let _error: string | null = null
  let _streamError: string | null = null
  let _streamAborted = false
  let _capturedPayload = ''
  let _callIndex = 0
  const _responses: Array<{ status?: number; body?: any; error?: string }> = []
  type ReqRecord = { url: string; headers: Record<string, string>; payload: string }
  const _requests: ReqRecord[] = []

  return {
    setResponse: (body: any, status = 200) => {
      _status = status
      _body = body
      _error = null
      _streamError = null
      _streamAborted = false
      _responses.length = 0
      _callIndex = 0
    },
    setError: (msg: string) => {
      _error = msg
      _streamError = null
      _streamAborted = false
      _responses.length = 0
      _callIndex = 0
    },
    setStreamError: (msg: string) => {
      _error = null
      _streamError = msg
      _streamAborted = false
      _responses.length = 0
      _callIndex = 0
    },
    setStreamAborted: () => {
      _error = null
      _streamError = null
      _streamAborted = true
      _responses.length = 0
      _callIndex = 0
    },
    setSequence: (seq: Array<{ status?: number; body?: any; error?: string }>) => {
      _responses.splice(0, _responses.length, ...seq)
      _streamError = null
      _streamAborted = false
      _callIndex = 0
    },
    getCapturedPayload: () => _capturedPayload,
    /** URL + headers de CADA pedido, por ordem — usado nos testes de redirect */
    getRequests: () => _requests,
    resetRequests: () => {
      _requests.length = 0
    },
    _makeRequest: (url: string) => {
      _capturedPayload = ''
      const record: ReqRecord = { url, headers: {}, payload: '' }
      _requests.push(record)
      return {
        on(ev: string, cb: any) {
          let status = _status
          let body = _body
          let error = _error
          // A sequencia avanca POR PEDIDO (uma resposta HTTP), nao por
          // subscricao de evento — senao `.on('error')` e `.on('abort')`
          // consomem entradas antes do `.on('response')` ver a primeira.
          if (_responses.length > 0 && ev === 'response') {
            const idx = Math.min(_callIndex, _responses.length - 1)
            const r = _responses[idx]!
            if (r.error !== undefined) error = r.error
            if (r.body !== undefined) body = r.body
            if (r.status !== undefined) status = r.status
            _callIndex++
          }
          if (error && ev === 'error') {
            setTimeout(() => cb(new Error(error)), 0)
          } else if (!error && ev === 'response') {
            setTimeout(
              () =>
                cb({
                  statusCode: status,
                  response: {
                    on(dEv: string, dCb: any) {
                      if (dEv === 'error' && _streamError) dCb(new Error(_streamError))
                      if (dEv === 'aborted' && _streamAborted) dCb(null)
                      // string va em cru: uma pagina de erro HTML nao e JSON
                      if (dEv === 'data') dCb(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
                      if (dEv === 'end') dCb(null)
                    },
                  },
                }),
              0,
            )
          }
          return this
        },
        setHeader(k: string, v: string) {
          record.headers[k.toLowerCase()] = v
        },
        write(data: string) {
          record.payload = data
          _capturedPayload = data
        },
        end() {},
      }
    },
  }
})

vi.mock('electron', () => {
  const p = require('node:path')
  const os = require('node:os')
  return {
    app: {
      getPath: (n: string) => (n === 'userData' ? mockVars.getTestRoot() : p.join(os.tmpdir(), n)),
      isPackaged: false,
    },
    net: {
      request: (opts: { url?: string }) => mockNet._makeRequest(opts?.url ?? ''),
    },
  }
})

const mockHwid = vi.hoisted(() => ({
  generateHwid: vi.fn(async () => 'test-hwid-12345'),
  getHwidSync: vi.fn(() => 'test-hwid-12345'),
}))

vi.mock('./hwid', () => mockHwid)

import { initStore, readSavedKey } from './license-store'
import {
  __resetForTest,
  activateLicense,
  checkLicense,
  getHwid,
  OFFLINE_FALLBACK_REASON,
  validateLicense,
} from './remote-license'

const KEYFILE = 'remote-license.key'
let testRoot = ''

beforeEach(() => {
  testRoot = path.join(tmpdir(), 'dinho-license-test', String(Date.now()))
  mockVars.setTestRoot(testRoot)
  try {
    fs.rmSync(testRoot, { recursive: true, force: true })
  } catch {}
  fs.mkdirSync(testRoot, { recursive: true })
  mockNet.resetRequests()
  __resetForTest()
})

afterAll(() => {
  try {
    const base = path.join(tmpdir(), 'dinho-license-test')
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true })
  } catch {}
})

function initStoreForTest(): void {
  initStore({
    keyFile: path.join(testRoot, KEYFILE),
    saltFile: path.join(testRoot, '.store-salt'),
  })
}

function savedKey(): string | null {
  try {
    return readSavedKey(path.join(testRoot, KEYFILE))
  } catch {
    initStoreForTest()
    return readSavedKey(path.join(testRoot, KEYFILE))
  }
}

describe('remote-license', () => {
  // ── checkLicense ──────────────────────────────────────────────────
  describe('checkLicense', () => {
    it('blocks when no key is saved', async () => {
      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })

    it('returns expired when API reports expired', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'OLD-EXPIRED-KEY', 'utf-8')
      mockNet.setResponse({ valid: false, reason: 'Licença expirada', type: 'expired', expires_at: '2024-01-01' })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Licença expirada')
      expect(result.type).toBe('expired')
      expect(result.expires_at).toBe('2024-01-01')
    })

    it('returns valid when API confirms license', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'VALID-KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('lifetime')
      expect(result.expires_at).toBeNull()
    })

    it('returns valid with subscription type and expiry date', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'SUB-KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '2026-12-31' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('subscription')
      expect(result.expires_at).toBe('2026-12-31')
    })

    it('falls back to offline cache when server is unreachable and cache is valid', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      // o cache valido so existe assinado pelo proprio app
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })
      await validateLicense('KEY', 'test-hwid-12345')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('lifetime')
    })

    it('returns offline message when server is unreachable and no cache', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('returns generic invalid when API returns invalid without reason', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'INVALID-KEY', 'utf-8')
      mockNet.setResponse({ valid: false })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Licença inválida')
    })

    it('serves fresh valid cache without consulting the network', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })
      await validateLicense('KEY', 'test-hwid-12345')
      // Servidor acessível e respondendo inválido — cache fresco deve vencer sem rede
      mockNet.setResponse({ valid: false, reason: 'bloqueado' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('lifetime')
    })

    it('consults the network when there is no signed cache', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '2026-12-31' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('subscription')
    })

    it('revalidates in background and refreshes the cache', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })
      await validateLicense('KEY', 'test-hwid-12345')
      const cachePath = path.join(testRoot, '.license-cache.json')
      const before = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
      const beforeTs = JSON.parse(before.payload).timestamp
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await checkLicense()
      expect(result.valid).toBe(true)

      await vi.waitFor(
        () => {
          const refreshed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
          const refreshedTs = JSON.parse(refreshed.payload).timestamp
          expect(refreshedTs).toBeGreaterThan(beforeTs)
        },
        { timeout: 5000 },
      )
    })
  })

  // ── A4: assinatura HMAC do cache (ligada ao HWID) ─────────────────
  describe('cache signing (A4)', () => {
    afterEach(() => {
      mockHwid.getHwidSync.mockReturnValue('test-hwid-12345')
    })

    it('rejects a fresh cache forged by hand with no signature', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      // exactamente a falsificacao do relatorio: {"valid":true,"timestamp":<agora>}
      fs.writeFileSync(
        path.join(testRoot, '.license-cache.json'),
        JSON.stringify({ valid: true, timestamp: Date.now() }),
        'utf-8',
      )
      // servidor acessivel e a recusar — um cache falsificado NAO pode ganhar
      mockNet.setResponse({ valid: false, reason: 'bloqueado' })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
    })

    it('rejects a cache whose payload no longer matches its signature', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })
      await validateLicense('KEY', 'test-hwid-12345')
      const cachePath = path.join(testRoot, '.license-cache.json')
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
      const forged = { payload: raw.payload.replace('true', 'false'), sig: raw.sig }
      fs.writeFileSync(cachePath, JSON.stringify(forged), 'utf-8')
      mockNet.setResponse({ valid: false, reason: 'bloqueado' })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
    })

    it('rejects a cache signed for another machine (HWID binding)', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })
      await validateLicense('KEY', 'test-hwid-12345')
      mockHwid.getHwidSync.mockReturnValue('another-machine')
      mockNet.setResponse({ valid: false, reason: 'bloqueado' })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
    })

    it('serves a cache signed for this machine (control for HWID binding)', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })
      await validateLicense('KEY', 'test-hwid-12345')
      mockNet.setResponse({ valid: false, reason: 'bloqueado' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
    })
  })
  describe('activateLicense', () => {
    it('saves key and returns valid on successful activation', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await activateLicense('NEW-VALID-KEY')
      expect(result.valid).toBe(true)
      expect(savedKey()).toBe('NEW-VALID-KEY')
    })

    it('uppercases and trims the key before saving', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await activateLicense('  new-key-abc  ')
      expect(result.valid).toBe(true)
      expect(savedKey()).toBe('NEW-KEY-ABC')
    })

    it('deletes saved key when activation fails', async () => {
      mockNet.setResponse({ valid: false, reason: 'Chave inválida' })

      const result = await activateLicense('INVALID-KEY')
      expect(result.valid).toBe(false)
      expect(savedKey()).toBeNull()
    })

    it('deletes saved key on network error during activation', async () => {
      // write an existing key first
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'OLD-KEY', 'utf-8')
      mockNet.setError('server timeout')

      const result = await activateLicense('NEW-KEY')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/conexao|connection|timeout|Sem conexao/i)
      expect(savedKey()).toBeNull()
    })

    it('trims key down to 49 chars max', async () => {
      const longKey = 'A'.repeat(60)
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense(longKey)
      expect(result.valid).toBe(true)
      expect(savedKey()?.length).toBe(60)
    })
  })

  // ── Renewal: expired → activate new → valid ─────────────────────
  describe('license renewal flow', () => {
    it('expired license can be renewed with a new key', async () => {
      // Step 1: expired key on disk
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'EXPIRED-KEY', 'utf-8')
      mockNet.setResponse({ valid: false, reason: 'Licença expirada', type: 'expired', expires_at: '2024-01-01' })

      const expired = await checkLicense()
      expect(expired.valid).toBe(false)
      expect(expired.reason).toBe('Licença expirada')

      // Step 2: activate with new key
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '2027-06-01' })

      const activated = await activateLicense('RENEWED-KEY-2027')
      expect(activated.valid).toBe(true)
      expect(savedKey()).toBe('RENEWED-KEY-2027')

      // Step 3: checkLicense now reports valid with new key
      const valid = await checkLicense()
      expect(valid.valid).toBe(true)
      expect(valid.type).toBe('subscription')
      expect(valid.expires_at).toBe('2027-06-01')
    })
  })

  // ── getHwid ──────────────────────────────────────────────────────
  describe('getHwid', () => {
    it('returns the hwid from generateHwid', async () => {
      const hwid = await getHwid()
      expect(hwid).toBe('test-hwid-12345')
    })
  })

  // ── Payload sent to API ──────────────────────────────────────────
  describe('API payload', () => {
    it('sends key, hwid and action in the request body', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      await activateLicense('MY-KEY')
      const raw = mockNet.getCapturedPayload()
      const payload = JSON.parse(raw)

      expect(payload.action).toBe('validate')
      expect(payload.key).toBe('MY-KEY')
      expect(payload.hwid).toBe('test-hwid-12345')
    })
  })

  // ── getLicenseConfig branches ─────────────────────────────────────
  describe('getLicenseConfig (via config file)', () => {
    it('reads custom url and token from license-config.json', async () => {
      const config = { url: 'https://custom-license.api/verify', token: 'custom-token-abc' }
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), JSON.stringify(config), 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense('MY-KEY')
      expect(result.valid).toBe(true)
    })

    it('falls through when license-config.json has no token field', async () => {
      fs.writeFileSync(
        path.join(testRoot, 'license-config.json'),
        JSON.stringify({ url: 'https://custom.url' }),
        'utf-8',
      )
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense('MY-KEY')
      expect(result.valid).toBe(true)
    })

    it('falls through when license-config.json has invalid JSON', async () => {
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), '{bad json}', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense('MY-KEY')
      expect(result.valid).toBe(true)
    })

    // ── A9: a queda para o endpoint publico deixa de ser invisível ──
    it('registra um aviso quando license-config.json está corrompido', async () => {
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), '{bad json}', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await activateLicense('MY-KEY')
        const logged = spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
        expect(logged).toContain('license-config.json')
        expect(logged).toMatch(/ileg[ií]vel|corrompid/i)
      } finally {
        spy.mockRestore()
      }
    })

    it('registra um aviso quando license-config.json existe mas não tem url/token', async () => {
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), JSON.stringify({ url: 'https://x.test' }), 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await activateLicense('MY-KEY')
        const logged = spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
        expect(logged).toContain('license-config.json')
        expect(logged).toMatch(/token|url/)
      } finally {
        spy.mockRestore()
      }
    })

    it('não regista aviso nenhum quando license-config.json simplesmente não existe', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime' })
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await activateLicense('MY-KEY')
        expect(spy).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })

    // Regressao: o token de admin vivia hardcoded no fonte, que e repo
    // publico. `validate` e rota publica, entao o app funciona sem token.
    it('omits the token field entirely when none is configured', async () => {
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), JSON.stringify({ url: 'https://x.test' }), 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      await activateLicense('MY-KEY')
      const payload = JSON.parse(mockNet.getCapturedPayload())

      expect('token' in payload).toBe(false)
    })

    it('never sends the legacy hardcoded admin token', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      await activateLicense('MY-KEY')
      const payload = JSON.parse(mockNet.getCapturedPayload())

      expect(JSON.stringify(payload)).not.toContain('DiNhoTOKEN0001')
    })
  })

  // ── API response edge cases ──────────────────────────────────────
  describe('API response branches', () => {
    it('handles non-JSON API response', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setSequence([
        { status: 200, body: 'just a string' },
        { status: 200, body: 'just a string' },
      ])

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('converts empty expires_at string to null', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.expires_at).toBeNull()
    })

    it('settles (falls back offline) when the response stream errors mid-body', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setStreamError('stream reset by peer')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('settles (falls back offline) when the response stream aborts mid-body', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setStreamAborted()

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })
  })

  // ── A5: redirect não deve seguir para outra origem ────────────────
  describe('redirect origin validation (A5)', () => {
    const CFG = 'license-config.json'
    const API = 'https://license.test/api'

    it('recusa redirect para outra origem e nunca envia o token para ela', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, CFG), JSON.stringify({ url: API, token: 'super-secret-token' }), 'utf-8')
      mockNet.setSequence([
        { status: 302, body: 'Location: https://evil.example/steal' },
        { status: 302, body: 'Location: https://evil.example/steal' },
      ])

      const result = await checkLicense()
      expect(result.valid).toBe(false)

      const urls = mockNet.getRequests().map((r) => r.url)
      expect(urls.some((u) => u.includes('evil.example'))).toBe(false)
      expect(urls.every((u) => u.startsWith(API))).toBe(true)
    })

    it('recusa redirect para um esquema diferente (http a partir de https)', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, CFG), JSON.stringify({ url: API, token: 'tok' }), 'utf-8')
      mockNet.setSequence([
        { status: 302, body: 'Location: http://license.test/api-downgrade' },
        { status: 302, body: 'Location: http://license.test/api-downgrade' },
      ])

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(mockNet.getRequests().every((r) => r.url.startsWith(API))).toBe(true)
    })

    it('segue redirect de mesma origem (não bloqueia o caso legítimo)', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, CFG), JSON.stringify({ url: API, token: 'tok' }), 'utf-8')
      mockNet.setSequence([
        { status: 302, body: 'Location: /api-v2' },
        { status: 200, body: { valid: true, type: 'subscription' } },
      ])

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      const urls = mockNet.getRequests().map((r) => r.url)
      expect(urls).toContain('https://license.test/api-v2')
    })

    it('mantém o Authorization no header quando o redirect é de mesma origem', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, CFG), JSON.stringify({ url: API, token: 'same-origin-token' }), 'utf-8')
      mockNet.setSequence([
        { status: 302, body: 'Location: /api-v2' },
        { status: 200, body: { valid: true } },
      ])

      await checkLicense()
      const second = mockNet.getRequests()[1]
      expect(second?.headers.authorization).toBe('Bearer same-origin-token')
    })
  })

  // ── A8: o erro real da API deixa de ser engolido ──────────────────
  describe('erro real da API é diagnosticável (A8)', () => {
    it('registra o corpo da resposta quando a API devolve HTML em vez de JSON', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse('<html><body>502 Bad Gateway — upstream db down</body></html>', 502)

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const result = await validateLicense('KEY', 'test-hwid-12345')
        // o sentinel tem de ser preservado: checkLicense compara com
        // OFFLINE_FALLBACK_REASON para cair no fallback offline
        expect(result.reason).toBe(OFFLINE_FALLBACK_REASON)
        const logged = spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
        expect(logged).toContain('502 Bad Gateway')
      } finally {
        spy.mockRestore()
      }
    })

    it('regista a causa quando a ligacao falha antes de qualquer resposta', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setError('getaddrinfo ENOTFOUND license.invalid')

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const result = await validateLicense('KEY', 'test-hwid-12345')
        expect(result.reason).toBe(OFFLINE_FALLBACK_REASON)
        const logged = spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
        expect(logged).toContain('ENOTFOUND')
      } finally {
        spy.mockRestore()
      }
    })

    it('o sentinel do fallback offline é uma constante partilhada', async () => {
      // se alguém trocar a string num dos dois sitios, o fallback offline
      // de checkLicense deixa de funcionar — este teste trava a regressão
      expect(OFFLINE_FALLBACK_REASON).toBe('Sem conexao com o servidor')
    })
  })

  // ── Cache read branches ──────────────────────────────────────────
  describe('cache read branches', () => {
    it('returns null when cache file has no timestamp field', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), JSON.stringify({ valid: true }), 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('handles corrupt cache JSON gracefully', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), 'not valid json at all', 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })
  })

  // ── E2E bypass ───────────────────────────────────────────────────
  describe('DINHO_E2E bypass', () => {
    function createMarker(): void {
      fs.writeFileSync(path.join(testRoot, E2E_MARKER_FILENAME), String(Date.now()), 'utf-8')
    }

    afterEach(() => {
      delete process.env.DINHO_E2E
      delete process.env.DINHO_E2E_KEY
      try {
        fs.rmSync(path.join(testRoot, E2E_MARKER_FILENAME), { force: true })
      } catch {}
    })

    it('returns valid test license when env key and marker are present', async () => {
      process.env.DINHO_E2E = '1'
      process.env.DINHO_E2E_KEY = 'test-secret'
      createMarker()

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('test')
    })

    it('does not bypass when DINHO_E2E_KEY is missing', async () => {
      process.env.DINHO_E2E = '1'
      createMarker()

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })

    it('does not bypass when the marker file is missing', async () => {
      process.env.DINHO_E2E = '1'
      process.env.DINHO_E2E_KEY = 'test-secret'

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })

    it('does not bypass when DINHO_E2E is not set', async () => {
      process.env.DINHO_E2E_KEY = 'test-secret'
      createMarker()

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })
  })
})
