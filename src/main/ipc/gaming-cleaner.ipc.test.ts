import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandle = vi.fn()
const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

const mockReaddir = vi.fn()
const mockStat = vi.fn()
const mockReadFile = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

const mockExistsSync = vi.fn()
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}))

const mockPlatformPaths = {
  gamingPaths: vi.fn(),
  gpuCachePaths: vi.fn(),
  steamLibraries: vi.fn(),
  steamRedistPatterns: vi.fn(),
}
vi.mock('../platform', () => ({
  getPlatform: () => ({ paths: mockPlatformPaths }),
}))

const mockScanDirectoriesAsItems = vi.fn()
const mockCleanItems = vi.fn()
const mockGetDirectorySize = vi.fn()
vi.mock('../services/file-utils', () => ({
  scanDirectoriesAsItems: (...args: unknown[]) => mockScanDirectoriesAsItems(...args),
  cleanItems: (...args: unknown[]) => mockCleanItems(...args),
  getDirectorySize: (...args: unknown[]) => mockGetDirectorySize(...args),
}))

const mockCacheItems = vi.fn()
vi.mock('../services/scan-cache', () => ({
  cacheItems: (...args: unknown[]) => mockCacheItems(...args),
}))

import type { CleanResult, ScanItem, ScanResult } from '@shared/types'
import { registerGamingCleanerIpc } from './gaming-cleaner.ipc'

// biome-ignore lint/suspicious/noExplicitAny: test constant
const EMPTY_RESULT: ScanResult = { category: 'gaming' as any, subcategory: '', items: [], totalSize: 0, itemCount: 0 }

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

describe('registerGamingCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers GAMING_SCAN and GAMING_CLEAN handlers', () => {
    registerGamingCleanerIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('cleaner:gaming:scan')
    expect(channels).toContain('cleaner:gaming:clean')
    expect(channels.length).toBe(2)
  })
})

