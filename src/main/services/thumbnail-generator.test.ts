import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => { throw new Error('not found') }),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

const execFileAsync = vi.mocked(execFile)
const execFileSyncMock = vi.mocked(execFileSync)

describe('thumbnail-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
  })

  describe('hasFfmpeg', () => {
    it('returns false when ffmpeg is not found', async () => {
      const { hasFfmpeg } = await import('./thumbnail-generator')
      expect(hasFfmpeg()).toBe(false)
    })

    it('returns true when ffmpeg is found via PATH', async () => {
      execFileSyncMock.mockReturnValueOnce('C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n')
      vi.resetModules()
      const mod = await import('./thumbnail-generator')
      expect(mod.hasFfmpeg()).toBe(true)
    })

    it('falls back to dir scan when PATH resolve fails', async () => {
      vi.mocked(existsSync).mockImplementation((p: string) => p.includes('ffmpeg\\bin\\ffmpeg.exe'))
      vi.resetModules()
      const mod = await import('./thumbnail-generator')
      expect(mod.hasFfmpeg()).toBe(true)
    })
  })

  describe('getCachedThumbnailPath', () => {
    it('returns null when no cached thumbnail exists', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const mod = await import('./thumbnail-generator')
      const result = mod.getCachedThumbnailPath('C:\\clips', 'test.mp4')
      expect(result).toBeNull()
    })

    it('returns path when cached thumbnail exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const mod = await import('./thumbnail-generator')
      const result = mod.getCachedThumbnailPath('C:\\clips', 'test.mp4')
      expect(result).toContain('.thumbnails\\test.jpg')
    })
  })

  describe('generateThumbnail', () => {
    it('returns null when ffmpeg is not available', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const { generateThumbnail } = await import('./thumbnail-generator')
      const result = await generateThumbnail('C:\\clips', 'test.mp4')
      expect(result).toBeNull()
    })

    it('returns null when video file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const { generateThumbnail } = await import('./thumbnail-generator')
      const result = await generateThumbnail('C:\\clips', 'test.mp4')
      expect(result).toBeNull()
    })
  })

  describe('readThumbnailDataUrl', () => {
    it('returns data URL from thumbnail file', async () => {
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake-jpeg-data'))
      const { readThumbnailDataUrl } = await import('./thumbnail-generator')
      const result = readThumbnailDataUrl('C:\\clips\\.thumbnails\\test.jpg')
      expect(result).toBe('data:image/jpeg;base64,ZmFrZS1qcGVnLWRhdGE=')
    })

    it('returns null when reading fails', async () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('read error') })
      const { readThumbnailDataUrl } = await import('./thumbnail-generator')
      const result = readThumbnailDataUrl('C:\\clips\\.thumbnails\\test.jpg')
      expect(result).toBeNull()
    })
  })

  describe('getThumbnailDataUrl', () => {
    it('reads cached thumbnail when available', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('cached-data'))
      const { getThumbnailDataUrl } = await import('./thumbnail-generator')
      const result = await getThumbnailDataUrl('C:\\clips', 'test.mp4')
      expect(result).toBe('data:image/jpeg;base64,Y2FjaGVkLWRhdGE=')
      expect(execFile).not.toHaveBeenCalled()
    })
  })
})
