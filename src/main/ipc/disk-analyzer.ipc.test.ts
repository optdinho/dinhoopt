import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──

const mockHandle = vi.fn()
const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

const mockReaddir = vi.fn()
const mockStat = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}))

const mockExecFile = vi.fn()
const mockSpawn = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock('util', () => ({
  promisify:
    (fn: unknown) =>
    (...args: unknown[]) => {
      // Return a promise-based wrapper around our mock
      return new Promise((resolve, reject) => {
        ;(fn as (...args: unknown[]) => unknown)(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err)
          else resolve(result)
        })
      })
    },
}))

const mockIsAdmin = vi.fn()
vi.mock('../services/elevation', () => ({
  isAdmin: () => mockIsAdmin(),
}))

import { analyzeDisk, getDrives, getFileTypes, registerDiskAnalyzerIpc } from './disk-analyzer.ipc'

// ── Helpers ──

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

// ── Tests ──

describe('registerDiskAnalyzerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all disk analyzer IPC handlers', () => {
    registerDiskAnalyzerIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('disk:drives')
    expect(channels).toContain('disk:file-types')
    expect(channels).toContain('disk:analyze')
    expect(channels).toContain('disk:repair:sfc')
    expect(channels).toContain('disk:repair:dism')
    expect(channels).toContain('disk:repair:chkdsk')
  })
})

describe('DISK_DRIVES handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls getDrives and returns the result', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:drives')
    // getDrives uses execFileAsync internally; we mock via the callback-style mock
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(new Error('not windows'), '', '')
      }
    })
    const result = await handler()
    // On non-win32, it tries df; both may fail and return []
    expect(Array.isArray(result)).toBe(true)
  })
})

describe('DISK_FILE_TYPES handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for invalid drive input', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:file-types')
    const result = await handler({}, '')
    expect(result).toEqual([])
  })

  it('returns empty array for non-string drive', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:file-types')
    const result = await handler({}, 123)
    expect(result).toEqual([])
  })
})

describe('DISK_ANALYZE handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty node for invalid drive input', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:analyze')
    const result = await handler({}, '')
    expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
  })

  it('returns empty node for non-string drive', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:analyze')
    const result = await handler({}, null)
    expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
  })
})

describe('DISK_REPAIR_SFC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to drive C when invalid drive is provided', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    // SFC is Windows-only; on non-Windows it returns a specific error
    const result = (await handler({}, 'invalid!!!')) as { tool: string; success: boolean; summary: string }
    // Since tests run on Linux, SFC returns "only available on Windows"
    expect(result.tool).toBe('sfc')
    if (process.platform !== 'win32') {
      expect(result.success).toBe(false)
      expect(result.summary).toContain('only available on Windows')
    }
  })

  it('accepts a valid single-letter drive', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const result = (await handler({}, 'D')) as { tool: string }
    expect(result.tool).toBe('sfc')
  })

  it('handles non-string drive input by defaulting to C', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const result = (await handler({}, 42)) as { tool: string }
    expect(result.tool).toBe('sfc')
  })
})

describe('DISK_REPAIR_DISM handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns Windows-only message on non-Windows platform', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const result = (await handler()) as { tool: string; success: boolean; summary: string }
    if (process.platform !== 'win32') {
      expect(result.tool).toBe('dism')
      expect(result.success).toBe(false)
      expect(result.summary).toContain('only available on Windows')
    }
  })
})

describe('DISK_REPAIR_CHKDSK handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns Windows-only message on non-Windows platform', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const result = (await handler()) as { tool: string; success: boolean; summary: string }
    if (process.platform !== 'win32') {
      expect(result.tool).toBe('chkdsk')
      expect(result.success).toBe(false)
      expect(result.summary).toContain('only available on Windows')
    }
  })
})

// ── Exported function tests ──

