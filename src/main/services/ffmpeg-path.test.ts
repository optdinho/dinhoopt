import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { getFfmpegPath, resolveFfmpegOrNull } from './ffmpeg-path'

const execFileSyncMock = vi.mocked(execFileSync)
const existsSyncMock = vi.mocked(existsSync)

describe('ffmpeg-path', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    existsSyncMock.mockReturnValue(true)
    delete process.env.PATH
    delete process.env.ProgramFiles
    delete process.env['ProgramFiles(x86)']
    delete process.env.LOCALAPPDATA
    process.env.PATH = 'C:\\tools\\ffmpeg\\bin;D:\\other'
  })

  describe('resolveFfmpegOrNull', () => {
    it('returns null when ffmpeg is not found anywhere', () => {
      existsSyncMock.mockReturnValue(false)
      expect(resolveFfmpegOrNull()).toBeNull()
      expect(execFileSyncMock).toHaveBeenCalledWith('where.exe', ['ffmpeg'], { encoding: 'utf-8', timeout: 3000 })
    })

    it('finds ffmpeg via PATH', () => {
      existsSyncMock.mockImplementation((p: unknown) => p === 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
      expect(resolveFfmpegOrNull()).toBe('C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
      expect(execFileSyncMock).not.toHaveBeenCalled()
    })

    it('checks PATH before common dirs', () => {
      existsSyncMock.mockImplementation((p: unknown) => p === 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
      process.env.ProgramFiles = 'C:\\Program Files'
      expect(resolveFfmpegOrNull()).toBe('C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
    })

    it('falls back to common install dirs when not in PATH', () => {
      process.env.ProgramFiles = 'C:\\Program Files'
      existsSyncMock.mockImplementation(
        (p: unknown) => p === 'C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe',
      )
      expect(resolveFfmpegOrNull()).toBe('C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe')
    })

    it('finds both candidates in a dir', () => {
      process.env.ProgramFiles = 'C:\\Program Files'
      existsSyncMock.mockImplementation(
        (p: unknown) => p === 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg',
      )
      expect(resolveFfmpegOrNull()).toBe('C:\\Program Files\\ffmpeg\\bin\\ffmpeg')
    })

    it('falls back to where.exe output', () => {
      existsSyncMock.mockReturnValue(false)
      execFileSyncMock.mockReturnValue('C:\\ffmpeg\\bin\\ffmpeg.exe\r\nC:\\other\\ffmpeg.exe')
      expect(resolveFfmpegOrNull()).toBe('C:\\ffmpeg\\bin\\ffmpeg.exe')
    })

    it('returns null when where.exe throws', () => {
      existsSyncMock.mockReturnValue(false)
      execFileSyncMock.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      expect(resolveFfmpegOrNull()).toBeNull()
    })

    it('caches the resolved path', () => {
      existsSyncMock.mockImplementation((p: unknown) => p === 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
      const first = resolveFfmpegOrNull()
      expect(resolveFfmpegOrNull()).toBe(first)
      expect(execFileSyncMock).not.toHaveBeenCalled()
    })

    it('re-resolves when the cached path no longer exists', () => {
      existsSyncMock.mockImplementation((p: unknown) => p === 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
      resolveFfmpegOrNull()
      existsSyncMock.mockReturnValue(false)
      execFileSyncMock.mockReturnValue('C:\\new\\ffmpeg.exe')
      expect(resolveFfmpegOrNull()).toBe('C:\\new\\ffmpeg.exe')
    })
  })

  describe('getFfmpegPath', () => {
    it('returns the resolved path when found', () => {
      existsSyncMock.mockImplementation((p: unknown) => p === 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
      expect(getFfmpegPath()).toBe('C:\\tools\\ffmpeg\\bin\\ffmpeg.exe')
    })

    it('falls back to "ffmpeg" when not found', () => {
      existsSyncMock.mockReturnValue(false)
      expect(getFfmpegPath()).toBe('ffmpeg')
    })
  })
})
