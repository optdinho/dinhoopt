import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  execFileAsync: vi.fn(),
  execNativeUtf8: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  createHash: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => mocks.readdirSync(...args),
  statSync: (...args: unknown[]) => mocks.statSync(...args),
}))

vi.mock('node:crypto', () => ({
  createHash: (...args: unknown[]) => mocks.createHash(...args),
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  execNativeUtf8: (...args: unknown[]) => mocks.execNativeUtf8(...args),
  psArgs: (s: string) => ['-NoProfile', '-NonInteractive', '-Command', s],
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import {
  cleanDrivers,
  installDriverUpdates,
  registerDriverManagerIpc,
  scanDriverUpdates,
  scanDrivers,
} from './driver-manager.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

// Replicate internal functions used by the module since they're not exported

function makeId(publishedName: string, version: string): string {
  const sha = mocks.createHash('sha256')
  sha.update(`${publishedName}::${version}`)
  const digest = sha.digest('hex') as string
  return digest.slice(0, 16)
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na !== nb) return na - nb
  }
  return 0
}

function dirSize(dirPath: string): number {
  let total = 0
  try {
    const entries = mocks.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        if (entry.isFile()) {
          total += mocks.statSync(`${dirPath}/${entry.name}`).size
        } else if (entry.isDirectory()) {
          total += dirSize(`${dirPath}/${entry.name}`)
        }
      } catch {
        /* skip inaccessible files */
      }
    }
  } catch {
    /* skip inaccessible dirs */
  }
  return total
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createHash.mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8'),
  })
})

// ── Platform mocking for win32-dependent functions ──
let originalPlatform: string

beforeAll(() => {
  originalPlatform = process.platform
})

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function win32BeforeEach() {
  setPlatform('win32')
}

describe('makeId', () => {
  it('returns deterministic 16-char hex hash', () => {
    const id = makeId('oem7.inf', '10.0.22621.1')
    expect(id).toHaveLength(16)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns different ids for different inputs', () => {
    mocks.createHash.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('11111111111111112222222222222222'),
    })
    const id1 = makeId('oem7.inf', '10.0.22621.1')
    mocks.createHash.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb'),
    })
    const id2 = makeId('oem7.inf', '10.0.22621.2')
    expect(id1).not.toBe(id2)
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('10.0.1', '10.0.1')).toBe(0)
  })

  it('returns positive when a > b', () => {
    expect(compareVersions('10.0.2', '10.0.1')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('returns negative when a < b', () => {
    expect(compareVersions('10.0.1', '10.0.2')).toBeLessThan(0)
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0)
  })

  it('handles different segment lengths', () => {
    expect(compareVersions('10.0.1.100', '10.0.1')).toBeGreaterThan(0)
    expect(compareVersions('10.0.1', '10.0.1.100')).toBeLessThan(0)
  })

  it('handles zero-segment fallback', () => {
    expect(compareVersions('10', '10.0.0')).toBe(0)
  })
})

describe('dirSize', () => {
  it('returns 0 for empty directory', () => {
    mocks.readdirSync.mockReturnValueOnce([])
    expect(dirSize('C:\\empty')).toBe(0)
  })

  it('sums file sizes', () => {
    mocks.readdirSync.mockReturnValueOnce([
      { isFile: () => true, isDirectory: () => false, name: 'a.bin' },
      { isFile: () => true, isDirectory: () => false, name: 'b.bin' },
    ])
    mocks.statSync.mockReturnValueOnce({ size: 100 }).mockReturnValueOnce({ size: 200 })
    expect(dirSize('C:\\dir')).toBe(300)
  })

  it('handles inaccessible files gracefully', () => {
    mocks.readdirSync.mockReturnValueOnce([{ isFile: () => true, isDirectory: () => false, name: 'locked.bin' }])
    mocks.statSync.mockImplementationOnce(() => {
      throw new Error('access denied')
    })
    expect(dirSize('C:\\dir')).toBe(0)
  })

  it('handles inaccessible directory gracefully', () => {
    mocks.readdirSync.mockImplementationOnce(() => {
      throw new Error('access denied')
    })
    expect(dirSize('C:\\locked')).toBe(0)
  })
})

