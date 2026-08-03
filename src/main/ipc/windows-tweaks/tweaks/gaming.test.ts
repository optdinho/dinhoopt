import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileAsyncMock, mockHandlers, mockLogger } = vi.hoisted(() => {
  const execFileAsyncMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockLogger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() }
  return { execFileAsyncMock, mockHandlers, mockLogger }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
      return handler
    }),
  },
}))

vi.mock('../../../services/exec-utf8', () => ({
  execFileAsync: execFileAsyncMock,
}))

vi.mock('../../../services/logger.service', () => ({
  getLogger: () => mockLogger,
}))

import { IPC } from '@shared/channels'
import { registerGamingTweaks } from './gaming'

let bcdOut = ''
let netshOut = ''
let vbsOut = ''
let pfsOut = ''
let hagsOut = ''
const failArgs = new Set<string>()

function key(file: string, args: string[]): string {
  return `${file}|${args.join(' ')}`
}

beforeEach(() => {
  mockHandlers.clear()
  execFileAsyncMock.mockReset()
  bcdOut = ''
  netshOut = ''
  vbsOut = ''
  pfsOut = ''
  hagsOut = ''
  failArgs.clear()
  mockLogger.info.mockReset()
  mockLogger.warning.mockReset()
  mockLogger.error.mockReset()
  mockLogger.success.mockReset()
  mockLogger.debug.mockReset()

  execFileAsyncMock.mockImplementation(async (file: string, args: string[]) => {
    const k = key(file, args)
    if (failArgs.has(k)) throw new Error(`command failed: ${k}`)
    if (file === 'bcdedit' && args[0] === '/enum') return { stdout: bcdOut, stderr: '' }
    if (file === 'netsh' && args[0] === 'int' && args[1] === 'tcp' && args[2] === 'show') {
      return { stdout: netshOut, stderr: '' }
    }
    if (file === 'reg.exe') {
      const joined = args.join(' ')
      if (joined.includes('EnableVirtualizationBasedSecurity')) return { stdout: vbsOut, stderr: '' }
      if (joined.includes('RequirePlatformSecurityFeatures')) return { stdout: pfsOut, stderr: '' }
      if (joined.includes('HwSchMode')) return { stdout: hagsOut, stderr: '' }
    }
    return { stdout: '', stderr: '' }
  })
})

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const h = mockHandlers.get(channel)
  if (!h) throw new Error(`Handler not registered for ${channel}`)
  return h
}

describe('registerGamingTweaks', () => {
  it('logs registration and registers all 8 gaming tweak channels', () => {
    registerGamingTweaks(() => null)
    expect(mockLogger.info).toHaveBeenCalledWith('windows-tweaks', 'Registering gaming/timer tweak handlers')
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_VBS_SET)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_GAMING_HAGS_SET)).toBe(true)
  })
})

describe('TIMER_GET', () => {
  it('parses bcdedit/netsh output into the full timer status', async () => {
    registerGamingTweaks(() => null)
    bcdOut = 'useplatformclock       No\ndisabledynamictick     Yes\ntscsyncpolicy          Enhanced'
    netshOut = 'TCP Global Parameters\nReceive-Side Scaling State          : disabled'
    const status = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET)()) as {
      hpetOff: boolean
      tscSyncPolicy: string
      dynamicTickDisabled: boolean
      autoTuningDisabled: boolean
    }
    expect(status.hpetOff).toBe(true)
    expect(status.dynamicTickDisabled).toBe(true)
    expect(status.tscSyncPolicy).toBe('enhanced')
    expect(status.autoTuningDisabled).toBe(true)
  })

  it('treats an explicit Yes/other values and missing keys as defaults', async () => {
    registerGamingTweaks(() => null)
    bcdOut = 'useplatformclock       Yes\ntscsyncpolicy          Legacy'
    netshOut = 'autotuninglevel=normal'
    const status = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET)()) as {
      hpetOff: boolean
      tscSyncPolicy: string
      dynamicTickDisabled: boolean
      autoTuningDisabled: boolean
    }
    expect(status.hpetOff).toBe(false)
    expect(status.tscSyncPolicy).toBe('legacy')
    expect(status.dynamicTickDisabled).toBe(false)
    expect(status.autoTuningDisabled).toBe(false)
  })

  it('defaults when both command outputs are unavailable', async () => {
    registerGamingTweaks(() => null)
    const status = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET)()) as {
      tscSyncPolicy: string
      autoTuningDisabled: boolean
    }
    expect(status.tscSyncPolicy).toBe('default')
    expect(status.autoTuningDisabled).toBe(false)
  })

  it('falls through to default when tsc value matches neither legacy nor enhanced', async () => {
    registerGamingTweaks(() => null)
    bcdOut = 'tscsyncpolicy          Performance'
    const status = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET)()) as { tscSyncPolicy: string }
    expect(status.tscSyncPolicy).toBe('default')
  })
})