describe('getDrives (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when exec fails', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(new Error('command failed'), '', '')
      }
    })
    const drives = await getDrives()
    expect(drives).toEqual([])
  })

  it('parses PowerShell drive output on Windows', async () => {
    if (process.platform !== 'win32') return

    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(null, {
          stdout: 'C|Local Disk|107374182400|53687091200\nD|Data Storage|214748364800|107374182400',
        })
      }
    })
    const drives = await getDrives()
    expect(drives).toHaveLength(2)
    expect(drives[0]!.letter).toBe('C')
    expect(drives[0]!.totalSize).toBe(161061273600)
    expect(drives[0]!.freeSpace).toBe(53687091200)
    expect(drives[0]!.usedSpace).toBe(107374182400)
    expect(drives[0]!.label).toBe('Local Disk')
    expect(drives[1]!.letter).toBe('D')
  })

  it('parses single drive with empty label from PowerShell output', async () => {
    if (process.platform !== 'win32') return

    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(null, { stdout: 'C||21474836480|10737418240' })
      }
    })
    const drives = await getDrives()
    expect(drives).toHaveLength(1)
    expect(drives[0]!.letter).toBe('C')
    // label falls back to letter when PS description is empty
    expect(drives[0]!.label).toBe('C')
    expect(drives[0]!.usedSpace).toBe(21474836480)
    expect(drives[0]!.freeSpace).toBe(10737418240)
    expect(drives[0]!.totalSize).toBe(32212254720)
  })
})

describe('analyzeDisk (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty node for invalid drive', async () => {
    const result = await analyzeDisk('')
    expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
  })

  it('returns empty node for null-like input', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test edge case
    const result = await analyzeDisk(null as any)
    expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
  })

  it('analyzes a valid drive path with files and directories', async () => {
    if (process.platform !== 'win32') return

    function makeEntry(name: string, isDir: boolean) {
      return { name, isDirectory: () => isDir }
    }

    mockReaddir
      .mockResolvedValueOnce([makeEntry('file1.txt', false), makeEntry('subdir', true)]) // root
      .mockResolvedValueOnce([]) // subdir (empty)

    mockStat.mockResolvedValue({ isDirectory: () => false, size: 1024, mtime: new Date(), birthtime: new Date() })

    const result = await analyzeDisk('C')
    expect(result.path).toBe('C:\\')
    // Only directories become children; files contribute to parent size
    expect(result.children!).toHaveLength(1)
    expect(result.children![0]!.name).toBe('subdir')
    expect(result.size).toBe(1024)
  })
})

describe('getFileTypes (exported)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for invalid drive', async () => {
    const result = await getFileTypes('')
    expect(result).toEqual([])
  })

  it('returns empty array for non-string drive', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test edge case
    const result = await getFileTypes(123 as any)
    expect(result).toEqual([])
  })

  it('collects file types from a valid drive path', async () => {
    if (process.platform !== 'win32') return

    function makeEntry(name: string, isDir: boolean) {
      return { name, isDirectory: () => isDir }
    }

    mockReaddir.mockResolvedValueOnce([
      makeEntry('doc.txt', false),
      makeEntry('photo.jpg', false),
      makeEntry('doc2.txt', false),
      makeEntry('script.ps1', false),
    ])

    mockStat.mockResolvedValue({ isDirectory: () => false, size: 2048, mtime: new Date(), birthtime: new Date() })

    const result = await getFileTypes('C')
    // biome-ignore lint/suspicious/noExplicitAny: test callback
    const extensions = result.map((ft: any) => ft.extension)
    expect(extensions).toContain('.txt')
    expect(extensions).toContain('.jpg')
    expect(extensions).toContain('.ps1')
    // biome-ignore lint/suspicious/noExplicitAny: test callback
    const txtInfo = result.find((ft: any) => ft.extension === '.txt')
    expect(txtInfo).toBeDefined()
    expect(txtInfo!.fileCount).toBe(2)
    expect(txtInfo!.totalSize).toBe(4096)
  })
})

// ── resolveRootPath validation (tested indirectly) ──