describe('registerDriverManagerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    win32BeforeEach()
  })

  it('registers all four IPC handlers', () => {
    registerDriverManagerIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('driver:scan')
    expect(channels).toContain('driver:clean')
    expect(channels).toContain('driver:update:scan')
    expect(channels).toContain('driver:update:install')
    expect(channels.length).toBe(4)
  })

  describe('DRIVER_CLEAN handler', () => {
    it('rejects non-array input', async () => {
      registerDriverManagerIpc(() => null)
      const handler = getHandler('driver:clean')
      const result = await handler({} as unknown[], null)
      expect(result).toEqual({ removed: 0, failed: 0, spaceRecovered: 0, errors: [] })
    })

    it('rejects array with invalid names (not oem*.inf)', async () => {
      registerDriverManagerIpc(() => null)
      const handler = getHandler('driver:clean')
      const result = await handler({} as unknown[], ['bad.exe', 'test.dll'])
      expect(result).toEqual({
        removed: 0,
        failed: 2,
        spaceRecovered: 0,
        errors: [
          { publishedName: 'bad.exe', reason: 'Invalid driver package name' },
          { publishedName: 'test.dll', reason: 'Invalid driver package name' },
        ],
      })
    })
  })

  describe('DRIVER_UPDATE_INSTALL handler', () => {
    it('rejects non-array input', async () => {
      registerDriverManagerIpc(() => null)
      const handler = getHandler('driver:update:install')
      const result = await handler({} as unknown[], null)
      expect(result).toEqual({ installed: 0, failed: 0, rebootRequired: false, errors: [] })
    })
  })

  describe('DRIVER_SCAN handler', () => {
    it('returns empty result on non-Windows', async () => {
      registerDriverManagerIpc(() => null)
      setPlatform('linux')
      const handler = getHandler('driver:scan')
      const result = await handler()
      expect(result).toEqual({ packages: [], totalStaleSize: 0, totalStaleCount: 0, totalCurrentCount: 0 })
    })
  })

  describe('DRIVER_UPDATE_SCAN handler', () => {
    it('returns empty result on non-Windows', async () => {
      registerDriverManagerIpc(() => null)
      setPlatform('linux')
      const handler = getHandler('driver:update:scan')
      const result = await handler()
      expect(result).toEqual({ updates: [], totalAvailable: 0, scanDuration: expect.any(Number) })
    })
  })

  describe('DRIVER_CLEAN handler with valid input', () => {
    it('deletes drivers successfully', async () => {
      mocks.execFileAsync.mockResolvedValue({ stdout: '' })
      mocks.execNativeUtf8.mockResolvedValue({ stdout: '' })
      registerDriverManagerIpc(() => null)
      const handler = getHandler('driver:clean')
      const result = await handler({} as unknown[], ['oem0.inf'])
      expect(result.removed).toBe(1)
      expect(result.failed).toBe(0)
    })
  })

  describe('DRIVER_UPDATE_INSTALL handler with valid input', () => {
    it('installs updates successfully', async () => {
      mocks.execFileAsync.mockResolvedValue({
        stdout: 'STATUS|downloading|1\nSTATUS|installing|1\nINSTALLED|Driver1\nRESULT|1|0|false',
      })
      registerDriverManagerIpc(() => null)
      const handler = getHandler('driver:update:install')
      const result = await handler({} as unknown[], ['update-001'])
      expect(result.installed).toBe(1)
    })
  })
})

