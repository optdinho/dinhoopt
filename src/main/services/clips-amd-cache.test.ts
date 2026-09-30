import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
    isPackaged: false,
  },
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loadAmdGpuCache, rememberAmdDetection, resolveAmdAvailable } from './clips-amd-cache'

describe('clips-amd-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
  })

  describe('loadAmdGpuCache', () => {
    it('returns false when no cache file exists', () => {
      expect(loadAmdGpuCache()).toBe(false)
    })

    it('returns true when the cache file records an AMD GPU', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ amdDetected: true }))
      expect(loadAmdGpuCache()).toBe(true)
    })

    it('returns false when the cache file records a non-AMD GPU', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ amdDetected: false }))
      expect(loadAmdGpuCache()).toBe(false)
    })

    it('returns false on corrupt JSON instead of throwing', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('not-json')
      expect(loadAmdGpuCache()).toBe(false)
    })

    it('returns false when amdDetected is not a boolean', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ amdDetected: 'yes' }))
      expect(loadAmdGpuCache()).toBe(false)
    })
  })

  describe('rememberAmdDetection', () => {
    it('persists a positive detection so it survives app restarts', () => {
      rememberAmdDetection(true)
      expect(writeFileSync).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string)
      expect(payload.amdDetected).toBe(true)
    })

    it('persists a negative detection', () => {
      rememberAmdDetection(false)
      const payload = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string)
      expect(payload.amdDetected).toBe(false)
    })

    it('never throws when the write fails', () => {
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('EACCES')
      })
      expect(() => rememberAmdDetection(true)).not.toThrow()
    })
  })

  describe('resolveAmdAvailable', () => {
    it('prefers the in-memory flag when it is already true', () => {
      expect(resolveAmdAvailable(true)).toBe(true)
      expect(readFileSync).not.toHaveBeenCalled()
    })

    it('falls back to the persisted cache when the in-memory flag is unknown', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ amdDetected: true }))
      expect(resolveAmdAvailable(null)).toBe(true)
    })

    it('returns false when the in-memory flag is false and the cache is empty', () => {
      expect(resolveAmdAvailable(false)).toBe(false)
    })

    it('falls back to the cache when the in-memory flag is false but the cache says AMD', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ amdDetected: true }))
      expect(resolveAmdAvailable(false)).toBe(true)
    })
  })
})