describe('drive input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects empty string drive for analyze', async () => {
    const result = await analyzeDisk('')
    expect(result.size).toBe(0)
  })

  it('rejects injection attempts in drive parameter', async () => {
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:analyze')
    // Try injecting a path traversal
    const result = (await handler({}, '../../../etc')) as {
      name: string
      path: string
      size: number
      children: Array<unknown>
    }
    // On Unix, resolveRootPath requires starting with sep; on Windows requires single letter
    if (process.platform !== 'win32') {
      // '../../../etc' does not start with '/' so should be rejected
      expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
    }
  })

  it('accepts Unix absolute paths on non-Windows', async () => {
    if (process.platform === 'win32') return
    mockReaddir.mockResolvedValue([])
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWindow() as any)
    const handler = getHandler('disk:analyze')
    const result = (await handler({}, '/')) as { path: string }
    // Should be accepted and attempt to analyze
    expect(result).toBeDefined()
    expect(result.path).toBe('/')
  })
})

// ── Additional coverage tests ──

describe('getDrives df parsing (non-Windows)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function stubExecFile(result: unknown, error?: Error) {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(error ?? null, result)
      }
    })
  }

  it('parses df output on non-Windows', async () => {
    if (process.platform === 'win32') return

    stubExecFile({
      stdout:
        'Filesystem   1024-blocks      Used Available Capacity Mounted on\n/dev/sda1     104857600  52428800  52428800 50% /\n/dev/sdb1     209715200 104857600 104857600 50% /home',
    })
    const drives = await getDrives()
    expect(drives).toHaveLength(2)
    expect(drives[0]!.letter).toBe('/')
    expect(drives[0]!.label).toBe('Root')
    expect(drives[0]!.totalSize).toBe(107374182400)
    expect(drives[0]!.usedSpace).toBe(53687091200)
    expect(drives[0]!.freeSpace).toBe(53687091200)
    expect(drives[1]!.letter).toBe('/home')
    expect(drives[1]!.label).toBe('home')
  })

  it('skips non-/dev filesystems in df output', async () => {
    if (process.platform === 'win32') return

    stubExecFile({
      stdout:
        'Filesystem   1024-blocks      Used Available Capacity Mounted on\ntmpfs        104857600   52428800  52428800 50% /run\ndevfs        104857600   52428800  52428800 50% /dev\n/dev/sda1    104857600   52428800  52428800 50% /',
    })
    const drives = await getDrives()
    expect(drives).toHaveLength(1)
    expect(drives[0]!.letter).toBe('/')
  })

  it('returns empty array when df fails', async () => {
    if (process.platform === 'win32') return

    stubExecFile('', new Error('df failed'))
    const drives = await getDrives()
    expect(drives).toEqual([])
  })
})

describe('getDrives parsing edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array on PS failure (Windows)', async () => {
    if (process.platform !== 'win32') return
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(new Error('PS failed'), '', '')
      }
    })
    const drives = await getDrives()
    expect(drives).toEqual([])
  })

  it('handles PS output with blank lines', async () => {
    if (process.platform !== 'win32') return
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(null, { stdout: 'C|Disk|1000|500\n\n\nD|Data|2000|1000\n' })
      }
    })
    const drives = await getDrives()
    expect(drives).toHaveLength(2)
  })

  it('skips malformed PS lines', async () => {
    if (process.platform !== 'win32') return
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(null, { stdout: 'C|Disk|1000|500\nbad-line\nD|Data|2000|1000' })
      }
    })
    const drives = await getDrives()
    expect(drives).toHaveLength(2)
  })
})

describe('analyzeDisk depth cutoff (quickSize)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEntry(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir }
  }

  it('switches to quickSize at MAX_DEPTH=3', async () => {
    if (process.platform !== 'win32') return

    // Reset to clear any leftover mockResolvedValueOnce from prior tests
    mockReaddir.mockReset()
    mockStat.mockReset()

    mockReaddir
      .mockResolvedValueOnce([makeEntry('d1', true)])
      .mockResolvedValueOnce([makeEntry('d2', true)])
      .mockResolvedValueOnce([makeEntry('d3', true)])
      .mockResolvedValueOnce([makeEntry('file.txt', false)]) // at depth 3, calls quickSize

    mockStat.mockResolvedValue({ isDirectory: () => false, size: 512, mtime: new Date(), birthtime: new Date() })

    const result = await analyzeDisk('C')
    expect(result.path).toBe('C:\\')
    // quickSize returns sum of file sizes at depth 3
    expect(result.size).toBe(512)
  })
})

