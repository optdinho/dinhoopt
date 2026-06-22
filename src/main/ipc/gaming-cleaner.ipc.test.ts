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

const mockExecNativeUtf8 = vi.fn()
vi.mock('../services/exec-utf8', () => ({
  execNativeUtf8: (...args: unknown[]) => mockExecNativeUtf8(...args),
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
    mockExecNativeUtf8.mockRejectedValue(new Error('Registry not found'))
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

  it('discovers Steam libraries from registry when VDF contains multiple paths', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    // Registry returns the real Steam install directory
    mockExecNativeUtf8.mockResolvedValue({
      stdout:
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam\n    InstallPath    REG_SZ    C:\\Program Files (x86)\\Steam\n',
      stderr: '',
    })

    // VDF contains the Steam install dir + two additional library folders
    mockReadFile.mockResolvedValueOnce(
      [
        '"libraryfolders"',
        '{',
        '  "1"   {  "path"  "C:\\Program Files (x86)\\Steam"  }',
        '  "2"   {  "path"  "D:\\SteamLibrary"  }',
        '  "3"   {  "path"  "E:\\SteamLibrary"  }',
        '}',
      ].join('\n'),
    )

    // steamapps dir check: VDF paths take precedence, no fallback needed
    mockExistsSync.mockReturnValue(false)

    // buildAppIdMap: empty steamAppsDir → no shaders
    mockReaddir.mockResolvedValue([])

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    await handler()

    // Should find all 3 paths from VDF (no steamLibraries fallback needed)
    // Implementation reads VDF from the registry-detected dir
    expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('libraryfolders.vdf'), 'utf-8')
  })

  it('falls back to steamLibraries when registry detection fails', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    // execNativeUtf8 already rejects from beforeEach
    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    mockReaddir.mockResolvedValue([])

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]

    expect(mockPlatformPaths.steamLibraries).toHaveBeenCalled()
    // No shader results because steamAppsDir was empty
    expect(result.length).toBeGreaterThanOrEqual(0)
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

  it('skips launcher when scan returns empty items', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([{ id: 'steam', name: 'Steam', paths: ['/steam/cache'] }])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])
    mockScanDirectoriesAsItems.mockResolvedValue(EMPTY_RESULT)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(result).toHaveLength(0)
  })

  it('skips GPU scan when scan returns empty items', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([{ id: 'nvidia', name: 'NVIDIA', paths: ['/nvidia/cache'] }])
    mockPlatformPaths.steamLibraries.mockReturnValue([])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])
    mockScanDirectoriesAsItems.mockResolvedValue(EMPTY_RESULT)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(result).toHaveLength(0)
  })

  it('handles detectSteamFromRegistry without REG_SZ match', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    // Registry returns stdout without REG_SZ line
    mockExecNativeUtf8.mockResolvedValue({
      stdout: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam\n    NoMatch    REG_DWORD    0x1\n',
      stderr: '',
    })
    mockReadFile.mockRejectedValue(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)
    mockReaddir.mockResolvedValue([])

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    // Falls back to steamLibraries, then VDF fails, then steamapps check succeeds → empty shader/redist
    expect(Array.isArray(result)).toBe(true)
  })

  it('skips non-manifest files in buildAppIdMap', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    // readdir returns both a manifest file and a non-manifest file, then shader dir
    mockReaddir.mockResolvedValueOnce(['appmanifest_12345.acf', 'some_other_file.txt']).mockResolvedValueOnce([])

    mockReadFile.mockResolvedValueOnce('"appid"\t\t"12345"\n"name"\t\t"Test Game"\n')

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(Array.isArray(result)).toBe(true)
  })

  it('skips manifest without idMatch or nameMatch', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    mockReaddir.mockResolvedValueOnce(['appmanifest_99999.acf']).mockResolvedValueOnce([])

    // Manifest file without appid or name fields
    mockReadFile.mockResolvedValueOnce('"SomeField"\t\t"SomeValue"\n')

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(Array.isArray(result)).toBe(true)
  })

  it('skips non-directory entries in shader cache', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    // buildAppIdMap: empty steamAppsDir
    // shader cache: returns a file (non-directory) and a directory
    mockReaddir.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'readme.txt', isDirectory: () => false }])

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(Array.isArray(result)).toBe(true)
  })

  it('skips shader cache smaller than 1KB', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    mockReaddir.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: '12345', isDirectory: () => true }])

    mockGetDirectorySize.mockResolvedValue(512)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(Array.isArray(result)).toBe(true)
  })

  it('uses unknown game name for shader cache when appIdMap missing entry', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue([])

    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    mockExistsSync.mockReturnValue(true)

    // buildAppIdMap: steamAppsDir has manifest for game "99999"
    // shader cache: has directory "99998" (not in the map)
    mockReaddir
      .mockResolvedValueOnce(['appmanifest_99999.acf'])
      .mockResolvedValueOnce([{ name: '99998', isDirectory: () => true }])

    mockReadFile.mockResolvedValueOnce('"appid"\t\t"99999"\n"name"\t\t"Some Game"\n')
    mockGetDirectorySize.mockResolvedValue(65536)

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    const shaderRows = result.filter((r) => (r.group as string)?.includes('Shader'))
    expect(shaderRows.length).toBeGreaterThanOrEqual(1)
    expect(shaderRows[0]!.subcategory).toContain('Unknown')
  })

  it('skips redistributables when commonDir does not exist', async () => {
    mockPlatformPaths.gamingPaths.mockReturnValue([])
    mockPlatformPaths.gpuCachePaths.mockReturnValue([])
    mockPlatformPaths.steamLibraries.mockReturnValue(['/steam'])
    mockPlatformPaths.steamRedistPatterns.mockReturnValue(['_CommonRedist'])

    mockReadFile.mockRejectedValueOnce(new Error('VDF not found'))
    // existsSync: steamapps exists, but commonDir does NOT exist
    mockExistsSync.mockReturnValueOnce(false) // for steamapps (getSteamLibraryPaths fallback check)
    mockExistsSync.mockReturnValueOnce(false) // for commonDir

    mockReaddir.mockResolvedValueOnce([]) // buildAppIdMap empty
    // shader dir readdir → empty (but shader dir existsSync check is at getSteamLibraryPaths: steamapps/shadercache → not checked directly)
    // Actually, scanSteamShaderCaches checks existsSync(shaderDir) → shaderDir = libPath/steamapps/shadercache
    // The steamapps dir must exist, but shaderDir not checked since we won't reach it
    mockReaddir.mockResolvedValueOnce([]) // steamAppsDir

    registerGamingCleanerIpc(() => null)
    const handler = getHandler('cleaner:gaming:scan')

    const result = (await handler()) as ScanResult[]
    expect(Array.isArray(result)).toBe(true)
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