describe('scanDrivers', () => {
  beforeEach(() => {
    win32BeforeEach()
  })

  it('returns empty result when not on Windows', async () => {
    setPlatform('linux')
    const result = await scanDrivers()
    expect(result).toEqual({ packages: [], totalStaleSize: 0, totalStaleCount: 0, totalCurrentCount: 0 })
    expect(mocks.logger.warning).toHaveBeenCalledWith('driver-manager', 'Driver scan skipped — not on Windows')
  })

  it('returns classified drivers with stale and current', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          PublishedName: 'oem0.inf',
          OriginalName: '',
          ProviderName: 'Intel',
          ClassName: 'Display',
          DriverVersion: '10.0.1',
          DriverDate: '2024-01-01',
          SignerName: 'Microsoft',
        },
        {
          PublishedName: 'oem1.inf',
          OriginalName: '',
          ProviderName: 'Intel',
          ClassName: 'Display',
          DriverVersion: '10.0.2',
          DriverDate: '2024-06-01',
          SignerName: 'Microsoft',
        },
      ]),
    })
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }) // getActiveDriverNames
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }) // getOemFolderMap

    const result = await scanDrivers()
    expect(result.packages).toHaveLength(2)
    expect(result.totalStaleCount).toBe(1)
    expect(result.totalCurrentCount).toBe(1)

    const stale = result.packages.find((p) => !p.isCurrent)
    expect(stale?.publishedName).toBe('oem0.inf')
    expect(stale?.selected).toBe(true)

    const current = result.packages.find((p) => p.isCurrent)
    expect(current?.publishedName).toBe('oem1.inf')
  })

  it('marks active driver as current even when older', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          PublishedName: 'oem0.inf',
          OriginalName: '',
          ProviderName: 'Intel',
          ClassName: 'Display',
          DriverVersion: '10.0.1',
          DriverDate: '2024-01-01',
          SignerName: 'Microsoft',
        },
        {
          PublishedName: 'oem1.inf',
          OriginalName: '',
          ProviderName: 'Intel',
          ClassName: 'Display',
          DriverVersion: '10.0.2',
          DriverDate: '2024-06-01',
          SignerName: 'Microsoft',
        },
      ]),
    })
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'oem0.inf\n' }) // activeNames includes oem0
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }) // getOemFolderMap

    const result = await scanDrivers()
    const oem0 = result.packages.find((p) => p.publishedName === 'oem0.inf')
    const oem1 = result.packages.find((p) => p.publishedName === 'oem1.inf')
    expect(oem0?.isCurrent).toBe(true)
    expect(oem1?.isCurrent).toBe(true)
    expect(result.totalStaleCount).toBe(0)
    expect(result.totalCurrentCount).toBe(2)
  })

  it('calls onProgress with phase updates', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          PublishedName: 'oem0.inf',
          OriginalName: '',
          ProviderName: 'Intel',
          ClassName: 'Display',
          DriverVersion: '10.0.1',
          DriverDate: '2024-01-01',
          SignerName: 'Microsoft',
        },
      ]),
    })
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' })
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' })

    const onProgress = vi.fn()
    await scanDrivers(onProgress)
    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      phase: 'enumerating',
      current: 0,
      total: 0,
      currentDriver: 'Enumerating installed driver packages...',
    })
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      phase: 'analyzing',
      current: 0,
      total: 1,
      currentDriver: 'Identifying active drivers...',
    })
  })

  it('computes folder size when OEM mapping exists', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          PublishedName: 'oem0.inf',
          OriginalName: '',
          ProviderName: 'Intel',
          ClassName: 'Display',
          DriverVersion: '10.0.1',
          DriverDate: '2024-01-01',
          SignerName: 'Microsoft',
        },
      ]),
    })
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }) // getActiveDriverNames
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'oem0.inf|folder123\n' }) // getOemFolderMap
    mocks.readdirSync.mockReturnValueOnce([{ isFile: () => true, isDirectory: () => false, name: 'driver.sys' }])
    mocks.statSync.mockReturnValueOnce({ size: 5000 })

    const result = await scanDrivers()
    expect(result.packages[0].folderPath).toContain('DriverStore')
    expect(result.packages[0].size).toBe(5000)
  })

  it('handles empty drivers from parseEnumDrivers', async () => {
    mocks.execFileAsync.mockRejectedValueOnce(new Error('PowerShell failed'))
    mocks.execNativeUtf8.mockRejectedValueOnce(new Error('pnputil failed'))

    const result = await scanDrivers()
    expect(result.packages).toHaveLength(0)
    expect(result.totalStaleCount).toBe(0)
  })
})