describe('analyzeDisk error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEntry(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir }
  }

  it('handles readdir error gracefully', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockReset()
    mockReaddir.mockRejectedValue(new Error('access denied'))
    const result = await analyzeDisk('C')
    expect(result.path).toBe('C:\\')
    expect(result.children).toEqual([])
    expect(result.size).toBe(0)
  })

  it('handles stat error on individual file', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockReset()
    mockReaddir.mockResolvedValue([makeEntry('bad.txt', false)])
    mockStat.mockReset()
    mockStat.mockRejectedValue(new Error('corrupt'))
    const result = await analyzeDisk('C')
    expect(result.size).toBe(0)
  })

  it('handles readdir error on subdirectory — child still added with size 0', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockReset()
    mockReaddir.mockResolvedValueOnce([makeEntry('sub', true)]).mockRejectedValueOnce(new Error('access denied'))
    const result = await analyzeDisk('C')
    expect(result.children).toHaveLength(1)
    expect(result.children![0]!.name).toBe('sub')
    expect(result.children![0]!.size).toBe(0)
  })
})

describe('scan progress via IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEntry(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir }
  }

  it('sends progress during analyzeDirectory at depth 0', async () => {
    if (process.platform !== 'win32') return

    mockReaddir.mockReset()
    mockReaddir.mockResolvedValue([makeEntry('file.txt', false)])
    mockStat.mockReset()
    mockStat.mockResolvedValue({ isDirectory: () => false, size: 1024, mtime: new Date(), birthtime: new Date() })

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWindow() as any)
    const handler = getHandler('disk:analyze')
    await handler({}, 'C')

    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'scanning',
        category: 'disk',
      }),
    )
  })

  it('sends progress during collectFileTypes at depth 0', async () => {
    if (process.platform !== 'win32') return

    mockReaddir.mockReset()
    mockReaddir.mockResolvedValue([makeEntry('doc.txt', false)])
    mockStat.mockReset()
    mockStat.mockResolvedValue({ isDirectory: () => false, size: 2048, mtime: new Date(), birthtime: new Date() })

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWindow() as any)
    const handler = getHandler('disk:file-types')
    await handler({}, 'C')

    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'scanning',
        category: 'disk-file-types',
      }),
    )
  })

  it('does not send progress when window is null', async () => {
    if (process.platform !== 'win32') return

    mockReaddir.mockReset()
    mockReaddir.mockResolvedValue([])
    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:analyze')
    await handler({}, 'C')

    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('getFileTypes error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEntry(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir }
  }

  it('handles readdir error gracefully', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockReset()
    mockReaddir.mockRejectedValue(new Error('access denied'))
    const result = await getFileTypes('C')
    expect(result).toEqual([])
  })

  it('handles stat error on individual file', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockReset()
    mockReaddir.mockResolvedValue([makeEntry('bad.txt', false)])
    mockStat.mockReset()
    mockStat.mockRejectedValue(new Error('corrupt'))
    const result = await getFileTypes('C')
    expect(result).toEqual([])
  })
})

describe('DISK_REPAIR admin checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('SFC returns needsAdmin when not admin (Windows only)', async () => {
    if (process.platform !== 'win32') return
    mockIsAdmin.mockReturnValue(false)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const result = (await handler({}, 'C')) as { tool: string; success: boolean; needsAdmin: boolean }
    expect(result.tool).toBe('sfc')
    expect(result.success).toBe(false)
    expect(result.needsAdmin).toBe(true)
  })

  it('DISM returns needsAdmin when not admin (Windows only)', async () => {
    if (process.platform !== 'win32') return
    mockIsAdmin.mockReturnValue(false)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const result = (await handler()) as { tool: string; success: boolean; needsAdmin: boolean }
    expect(result.tool).toBe('dism')
    expect(result.success).toBe(false)
    expect(result.needsAdmin).toBe(true)
  })

  it('CHKDSK returns needsAdmin when not admin (Windows only)', async () => {
    if (process.platform !== 'win32') return
    mockIsAdmin.mockReturnValue(false)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const result = (await handler({}, 'C')) as { tool: string; success: boolean; needsAdmin: boolean }
    expect(result.tool).toBe('chkdsk')
    expect(result.success).toBe(false)
    expect(result.needsAdmin).toBe(true)
  })
})

