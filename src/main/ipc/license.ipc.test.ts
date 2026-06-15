import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────

const handleMap = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, handler)
    }),
  },
}))

vi.mock('@shared/channels', () => ({
  IPC: {
    LICENSE_ACTIVATE: 'license:activate',
    LICENSE_STATUS: 'license:status',
    LICENSE_GET_HWID: 'license:get-hwid',
  },
}))

const mockActivateLicense = vi.fn()
const mockCheckLicense = vi.fn()
const mockGetHwid = vi.fn()

vi.mock('../services/remote-license', () => ({
  activateLicense: (...args: unknown[]) => mockActivateLicense(...args),
  checkLicense: (...args: unknown[]) => mockCheckLicense(...args),
  getHwid: (...args: unknown[]) => mockGetHwid(...args),
}))

import { registerLicenseIpc } from './license.ipc'

// ── Helpers ──────────────────────────────────────────────────────────

function invoke(channel: string, ...args: unknown[]) {
  const handler = handleMap.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  return handler({} as any, ...args)
}

// ── Tests ────────────────────────────────────────────────────────────

describe('license IPC', () => {
  beforeEach(() => {
    handleMap.clear()
    vi.clearAllMocks()
  })

  it('registers LICENSE_ACTIVATE handler', () => {
    registerLicenseIpc()
    expect(handleMap.has('license:activate')).toBe(true)
  })

  it('registers LICENSE_STATUS handler', () => {
    registerLicenseIpc()
    expect(handleMap.has('license:status')).toBe(true)
  })

  it('registers LICENSE_GET_HWID handler', () => {
    registerLicenseIpc()
    expect(handleMap.has('license:get-hwid')).toBe(true)
  })

  // ── LICENSE_ACTIVATE ──────────────────────────────────────────

  describe('LICENSE_ACTIVATE', () => {
    it('returns error for empty key', async () => {
      registerLicenseIpc()
      const result = await invoke('license:activate', '')
      expect(result).toEqual({ valid: false, reason: 'Chave inválida' })
      expect(mockActivateLicense).not.toHaveBeenCalled()
    })

    it('returns error for whitespace-only key', async () => {
      registerLicenseIpc()
      const result = await invoke('license:activate', '   ')
      expect(result).toEqual({ valid: false, reason: 'Chave inválida' })
      expect(mockActivateLicense).not.toHaveBeenCalled()
    })

    it('returns error for key longer than 49 chars', async () => {
      registerLicenseIpc()
      const longKey = 'A'.repeat(50)
      const result = await invoke('license:activate', longKey)
      expect(result).toEqual({ valid: false, reason: 'Chave muito longa' })
      expect(mockActivateLicense).not.toHaveBeenCalled()
    })

    it('accepts key of exactly 49 chars', async () => {
      mockActivateLicense.mockResolvedValue({ valid: true, type: 'lifetime' })
      registerLicenseIpc()
      const maxKey = 'A'.repeat(49)
      await invoke('license:activate', maxKey)
      expect(mockActivateLicense).toHaveBeenCalledWith(maxKey)
    })

    it('rejects non-string key', async () => {
      registerLicenseIpc()
      const result = await invoke('license:activate', 12345)
      expect(result).toEqual({ valid: false, reason: 'Chave inválida' })
      expect(mockActivateLicense).not.toHaveBeenCalled()
    })

    it('delegates to activateLicense and returns its result', async () => {
      const expected = { valid: true, type: 'lifetime', expires_at: null }
      mockActivateLicense.mockResolvedValue(expected)
      registerLicenseIpc()

      const result = await invoke('license:activate', 'VALID-KEY')
      expect(result).toEqual(expected)
      expect(mockActivateLicense).toHaveBeenCalledWith('VALID-KEY')
    })

    it('propagates error from activateLicense', async () => {
      mockActivateLicense.mockRejectedValue(new Error('activation failed'))
      registerLicenseIpc()

      await expect(invoke('license:activate', 'KEY')).rejects.toThrow('activation failed')
    })
  })

  // ── LICENSE_STATUS ────────────────────────────────────────────

  describe('LICENSE_STATUS', () => {
    it('returns result from checkLicense', async () => {
      const expected = { valid: true, type: 'lifetime', expires_at: null }
      mockCheckLicense.mockResolvedValue(expected)
      registerLicenseIpc()

      const result = await invoke('license:status')
      expect(result).toEqual(expected)
      expect(mockCheckLicense).toHaveBeenCalledOnce()
    })

    it('propagates error from checkLicense', async () => {
      mockCheckLicense.mockRejectedValue(new Error('status check failed'))
      registerLicenseIpc()

      await expect(invoke('license:status')).rejects.toThrow('status check failed')
    })
  })

  // ── LICENSE_GET_HWID ──────────────────────────────────────────

  describe('LICENSE_GET_HWID', () => {
    it('returns hwid from getHwid', async () => {
      mockGetHwid.mockResolvedValue('abc123')
      registerLicenseIpc()

      const result = await invoke('license:get-hwid')
      expect(result).toBe('abc123')
      expect(mockGetHwid).toHaveBeenCalledOnce()
    })

    it('propagates error from getHwid', async () => {
      mockGetHwid.mockRejectedValue(new Error('hwid error'))
      registerLicenseIpc()

      await expect(invoke('license:get-hwid')).rejects.toThrow('hwid error')
    })
  })
})