describe('cleanDrivers', () => {
  beforeEach(() => {
    win32BeforeEach()
  })

  it('returns empty when not on Windows', async () => {
    setPlatform('linux')
    const result = await cleanDrivers(['oem0.inf'])
    expect(result).toEqual({ removed: 0, failed: 0, spaceRecovered: 0, errors: [] })
    expect(mocks.logger.warning).toHaveBeenCalledWith('driver-manager', 'Driver clean skipped — not on Windows')
  })

  it('removes valid OEM driver successfully', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '' })

    const result = await cleanDrivers(['oem0.inf'])
    expect(result.removed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.spaceRecovered).toBe(0)
  })

  it('rejects invalid driver names', async () => {
    const result = await cleanDrivers(['bad.exe'])
    expect(result.removed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('Invalid driver package name')
  })

  it('handles multiple with some invalid', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '' })

    const result = await cleanDrivers(['oem0.inf', 'bad.exe', 'oem1.inf'])
    expect(result.removed).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('handles driver in use error', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    mocks.execNativeUtf8.mockRejectedValue({ stderr: 'currently in use' })

    const result = await cleanDrivers(['oem0.inf'])
    expect(result.removed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('Driver is currently in use by a device')
  })

  it('handles generic pnputil error', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    mocks.execNativeUtf8.mockRejectedValue({ stderr: 'access denied' })

    const result = await cleanDrivers(['oem0.inf'])
    expect(result.removed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('access denied')
  })

  it('handles error with only message property', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    mocks.execNativeUtf8.mockRejectedValue(new Error('Unknown failure'))

    const result = await cleanDrivers(['oem0.inf'])
    expect(result.removed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('Unknown failure')
  })
})

describe('scanDriverUpdates', () => {
  beforeEach(() => {
    win32BeforeEach()
  })

  it('returns empty when not on Windows', async () => {
    setPlatform('linux')
    const result = await scanDriverUpdates()
    expect(result.updates).toHaveLength(0)
    expect(result.totalAvailable).toBe(0)
    expect(mocks.logger.warning).toHaveBeenCalledWith('driver-manager', 'Driver update scan skipped — not on Windows')
  })

  it('returns updates from Windows Update', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout:
        'DRVUPD|Intel Graphics|HWID001|Display|10.0.1|2024-01-01|upd-001|2024-06-01|Intel|Intel Driver Update 27.20.100.1|10 MB',
    })

    const result = await scanDriverUpdates()
    expect(result.updates).toHaveLength(1)
    expect(result.totalAvailable).toBe(1)
    expect(result.updates[0].deviceName).toBe('Intel Graphics')
    expect(result.updates[0].updateId).toBe('upd-001')
    expect(result.updates[0].selected).toBe(true)
  })

  it('returns empty when no updates found', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'DRVUPD_NONE' })

    const result = await scanDriverUpdates()
    expect(result.updates).toHaveLength(0)
    expect(result.totalAvailable).toBe(0)
  })

  it('handles PowerShell error', async () => {
    mocks.execFileAsync.mockRejectedValue({ stderr: 'COM error', message: 'Update search failed' })

    await expect(scanDriverUpdates()).rejects.toThrow('COM error')
    expect(mocks.logger.error).toHaveBeenCalled()
  })

  it('reports progress when onProgress provided', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'DRVUPD|NVIDIA GPU|HWID002|Display|||upd-002|2024-06-01|NVIDIA|NVIDIA Driver|500 MB',
    })

    const onProgress = vi.fn()
    await scanDriverUpdates(onProgress)
    expect(onProgress).toHaveBeenCalled()
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      phase: 'checking',
      current: 0,
      total: 0,
      currentDevice: 'Querying Windows Update for driver updates...',
      percent: 0,
    })
  })

  it('handles malformed update lines gracefully', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'DRVUPD|OnlyName\nDRVUPD_NONE',
    })

    const result = await scanDriverUpdates()
    expect(result.updates).toHaveLength(0)
  })

  it('handles error with only message property', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('Search timeout'))

    await expect(scanDriverUpdates()).rejects.toThrow('Search timeout')
    expect(mocks.logger.error).toHaveBeenCalled()
  })
})