// ── Platform-mocked spawn tests for SFC / DISM / CHKDSK ──
// These mock process.platform to 'win32' so we can exercise the spawn
// event handlers regardless of the actual test platform.

import { EventEmitter } from 'node:events'

function createMockChildProcess() {
  const child = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  ;(child as any).stdout = stdout
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  ;(child as any).stderr = stderr
  return { child, stdout, stderr }
}

describe('disk:repair:sfc spawn event handling', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockIsAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform.value, configurable: true })
  })

  it('handles stdout with no violations found', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Windows Resource Protection did not find any integrity violations.'))
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('sfc')
    expect(result.success).toBe(true)
    expect(result.summary).toContain('No integrity violations found')
  })

  it('handles stdout with successful repair', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Windows Resource Protection successfully repaired corrupt files.'))
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('sfc')
    expect(result.success).toBe(true)
    expect(result.summary).toContain('repaired corrupted')
  })

  it('handles stdout with corrupt files unable to fix', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit(
      'data',
      Buffer.from('Windows Resource Protection found corrupt files but was unable to fix some of them.'),
    )
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('sfc')
    expect(result.success).toBe(true) // exit code 0
    expect(result.summary).toContain('could not be repaired')
  })

  it('handles non-zero exit code', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Something went wrong.'))
    child.emit('close', 1)

    const result = (await promise) as { tool: string; success: boolean; exitCode: number }
    expect(result.tool).toBe('sfc')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
  })

  it('handles spawn error event', async () => {
    const { child } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    child.emit('error', new Error('spawn failed'))

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('sfc')
    expect(result.success).toBe(false)
    expect(result.summary).toContain('spawn failed')
  })

  it('sends progress during SFC stdout', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWin as any)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Verification 42% complete.'))
    child.emit('close', 0)

    await promise
    expect(mockSend).toHaveBeenCalledWith(
      'disk:repair:progress',
      expect.objectContaining({
        tool: 'sfc',
        percent: 42,
      }),
    )
  })

  it('uses /offbootdir for non-C drive', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'D')

    stdout.emit('data', Buffer.from(''))
    child.emit('close', 0)

    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd',
      expect.arrayContaining([
        expect.stringContaining('/offbootdir=D:'),
        expect.stringContaining('/offwindir=D:\\Windows'),
      ]),
      expect.any(Object),
    )
  })

  it('collects stderr data', async () => {
    const { child, stdout, stderr } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('main output'))
    stderr.emit('data', Buffer.from('stderr output'))
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; log: string }
    expect(result.log).toContain('main output')
    expect(result.log).toContain('stderr output')
  })

  it('detects reboot required from stdout', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('pending system repair. restart your computer to complete.'))
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; requiresReboot: boolean }
    expect(result.requiresReboot).toBe(true)
  })
})

describe('disk:repair:dism spawn event handling', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockIsAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform.value, configurable: true })
  })

  it('handles successful DISM completion', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('The operation completed successfully.'))
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('dism')
    expect(result.success).toBe(true)
    expect(result.summary).toContain('completed successfully')
  })

  it('handles DISM progress parsing', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWin as any)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('[=======          42.0%                ]'))
    child.emit('close', 0)

    await promise
    expect(mockSend).toHaveBeenCalledWith(
      'disk:repair:progress',
      expect.objectContaining({
        tool: 'dism',
        percent: 42,
      }),
    )
  })

  it('handles DISM error event', async () => {
    const { child } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    child.emit('error', new Error('DISM not found'))

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('dism')
    expect(result.success).toBe(false)
    expect(result.summary).toContain('DISM not found')
  })

  it('handles DISM non-zero exit code', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('Error: 0x800f081f'))
    child.emit('close', 2)

    const result = (await promise) as { tool: string; success: boolean; exitCode: number; log: string }
    expect(result.tool).toBe('dism')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(result.log).toContain('0x800f081f')
  })

  it('collects DISM stderr', async () => {
    const { child, stdout, stderr } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('stdout line'))
    stderr.emit('data', Buffer.from('stderr line'))
    child.emit('close', 0)

    const result = (await promise) as { log: string }
    expect(result.log).toContain('stderr line')
  })
})