describe('TIMER_SET', () => {
  it('applies all provided settings and returns success', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)(null, {
      hpetOff: true,
      tscSyncPolicy: 'legacy',
      dynamicTickDisabled: true,
    })) as { success: boolean; errors: string[] }
    expect(res.success).toBe(true)
    expect(res.errors).toEqual([])
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/set', 'useplatformclock', 'false'], expect.any(Object))
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/set', 'tscsyncpolicy', 'legacy'], expect.any(Object))
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/set', 'disabledynamictick', 'yes'], expect.any(Object))
  })

  it('uses deletevalue branches when disabling', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)(null, {
      hpetOff: false,
      tscSyncPolicy: 'default',
      dynamicTickDisabled: false,
    })) as { success: boolean; errors: string[] }
    expect(res.success).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/deletevalue', 'useplatformclock'], expect.any(Object))
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/deletevalue', 'tscsyncpolicy'], expect.any(Object))
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'bcdedit',
      ['/deletevalue', 'disabledynamictick'],
      expect.any(Object),
    )
  })

  it('ignores undefined fields', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)(null, { hpetOff: true })) as {
      success: boolean
      errors: string[]
    }
    expect(res.success).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('collects per-key errors and returns failure', async () => {
    registerGamingTweaks(() => null)
    failArgs.add(key('bcdedit', ['/set', 'useplatformclock', 'false']))
    failArgs.add(key('bcdedit', ['/set', 'tscsyncpolicy', 'enhanced']))
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)(null, {
      hpetOff: true,
      tscSyncPolicy: 'enhanced',
      dynamicTickDisabled: false,
    })) as { success: boolean; errors: string[] }
    expect(res.success).toBe(false)
    expect(res.errors).toHaveLength(2)
    expect(res.errors[0]).toContain('HPET:')
    expect(res.errors[1]).toContain('TSC Sync:')
    expect(mockLogger.error).toHaveBeenCalledWith('windows-tweaks', expect.stringContaining('Gaming timer errors:'))
  })

  it('leaves unspecified keys untouched', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)(null, { tscSyncPolicy: 'legacy' })) as {
      success: boolean
      errors: string[]
    }
    expect(res.success).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/set', 'tscsyncpolicy', 'legacy'], expect.any(Object))
  })

  it('reports a failure from the dynamic tick arm', async () => {
    registerGamingTweaks(() => null)
    failArgs.add(key('bcdedit', ['/set', 'disabledynamictick', 'yes']))
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET)(null, {
      hpetOff: true,
      dynamicTickDisabled: true,
    })) as { success: boolean; errors: string[] }
    expect(res.success).toBe(false)
    expect(res.errors).toEqual([expect.stringContaining('Dynamic Tick:')])
  })
})

describe('TIMER_REVERT', () => {
  it('reverts all four settings on success', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT)()) as { success: boolean; errors: string[] }
    expect(res.success).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/deletevalue', 'useplatformclock'], expect.any(Object))
    expect(execFileAsyncMock).toHaveBeenCalledWith('bcdedit', ['/deletevalue', 'tscsyncpolicy'], expect.any(Object))
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'bcdedit',
      ['/deletevalue', 'disabledynamictick'],
      expect.any(Object),
    )
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'netsh',
      ['int', 'tcp', 'set', 'global', 'autotuninglevel=normal'],
      expect.any(Object),
    )
    expect(mockLogger.success).toHaveBeenCalledWith('windows-tweaks', 'Gaming timer reverted to defaults')
  })

  it('reports failures without aborting remaining reverts', async () => {
    registerGamingTweaks(() => null)
    failArgs.add(key('netsh', ['int', 'tcp', 'set', 'global', 'autotuninglevel=normal']))
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT)()) as { success: boolean; errors: string[] }
    expect(res.success).toBe(false)
    expect(res.errors).toEqual([expect.stringContaining('TCP AutoTuning revert:')])
    expect(mockLogger.error).toHaveBeenCalledWith(
      'windows-tweaks',
      expect.stringContaining('Gaming timer revert errors:'),
    )
  })
})

describe('AUTOTUNING', () => {
  it('applies the disabled level', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING)(null, 'apply')) as { success: boolean }
    expect(res.success).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'netsh',
      ['int', 'tcp', 'set', 'global', 'autotuninglevel=disabled'],
      expect.any(Object),
    )
  })

  it('restores the normal level', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING)(null, 'revert')) as { success: boolean }
    expect(res.success).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'netsh',
      ['int', 'tcp', 'set', 'global', 'autotuninglevel=normal'],
      expect.any(Object),
    )
  })
})

