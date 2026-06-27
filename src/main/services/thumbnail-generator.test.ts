import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    throw new Error('not found')
  }),
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
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'

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
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('read error')
      })
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

describe('generateThumbnail full flow', () => {
  const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
  })

  it('generates thumbnail when ffmpeg and video exist', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 1000 })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'Duration: 00:00:30.00, start: 0.000000, bitrate: 1000 kb/s\n' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test.mp4')
    expect(result).toBe('C:\\clips\\.thumbnails\\test.jpg')
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(execFile).mock.calls[1][0]).toContain('ffmpeg')
    expect(mkdirSync).toHaveBeenCalledWith('C:\\clips\\.thumbnails', { recursive: true })
  })

  it('uses ffmpeg duration to calculate seek position', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 1000 })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'Duration: 00:01:40.00, start: 0.000000, bitrate: 1000 kb/s\n' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test.mp4')
    expect(result).toBe('C:\\clips\\.thumbnails\\test.jpg')
    expect(execFile).toHaveBeenCalledTimes(2)
    const ffmpegArgs = vi.mocked(execFile).mock.calls[1][1] as string[]
    expect(ffmpegArgs).toContain('25')
  })

  it('caps ffmpeg seek at 60 seconds for long videos', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test_long.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test_long.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 1000 })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'Duration: 00:05:00.00, start: 0.000000, bitrate: 1000 kb/s\n' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test_long.mp4')
    expect(result).toBe('C:\\clips\\.thumbnails\\test_long.jpg')
    const ffmpegArgs = vi.mocked(execFile).mock.calls[1][1] as string[]
    expect(ffmpegArgs).toContain('60')
  })

  it('falls back to default seek when ffmpeg output has no Duration', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 1000 })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'ffmpeg version ... no Duration line here' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test.mp4')
    expect(result).toBe('C:\\clips\\.thumbnails\\test.jpg')
    const ffmpegArgs = vi.mocked(execFile).mock.calls[1][1] as string[]
    expect(ffmpegArgs).toContain('5')
  })

  it('falls back to default seek when ffmpeg returns 0 duration', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 1000 })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'Duration: 00:00:00.00, start: 0.000000, bitrate: 0 kb/s\n' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test.mp4')
    expect(result).toBe('C:\\clips\\.thumbnails\\test.jpg')
    const ffmpegArgs = vi.mocked(execFile).mock.calls[1][1] as string[]
    expect(ffmpegArgs).toContain('5')
  })

  it('returns null when thumbnail output file is empty', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 0 })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'Duration: 00:00:30.00, start: 0.000000, bitrate: 1000 kb/s\n' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test.mp4')
    expect(result).toBeNull()
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('returns null when ffmpeg execFile fails (catch block)', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      return false
    })
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function
      cb(new Error('ffmpeg crashed'))
    })
    const { generateThumbnail } = await import('./thumbnail-generator')
    const result = await generateThumbnail('C:\\clips', 'test.mp4')
    expect(result).toBeNull()
  })
})

describe('getThumbnailDataUrl full flow', () => {
  const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(false)
  })

  it('generates thumbnail and returns data URL when no cache exists', async () => {
    vi.resetModules()
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'where.exe' && args[0] === 'ffmpeg') return 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe\n'
      throw new Error('not found')
    })
    let ffmpegRan = false
    vi.mocked(existsSync).mockImplementation((p: string) => {
      if (p === 'C:\\clips\\test.mp4') return true
      if (p.includes('.thumbnails') && p.includes('test.jpg')) return ffmpegRan
      return false
    })
    vi.mocked(statSync).mockReturnValue({ size: 1000 })
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('thumbnail-data'))
    execFileMock.mockImplementation((...args: unknown[]) => {
      const procArgs = args[1] as string[]
      const cb = args[args.length - 1] as Function
      if (procArgs.includes('-f')) {
        cb(null, { stdout: '', stderr: 'Duration: 00:00:30.00, start: 0.000000, bitrate: 1000 kb/s\n' })
      } else {
        ffmpegRan = true
        cb(null, { stdout: '', stderr: '' })
      }
    })
    const { getThumbnailDataUrl } = await import('./thumbnail-generator')
    const result = await getThumbnailDataUrl('C:\\clips', 'test.mp4')
    expect(result).toBe('data:image/jpeg;base64,dGh1bWJuYWlsLWRhdGE=')
    expect(execFile).toHaveBeenCalledTimes(2)
  })
})