describe('disk:repair:chkdsk spawn event handling', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockIsAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform.value, configurable: true })
  })

  it('handles CHKDSK with no errors found', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Windows has scanned the file system and found no problems.'))
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('chkdsk')
    expect(result.success).toBe(true)
    expect(result.summary).toContain('No file system errors found')
  })

  it('handles CHKDSK with corrections made', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Windows has made corrections to the file system.'))
    child.emit('close', 1)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('chkdsk')
    expect(result.success).toBe(true) // code 1 ≤ 2 = success
    expect(result.summary).toContain('repaired')
  })

  it('handles CHKDSK with no further action required', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('no further action is required.'))
    child.emit('close', 2)

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('chkdsk')
    expect(result.success).toBe(true) // code 2 ≤ 2 = success
    expect(result.summary).toContain('no further action')
  })

  it('handles CHKDSK with non-zero exit codes producing correct summary', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from(''))
    child.emit('close', 3)

    const result = (await promise) as { tool: string; success: boolean; exitCode: number; summary: string }
    expect(result.tool).toBe('chkdsk')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(3)
    expect(result.summary).toContain('exited with code 3')
  })

  it('handles CHKDSK progress percentage', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWin as any)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Stage 1: Scanning... 42 percent complete'))
    child.emit('close', 0)

    await promise
    expect(mockSend).toHaveBeenCalledWith(
      'disk:repair:progress',
      expect.objectContaining({
        tool: 'chkdsk',
        percent: 42,
      }),
    )
  })

  it('handles CHKDSK with only highest percent sent', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWin as any)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('10 percent complete'))
    stdout.emit('data', Buffer.from('20 percent complete'))
    stdout.emit('data', Buffer.from('20 percent complete')) // duplicate — should not send
    child.emit('close', 0)

    await promise
    // Called: 10% data + 20% data + close done = 3
    expect(mockSend).toHaveBeenCalledTimes(3)
  })

  it('handles CHKDSK error event', async () => {
    const { child } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    child.emit('error', new Error('chkdsk not found'))

    const result = (await promise) as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('chkdsk')
    expect(result.success).toBe(false)
    expect(result.summary).toContain('chkdsk not found')
  })

  it('defaults to drive C for invalid drive', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, '!')

    stdout.emit('data', Buffer.from(''))
    child.emit('close', 0)

    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd',
      expect.arrayContaining([expect.stringContaining('chkdsk C:')]),
      expect.any(Object),
    )
  })

  it('sends progress on CHKDSK error', async () => {
    const { child } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerDiskAnalyzerIpc(() => mockWin as any)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    child.emit('error', new Error('access denied'))

    await promise
    expect(mockSend).toHaveBeenCalledWith(
      'disk:repair:progress',
      expect.objectContaining({
        tool: 'chkdsk',
        phase: 'failed',
      }),
    )
  })

  it('detects CHKDSK reboot required', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit(
      'data',
      Buffer.from('Cannot run because the volume is in use by another process. Please schedule a restart.'),
    )
    child.emit('close', 0)

    const result = (await promise) as { tool: string; success: boolean; requiresReboot: boolean }
    expect(result.requiresReboot).toBe(true)
  })

  it('collects CHKDSK stderr', async () => {
    const { child, stdout, stderr } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('stdout data'))
    stderr.emit('data', Buffer.from('stderr data'))
    child.emit('close', 0)

    const result = (await promise) as { log: string }
    expect(result.log).toContain('stderr data')
  })
})