describe('VBS_GET', () => {
  it('reports enabled when the reg value is 0x1', async () => {
    registerGamingTweaks(() => null)
    vbsOut = 'EnableVirtualizationBasedSecurity  REG_DWORD  0x1'
    pfsOut = 'RequirePlatformSecurityFeatures    REG_DWORD  0x2'
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET)()) as {
      enabled: boolean
      requirePlatformSecurity: number
    }
    expect(res.enabled).toBe(true)
    expect(res.requirePlatformSecurity).toBe(2)
  })

  it('reports disabled when the reg value is 0x0', async () => {
    registerGamingTweaks(() => null)
    vbsOut = 'EnableVirtualizationBasedSecurity  REG_DWORD  0x0'
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET)()) as { enabled: boolean }
    expect(res.enabled).toBe(false)
  })

  it('defaults to enabled when the value is missing or the query fails', async () => {
    registerGamingTweaks(() => null)
    vbsOut = 'unrelated output'
    const missing = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET)()) as {
      enabled: boolean
      requirePlatformSecurity: number
    }
    expect(missing.enabled).toBe(true)
    expect(missing.requirePlatformSecurity).toBe(1)

    failArgs.add(
      key('reg.exe', [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard',
        '/v',
        'EnableVirtualizationBasedSecurity',
      ]),
    )
    const failed = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET)()) as {
      enabled: boolean
      requirePlatformSecurity: number
    }
    expect(failed).toEqual({ enabled: true, requirePlatformSecurity: 1 })
  })
})

describe('VBS_SET', () => {
  it('writes both reg values for enable', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_SET)(null, true)) as { success: boolean }
    expect(res.success).toBe(true)
    const addCalls = execFileAsyncMock.mock.calls.filter(
      (c) =>
        c[0] === 'reg.exe' &&
        Array.isArray(c[1]) &&
        c[1].some((a) => typeof a === 'string' && a.includes('DeviceGuard')),
    )
    expect(addCalls).toHaveLength(2)
    expect(addCalls[0]![1]).toContain('EnableVirtualizationBasedSecurity')
    expect(addCalls[1]![1]).toContain('RequirePlatformSecurityFeatures')
  })

  it('writes zero values for disable', async () => {
    registerGamingTweaks(() => null)
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_SET)(null, false)) as { success: boolean }
    expect(res.success).toBe(true)
    const addCalls = execFileAsyncMock.mock.calls.filter(
      (c) =>
        c[0] === 'reg.exe' &&
        Array.isArray(c[1]) &&
        c[1].some((a) => typeof a === 'string' && a.includes('DeviceGuard')),
    )
    expect(addCalls).toHaveLength(2)
    expect(addCalls[0]![1]).toContain('/d')
    expect(addCalls[0]![1]).toContain('0')
  })

  it('returns an error when a reg write fails', async () => {
    registerGamingTweaks(() => null)
    failArgs.add(
      key('reg.exe', [
        'add',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard',
        '/v',
        'EnableVirtualizationBasedSecurity',
        '/t',
        'REG_DWORD',
        '/d',
        '1',
        '/f',
      ]),
    )
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_VBS_SET)(null, true)) as { success: boolean; error: string }
    expect(res.success).toBe(false)
    expect(res.error).toContain('command failed')
  })
})

describe('HAGS_GET', () => {
  it('reports enabled when HwSchMode is 0x2', async () => {
    registerGamingTweaks(() => null)
    hagsOut = 'HwSchMode  REG_DWORD  0x2'
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET)()) as { enabled: boolean }
    expect(res.enabled).toBe(true)
  })

  it('reports disabled for other values, missing match, and query failure', async () => {
    registerGamingTweaks(() => null)
    hagsOut = 'HwSchMode  REG_DWORD  0x1'
    expect(((await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET)()) as { enabled: boolean }).enabled).toBe(false)

    hagsOut = 'unrelated'
    expect(((await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET)()) as { enabled: boolean }).enabled).toBe(true)

    failArgs.add(
      key('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', '/v', 'HwSchMode']),
    )
    expect(((await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET)()) as { enabled: boolean }).enabled).toBe(true)
  })
})

describe('HAGS_SET', () => {
  it('writes 2 for enable and 1 for disable', async () => {
    registerGamingTweaks(() => null)
    const on = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_SET)(null, true)) as { success: boolean }
    expect(on.success).toBe(true)
    const onCall = execFileAsyncMock.mock.calls.find((c) => c[0] === 'reg.exe')!
    expect(onCall[1]).toContain('HwSchMode')
    expect(onCall[1]).toContain('/d')
    expect(onCall[1]).toContain('2')

    execFileAsyncMock.mockClear()
    const off = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_SET)(null, false)) as { success: boolean }
    expect(off.success).toBe(true)
    const offCall = execFileAsyncMock.mock.calls.find((c) => c[0] === 'reg.exe')!
    expect(offCall[1]).toContain('1')
  })

  it('returns an error when the reg write fails', async () => {
    registerGamingTweaks(() => null)
    failArgs.add(
      key('reg.exe', [
        'add',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
        '/v',
        'HwSchMode',
        '/t',
        'REG_DWORD',
        '/d',
        '1',
        '/f',
      ]),
    )
    const res = (await getHandler(IPC.WINDOWS_TWEAKS_GAMING_HAGS_SET)(null, false)) as {
      success: boolean
      error: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toContain('command failed')
  })
})
