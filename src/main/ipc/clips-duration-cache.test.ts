import { beforeEach, describe, expect, it, vi } from 'vitest'

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void

const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...a: unknown[]) => execFileMock(...a),
}))

let mod: typeof import('./clips-duration-cache')

async function load(): Promise<void> {
  mod = await import('./clips-duration-cache')
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  await load()
})

function mockDurationLine(duration: string): void {
  execFileMock.mockImplementation((_c: unknown, _a: unknown, _o: unknown, cb: ExecCb) =>
    cb(null, '', `  Duration: ${duration}, start: 0.000000, bitrate: 1000 kb/s`),
  )
}

function mockNoDuration(): void {
  execFileMock.mockImplementation((_c: unknown, _a: unknown, _o: unknown, cb: ExecCb) => cb(null, '', ''))
}

function mockExecError(): void {
  execFileMock.mockImplementation((_c: unknown, _a: unknown, _o: unknown, cb: ExecCb) =>
    cb(new Error('spawn ENOENT'), '', ''),
  )
}

describe('getVideoDuration', () => {
  it('parses a full duration into whole seconds', async () => {
    mockDurationLine('00:01:23.500')
    await expect(mod.getVideoDuration('C:\\clips\\a.mp4')).resolves.toBe(84)
    expect(execFileMock).toHaveBeenCalledWith(
      'ffmpeg',
      ['-i', 'C:\\clips\\a.mp4', '-f', 'null', '-'],
      { encoding: 'utf-8', timeout: 5000, windowsHide: true },
      expect.any(Function),
    )
  })

  it('parses a single-digit centiseconds value', async () => {
    mockDurationLine('00:00:10.5')
    await expect(mod.getVideoDuration('a.mp4')).resolves.toBe(11)
  })

  it('returns 0 when duration line is missing', async () => {
    mockNoDuration()
    await expect(mod.getVideoDuration('a.mp4')).resolves.toBe(0)
  })

  it('returns 0 when execFile rejects with an error and no stderr', async () => {
    mockExecError()
    await expect(mod.getVideoDuration('a.mp4')).resolves.toBe(0)
  })

  it('resolves with stderr even when err is set but stderr is present', async () => {
    execFileMock.mockImplementation((_c: unknown, _a: unknown, _o: unknown, cb: ExecCb) =>
      cb(new Error('exit 1'), '', '  Duration: 00:00:05.000'),
    )
    await expect(mod.getVideoDuration('a.mp4')).resolves.toBe(5)
  })
})

describe('getDurationsForClips', () => {
  it('returns cached values without invoking ffmpeg for unchanged mtimes', async () => {
    mockDurationLine('00:00:30.000')
    await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 100 }])
    expect(execFileMock).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    const result = await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 100 }])
    expect(result.get('a.mp4')).toBe(30)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('recomputes when the mtime changes', async () => {
    mockDurationLine('00:00:30.000')
    await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 100 }])
    mockDurationLine('00:00:45.000')
    const result = await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 200 }])
    expect(result.get('a.mp4')).toBe(45)
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('computes missing clips with concurrency and returns a full map', async () => {
    mockDurationLine('00:00:10.000')
    const clips = [
      { path: 'a.mp4', mtimeMs: 1 },
      { path: 'b.mp4', mtimeMs: 2 },
      { path: 'c.mp4', mtimeMs: 3 },
    ]
    const result = await mod.getDurationsForClips(clips)
    expect(result.size).toBe(3)
    for (const c of clips) expect(result.get(c.path)).toBe(10)
    expect(execFileMock).toHaveBeenCalledTimes(3)
  })

  it('returns empty map for an empty input', async () => {
    const result = await mod.getDurationsForClips([])
    expect(result.size).toBe(0)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('keeps cached values while only computing missing ones in a mixed batch', async () => {
    mockDurationLine('00:00:10.000')
    await mod.getDurationsForClips([{ path: 'cached.mp4', mtimeMs: 7 }])
    vi.clearAllMocks()
    mockDurationLine('00:00:20.000')
    const result = await mod.getDurationsForClips([
      { path: 'cached.mp4', mtimeMs: 7 },
      { path: 'fresh.mp4', mtimeMs: 8 },
    ])
    expect(result.get('cached.mp4')).toBe(10)
    expect(result.get('fresh.mp4')).toBe(20)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('still records entries when ffmpeg fails to produce a duration', async () => {
    mockExecError()
    const result = await mod.getDurationsForClips([{ path: 'bad.mp4', mtimeMs: 1 }])
    expect(result.get('bad.mp4')).toBe(0)
  })
})

describe('invalidateDurationCache', () => {
  it('clears a single entry', async () => {
    mockDurationLine('00:00:10.000')
    await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 1 }])
    mod.invalidateDurationCache('a.mp4')
    vi.clearAllMocks()
    mockDurationLine('00:00:50.000')
    const result = await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 1 }])
    expect(result.get('a.mp4')).toBe(50)
  })

  it('clears the whole cache when no path given', async () => {
    mockDurationLine('00:00:10.000')
    await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 1 }])
    mod.invalidateDurationCache()
    vi.clearAllMocks()
    mockDurationLine('00:00:50.000')
    const result = await mod.getDurationsForClips([{ path: 'a.mp4', mtimeMs: 1 }])
    expect(result.get('a.mp4')).toBe(50)
  })

  it('ignores an unknown path', async () => {
    mod.invalidateDurationCache('nope.mp4')
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