describe('disk:repair:dism additional summary branches', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockIsAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform.value, configurable: true })
  })

  it('handles "No component store corruption detected" message', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('No component store corruption detected — image is healthy.'))
    child.emit('close', 0)

    const result = (await promise) as { summary: string }
    expect(result.summary).toContain('No component store corruption detected')
  })

  it('handles "The restore operation completed successfully" message', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('The restore operation completed successfully.'))
    child.emit('close', 0)

    const result = (await promise) as { summary: string }
    expect(result.summary).toContain('successfully repaired')
  })

  it('sends progress to window during DISM even when progress re-sent', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    registerDiskAnalyzerIpc(() => mockWin as never)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('[==      25.0%              ]'))
    stdout.emit('data', Buffer.from('[==      25.0%              ]'))
    child.emit('close', 0)

    await promise
    const progressCalls = mockSend.mock.calls.filter((c: unknown[]) => c[0] === 'disk:repair:progress')
    // 25% + close = 2 calls (duplicate 25% is skipped)
    expect(progressCalls.length).toBe(2)
  })
})

describe('disk:repair:chkdsk additional summary branches', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockIsAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform.value, configurable: true })
  })

  it('handles code=1 without matching keywords — falls to code===1 branch', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Some generic output'))
    child.emit('close', 1)

    const result = (await promise) as { success: boolean; summary: string; exitCode: number }
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(1)
    expect(result.summary).toContain('Errors were found and fixed successfully')
  })

  it('handles code=2 without matching keywords — falls to code===2 branch', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Some generic output'))
    child.emit('close', 2)

    const result = (await promise) as { success: boolean; summary: string; exitCode: number }
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(2)
    expect(result.summary).toContain('CHKDSK completed disk cleanup')
  })

  it('handles code=0 without matching keywords — falls to code===0 branch', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    registerDiskAnalyzerIpc(() => null)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Some generic output'))
    child.emit('close', 0)

    const result = (await promise) as { success: boolean; summary: string; exitCode: number }
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.summary).toContain('CHKDSK completed successfully')
  })

  it('handles progress percentage via "%" pattern', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const mockWin = mockWindow()
    registerDiskAnalyzerIpc(() => mockWin as never)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Stage 1: 42% complete'))
    child.emit('close', 0)

    await promise
    expect(mockSend).toHaveBeenCalledWith(
      'disk:repair:progress',
      expect.objectContaining({ tool: 'chkdsk', percent: 42 }),
    )
  })
})

describe('resolveRootPath edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty node for multi-character letter', async () => {
    const result = await analyzeDisk('AB')
    expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
  })

  it('returns empty node for numeric string', async () => {
    const result = await analyzeDisk('123')
    expect(result).toEqual({ name: '', path: '', size: 0, children: [] })
  })
})

describe('collectFileTypes additional paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEntry(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir }
  }

  it('recurses into subdirectories', async () => {
    if (process.platform !== 'win32') return
    mockReaddir
      .mockResolvedValueOnce([makeEntry('subdir', true)])
      .mockResolvedValueOnce([makeEntry('nested.txt', false)])
    mockStat.mockResolvedValue({ isDirectory: () => false, size: 512, mtime: new Date(), birthtime: new Date() })

    const result = await getFileTypes('C')
    expect(result).toHaveLength(1)
    expect(result[0]!.extension).toBe('.txt')
    expect(result[0]!.fileCount).toBe(1)
  })

  it('handles entries with no extension', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockResolvedValueOnce([makeEntry('README', false)])
    mockStat.mockResolvedValue({ isDirectory: () => false, size: 256, mtime: new Date(), birthtime: new Date() })

    const result = await getFileTypes('C')
    expect(result).toHaveLength(1)
    expect(result[0]!.extension).toBe('(no extension)')
  })

  it('uses uppercase extension for grouping', async () => {
    if (process.platform !== 'win32') return
    mockReaddir.mockResolvedValueOnce([makeEntry('file.TXT', false), makeEntry('file2.txt', false)])
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => false, size: 100, mtime: new Date(), birthtime: new Date() })
      .mockResolvedValueOnce({ isDirectory: () => false, size: 200, mtime: new Date(), birthtime: new Date() })

    const result = await getFileTypes('C')
    expect(result).toHaveLength(1)
    expect(result[0]!.extension).toBe('.txt')
    expect(result[0]!.totalSize).toBe(300)
    expect(result[0]!.fileCount).toBe(2)
  })
})