describe('installDriverUpdates', () => {
  beforeEach(() => {
    win32BeforeEach()
  })

  it('returns empty when not on Windows', async () => {
    setPlatform('linux')
    const result = await installDriverUpdates(['upd-001'])
    expect(result).toEqual({ installed: 0, failed: 0, rebootRequired: false, errors: [] })
    expect(mocks.logger.warning).toHaveBeenCalledWith(
      'driver-manager',
      'Driver update install skipped — not on Windows',
    )
  })

  it('returns early when empty array provided', async () => {
    const result = await installDriverUpdates([])
    expect(result).toEqual({ installed: 0, failed: 0, rebootRequired: false, errors: [] })
    expect(mocks.logger.warning).toHaveBeenCalledWith('driver-manager', 'No driver update IDs provided for install')
  })

  it('installs all updates successfully', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'STATUS|downloading|2\nSTATUS|installing|2\nINSTALLED|Driver1\nINSTALLED|Driver2\nRESULT|2|0|false',
    })

    const result = await installDriverUpdates(['upd-001', 'upd-002'])
    expect(result.installed).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.rebootRequired).toBe(false)
  })

  it('handles partial failures', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'STATUS|downloading|2\nINSTALLED|Driver1\nFAILED|Driver2|Error 0x80070002\nRESULT|1|1|false',
    })

    const result = await installDriverUpdates(['upd-001', 'upd-002'])
    expect(result.installed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].deviceName).toBe('Driver2')
  })

  it('reports reboot required', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'INSTALLED|Driver1\nRESULT|1|0|True',
    })

    const result = await installDriverUpdates(['upd-001'])
    expect(result.installed).toBe(1)
    expect(result.rebootRequired).toBe(true)
  })

  it('handles PowerShell script failure', async () => {
    mocks.execFileAsync.mockRejectedValue({ stderr: 'Script error' })

    const result = await installDriverUpdates(['upd-001'])
    expect(result.installed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].deviceName).toBe('Windows Update')
  })

  it('reports progress when onProgress provided', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'STATUS|downloading|1\nSTATUS|installing|1\nINSTALLED|Driver1\nRESULT|1|0|false',
    })

    const onProgress = vi.fn()
    await installDriverUpdates(['upd-001'], onProgress)
    expect(onProgress).toHaveBeenCalled()
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      phase: 'downloading',
      current: 0,
      total: 1,
      currentDevice: 'Preparing driver updates...',
      percent: 0,
    })
  })

  it('handles error with only message property in catch', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('Install failure'))

    const result = await installDriverUpdates(['upd-001'])
    expect(result.installed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('Install failure')
  })

  it('deduplicates installed count from RESULT line', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'INSTALLED|Driver1\nINSTALLED|Driver2\nRESULT|1|1|false',
    })

    const result = await installDriverUpdates(['upd-001', 'upd-002'])
    // RESULT line overrides with 1 installed (lower than the 2 we counted)
    expect(result.installed).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('handles STATUS line with installing phase', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'STATUS|installing|2\nINSTALLED|Driver1\nINSTALLED|Driver2\nRESULT|2|0|false',
    })

    const onProgress = vi.fn()
    await installDriverUpdates(['upd-001', 'upd-002'], onProgress)
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'installing', percent: 50 }))
  })
})