describe('GAMING_SCAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns results from launchers, GPUs, and Steam', async () => {
    const mockItem: ScanItem = {
      id: '1',
      path: '/cache',
      size: 2048,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      category: 'gaming' as any,
      subcategory: 'Launcher',
      lastModified: Date.now(),
      selected: true,
    }
    const launcherResult: ScanResult = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      category: 'gaming' as any,
      subcategory: 'Steam',
      group: 'Launcher Caches',
      items: [mockItem],
      totalSize: 2048,
      itemCount: 1,
    }
    const gpuResult: ScanResult = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      category: 'gaming' as any,
      subcategory: 'NVIDIA',
      group: 'GPU Shader Caches',
      items: [mockItem],
      totalSize: 2048,
      itemCount: 1,
    }

    mockPlatformPaths.gamingPaths.mockReturnValue([{ id: 'steam', name: 'Steam', paths: ['/steam/cache'] }])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([{ id: 'nvidia', name: 'NVIDIA', paths: ['/nvidia/cache'] }])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockScanDirectoriesAsItems.mockResolvedValueOnce(launcherResult).mockResolvedValueOnce(gpuResult)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(result).toHaveLength(2)
    expect(result[0]!.subcategory).toBe('Steam')
    expect(result[1]!.subcategory).toBe('NVIDIA')
  })

  it('sends progress after scan completes', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])
    mockScanDirectoriesAsItems.mockResolvedValue(EMPTY_RESULT)

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerGamingCleanerIpc(() => mockWindow() as any)
    const handler = getHandler('cleaner:gaming:scan')

    await handler()

    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'scanning',
        category: 'gaming',
        progress: 100,
      }),
    )
  })

  it('skips launcher paths that throw errors', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([{ id: 'steam', name: 'Steam', paths: ['/broken'] }])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockScanDirectoriesAsItems.mockRejectedValue(new Error('access denied'))

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    // Should not throw; returns whatever succeeded
    expect(Array.isArray(result)).toBe(true)
  })

  it('processes Steam shader caches from libraries', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    // getSteamLibraryPaths: VDF read fails → fallback to existsSync
    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    // buildAppIdMap: readdir of steamAppsDir (plain, no withFileTypes)
    mockReaddir.mockResolvedValueOnce(['appmanifest_12345.acf'])
    // readFile for appmanifest
    mockReadFile.mockResolvedValueOnce('"appid"\t\t"12345"\n"name"\t\t"Test Game"')

    // scanSteamShaderCaches: readdir of shadercache (withFileTypes → Dirent-like objects)
    mockReaddir.mockResolvedValueOnce([{ name: '12345', isDirectory: () => true }])

    mockGetDirectorySize.mockResolvedValue(65536)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    const shaderRows = result.filter((r) => (r.group as string)?.includes('Shader'))
    expect(shaderRows.length).toBeGreaterThanOrEqual(1)
    expect(shaderRows[0]!.itemCount).toBe(1)
  })

  it('processes Steam redistributables', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue(['_CommonRedist'])

    // getSteamLibraryPaths: VDF read fails → fallback to existsSync
    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    // First two readdirs happen in scanSteamShaderCaches (runs before redist):
    // 1. buildAppIdMap: readdir(steamAppsDir) → empty (no manifests)
    // 2. shaderDir readdir → empty (no shaders)
    // Third is redist's common dir readdir
    mockReaddir
      .mockResolvedValueOnce([]) // steamAppsDir for shader
      .mockResolvedValueOnce([]) // shaderDir for shader
      .mockResolvedValueOnce([{ name: 'TestGame', isDirectory: () => true }]) // commonDir for redist
    // stat for redist path (persistent, not Once)
    mockStat.mockResolvedValue({ isDirectory: () => true, size: 0, mtimeMs: Date.now(), birthtimeMs: Date.now() })
    mockGetDirectorySize.mockResolvedValue(65536)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    const redistRows = result.filter((r) => (r.group as string)?.includes('Redistributables'))
    expect(redistRows.length).toBeGreaterThanOrEqual(1)
    expect(redistRows[0]!.itemCount).toBe(1)
  })

  it('does not send progress when window is null', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])
    mockScanDirectoriesAsItems.mockResolvedValue(EMPTY_RESULT)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    await handler()

    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('GAMING_CLEAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls cleanItems with valid item IDs', async () => {
    const cleanResult: CleanResult = {
      totalCleaned: 1024,
      filesDeleted: 2,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    mockCleanItems.mockResolvedValue(cleanResult)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:clean')

    const result = (await handler({}, ['id1', 'id2'])) as CleanResult
    expect(result.totalCleaned).toBe(1024)
    expect(mockCleanItems).toHaveBeenCalledWith(['id1', 'id2'], expect.any(Function))
  })

  it('returns zero result for invalid item IDs', async () => {
    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:clean')

    const result = (await handler({}, null)) as CleanResult
    expect(result.totalCleaned).toBe(0)
    expect(mockCleanItems).not.toHaveBeenCalled()
  })

  it('sends progress during clean', async () => {
    const cleanResult: CleanResult = {
      totalCleaned: 2048,
      filesDeleted: 4,
      filesSkipped: 1,
      errors: [],
      needsElevation: false,
    }
    mockCleanItems.mockImplementation(
      async (
        _ids: string[],
        onProgress: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
      ) => {
        onProgress(1, 2, '/path/to/file', 1024)
        onProgress(2, 2, '/path/to/next', 2048)
        return cleanResult
      },
    )

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerGamingCleanerIpc(() => mockWindow() as any)
    const handler = getHandler('cleaner:gaming:clean')

    await handler({}, ['id1', 'id2'])

    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'cleaning',
        category: 'gaming',
      }),
    )
  })

  it('does not send progress when window is null during clean', async () => {
    mockCleanItems.mockImplementation(
      async (
        _ids: string[],
        onProgress: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
      ) => {
        onProgress(1, 1, '/path', 512)
      },
    )

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:clean')

    await handler({}, ['id1'])

    expect(mockSend).not.toHaveBeenCalled()
  })
})