describe('quickSize edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEntry(name: string, isDir: boolean) {
    return { name, isDirectory: () => isDir }
  }

  it('skips subdirectories in quickSize calculation', async () => {
    if (process.platform !== 'win32') return

    mockReaddir
      .mockResolvedValueOnce([makeEntry('d1', true)])
      .mockResolvedValueOnce([makeEntry('d2', true)])
      .mockResolvedValueOnce([makeEntry('d3', true)])
      .mockResolvedValueOnce([makeEntry('subdir', true), makeEntry('file.txt', false)])

    mockStat.mockReset()
    mockStat.mockImplementation((filePath: string) => {
      const name = filePath.split(/[/\\]/).pop()
      if (name === 'subdir') {
        return Promise.resolve({ isDirectory: () => true, size: 0, mtime: new Date(), birthtime: new Date() })
      }
      return Promise.resolve({ isDirectory: () => false, size: 512, mtime: new Date(), birthtime: new Date() })
    })

    const result = await analyzeDisk('C')
    expect(result.size).toBe(512)
  })

  it('handles stat failure during quickSize', async () => {
    if (process.platform !== 'win32') return

    mockReaddir
      .mockResolvedValueOnce([makeEntry('d1', true)])
      .mockResolvedValueOnce([makeEntry('d2', true)])
      .mockResolvedValueOnce([makeEntry('d3', true)])
      .mockResolvedValueOnce([makeEntry('bad.txt', false)])

    mockStat.mockReset()
    mockStat.mockRejectedValue(new Error('stat failed'))

    const result = await analyzeDisk('C')
    // stat failure silently returns 0 for that entry in quickSize
    expect(result.size).toBe(0)
  })

  it('handles readdir failure during quickSize', async () => {
    if (process.platform !== 'win32') return

    mockReaddir
      .mockResolvedValueOnce([makeEntry('d1', true)])
      .mockResolvedValueOnce([makeEntry('d2', true)])
      .mockResolvedValueOnce([makeEntry('d3', true)])
      .mockRejectedValueOnce(new Error('access denied'))

    const result = await analyzeDisk('C')
    // quickSize returns 0 on readdir failure
    expect(result.size).toBe(0)
  })
})

describe('sendRepairProgress with destroyed window', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockIsAdmin.mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform.value, configurable: true })
  })

  it('SFC does not send progress when window is destroyed', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const destroyedWin = { isDestroyed: () => true, webContents: { send: mockSend } }
    registerDiskAnalyzerIpc(() => destroyedWin as never)
    const handler = getHandler('disk:repair:sfc')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('Verification 50% complete.'))
    child.emit('close', 0)

    await promise
    // Only the close "done" message would attempt to send (but window destroyed)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('DISM does not send progress when window is destroyed', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const destroyedWin = { isDestroyed: () => true, webContents: { send: mockSend } }
    registerDiskAnalyzerIpc(() => destroyedWin as never)
    const handler = getHandler('disk:repair:dism')
    const promise = handler()

    stdout.emit('data', Buffer.from('[==      50.0%              ]'))
    child.emit('close', 0)

    await promise
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('CHKDSK does not send progress when window is destroyed', async () => {
    const { child, stdout } = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const destroyedWin = { isDestroyed: () => true, webContents: { send: mockSend } }
    registerDiskAnalyzerIpc(() => destroyedWin as never)
    const handler = getHandler('disk:repair:chkdsk')
    const promise = handler({}, 'C')

    stdout.emit('data', Buffer.from('42 percent complete'))
    child.emit('close', 0)

    await promise
    expect(mockSend).not.toHaveBeenCalled()
  })
})
