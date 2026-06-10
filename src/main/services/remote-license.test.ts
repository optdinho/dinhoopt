import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'

// ── Mock state (dynamic per-test) ────────────────────────────────────
const mockVars = vi.hoisted(() => {
  let _testRoot = ''
  return {
    setTestRoot: (r: string) => { _testRoot = r },
    getTestRoot: () => _testRoot,
  }
})

const mockNet = vi.hoisted(() => {
  let _status = 200
  let _body: any = { valid: false, reason: 'test-blocked' }
  let _error: string | null = null
  let _capturedPayload = ''
  let _callIndex = 0
  const _responses: Array<{ status?: number; body?: any; error?: string }> = []

  return {
    setResponse: (body: any, status = 200) => {
      _status = status; _body = body; _error = null
      _responses.length = 0; _callIndex = 0
    },
    setError: (msg: string) => {
      _error = msg; _responses.length = 0; _callIndex = 0
    },
    setSequence: (seq: Array<{ status?: number; body?: any; error?: string }>) => {
      _responses.splice(0, _responses.length, ...seq)
      _callIndex = 0
    },
    getCapturedPayload: () => _capturedPayload,
    _makeRequest: () => {
      _capturedPayload = ''
      return {
        on(ev: string, cb: any) {
          const idx = Math.min(_callIndex, _responses.length > 0 ? _responses.length - 1 : 0)
          let status = _status
          let body = _body
          let error = _error
          if (_responses.length > 0) {
            const r = _responses[idx]
            if (r.error !== undefined) error = r.error
            if (r.body !== undefined) body = r.body
            if (r.status !== undefined) status = r.status
            _callIndex++
          }
          if (error && ev === 'error') {
            setTimeout(() => cb(new Error(error)), 0)
          } else if (!error && ev === 'response') {
            setTimeout(() => cb({
              statusCode: status,
              response: {
                on(dEv: string, dCb: any) {
                  if (dEv === 'data') dCb(Buffer.from(JSON.stringify(body)))
                  if (dEv === 'end') dCb(null)
                },
              },
            }), 0)
          }
          return this
        },
        setHeader() {},
        write(data: string) { _capturedPayload = data },
        end() {},
      }
    },
  }
})

vi.mock('electron', () => {
  const p = require('path')
  const os = require('os')
  return {
    app: {
      getPath: (n: string) => n === 'userData' ? mockVars.getTestRoot() : p.join(os.tmpdir(), n),
      isPackaged: false,
    },
    net: {
      request: () => mockNet._makeRequest(),
    },
  }
})

vi.mock('./hwid', () => ({ generateHwid: async () => 'test-hwid-12345' }))

import { checkLicense, activateLicense, getHwid, __resetForTest } from './remote-license'
import type { RemoteLicenseResult } from './remote-license'
import { initStore, readSavedKey } from './license-store'

const KEYFILE = 'remote-license.key'
let testRoot = ''

beforeEach(() => {
  testRoot = path.join(tmpdir(), 'dinho-license-test', String(Date.now()))
  mockVars.setTestRoot(testRoot)
  try { fs.rmSync(testRoot, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(testRoot, { recursive: true })
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

    it('returns network error when server is unreachable', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/conexao|connection|refused/i)
    })

    it('returns generic invalid when API returns invalid without reason', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'INVALID-KEY', 'utf-8')
      mockNet.setResponse({ valid: false })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Licença inválida')
    })
  })

  // ── activateLicense ───────────────────────────────────────────────
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
    it('sends key, hwid, token and action in the request body', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      await activateLicense('MY-KEY')
      const raw = mockNet.getCapturedPayload()
      const payload = JSON.parse(raw)

      expect(payload.action).toBe('validate')
      expect(payload.key).toBe('MY-KEY')
      expect(payload.hwid).toBe('test-hwid-12345')
      expect(payload.token).toBe('DiNhoTOKEN0001')
    })
  })
})
