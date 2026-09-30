import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  execFileAsync: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psArgs: (s: string) => ['-NoProfile', '-NonInteractive', '-Command', s],
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { IPC } from '@shared/channels'
import {
  buildServiceScript,
  parseStatusLine,
  registerStopedServicesIpc,
  scanStopedServices,
  setAllStopedServices,
  setStopedService,
} from './stoped-services.ipc'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  setPlatform('win32')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

// ── parseStatusLine ───────────────────────────────────────────

describe('parseStatusLine', () => {
  it('parses a running service', () => {
    expect(parseStatusLine('PcaSvc|Running|Auto')).toEqual({
      id: 'PcaSvc',
      running: true,
      startType: 'Automatic',
    })
  })

  it('parses a stopped service', () => {
    expect(parseStatusLine('DiagTrack|Stopped|Disabled')).toEqual({
      id: 'DiagTrack',
      running: false,
      startType: 'Disabled',
    })
  })

  it('maps AutoDelayed to AutomaticDelayed', () => {
    expect(parseStatusLine('SysMain|Running|AutoDelayed')?.startType).toBe('AutomaticDelayed')
  })

  it('maps unknown start modes to Unknown', () => {
    expect(parseStatusLine('EventLog|Stopped|Whatever')?.startType).toBe('Unknown')
  })

  it('is case-insensitive on the state field', () => {
    expect(parseStatusLine('DPS|RUNNING|AUTO')?.running).toBe(true)
  })

  it('rejects ids outside the catalog', () => {
    expect(parseStatusLine('Spooler|Running|Auto')).toBeNull()
  })

  it('rejects malformed lines', () => {
    expect(parseStatusLine('PcaSvc|Running')).toBeNull()
    expect(parseStatusLine('')).toBeNull()
  })
})

// ── buildServiceScript ────────────────────────────────────────

describe('buildServiceScript', () => {
  it('enabling sets Automatic startup AND starts the service', () => {
    const script = buildServiceScript('PcaSvc', true)
    expect(script).toContain("Set-Service -Name 'PcaSvc' -StartupType Automatic")
    expect(script).toContain("Start-Service -Name 'PcaSvc'")
  })

  it('enabling only starts the service when it is not already running', () => {
    const script = buildServiceScript('PcaSvc', true)
    expect(script).toContain("Get-Service -Name 'PcaSvc'")
    expect(script).not.toContain('-StartupType Manual')
  })

  it('disabling stops the service and sets Disabled startup', () => {
    const script = buildServiceScript('DPS', false)
    expect(script).toContain("Stop-Service -Name 'DPS' -Force")
    expect(script).toContain("Set-Service -Name 'DPS' -StartupType Disabled")
  })

  it('disabling does not call Start-Service', () => {
    expect(buildServiceScript('DPS', false)).not.toContain('Start-Service')
  })

  it('emits OK/FAIL markers for result parsing', () => {
    const script = buildServiceScript('EventLog', true)
    expect(script).toContain("Write-Output 'OK|EventLog'")
    expect(script).toContain("Write-Output 'FAIL|EventLog|'")
  })

  it('sanitizes pipes and newlines out of PowerShell error messages', () => {
    const script = buildServiceScript('SysMain', false)
    expect(script).toContain("-replace '\\|'")
    expect(script).toContain("-replace '\\r?\\n'")
  })
})

// ── scanStopedServices ────────────────────────────────────────

describe('scanStopedServices', () => {
  it('returns one entry per catalog service', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'SVC|PcaSvc|Running|Auto\n' })
    const result = await scanStopedServices()
    expect(result.services).toHaveLength(7)
    expect(result.services.map((s) => s.id)).toEqual([
      'PcaSvc',
      'DPS',
      'DiagTrack',
      'SysMain',
      'EventLog',
      'ADPSvc',
      'UmRdpService',
    ])
  })

  it('reports running and stopped counts correctly', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: [
        'SVC|PcaSvc|Running|Auto',
        'SVC|DPS|Running|Auto',
        'SVC|DiagTrack|Stopped|Disabled',
        'SVC|SysMain|Running|Auto',
        'SVC|EventLog|Running|Auto',
        'SVC|ADPSvc|Running|Auto',
        'SVC|UmRdpService|Stopped|Manual',
      ].join('\n'),
    })
    const result = await scanStopedServices()
    expect(result.runningCount).toBe(5)
    expect(result.stoppedCount).toBe(2)
    expect(result.missingCount).toBe(0)
  })

  it('marks services absent from the SCM output as not found', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'SVC|PcaSvc|Running|Auto\nMISS|UmRdpService\n',
    })
    const result = await scanStopedServices()
    const umrdp = result.services.find((s) => s.id === 'UmRdpService')
    expect(umrdp?.found).toBe(false)
    expect(umrdp?.running).toBe(false)
    expect(umrdp?.startType).toBe('Unknown')
    expect(result.missingCount).toBe(6)
  })

  it('exposes the real service name on each entry', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'SVC|ADPSvc|Running|Auto\n' })
    const result = await scanStopedServices()
    expect(result.services.find((s) => s.id === 'ADPSvc')?.name).toBe('ADPSvc')
  })

  it('returns a safe all-missing result when PowerShell throws', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('boom'))
    const result = await scanStopedServices()
    expect(result.services).toHaveLength(7)
    expect(result.runningCount).toBe(0)
    expect(result.missingCount).toBe(7)
  })

  it('ignores SCM output for services outside the catalog', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'SVC|Spooler|Running|Auto\n' })
    const result = await scanStopedServices()
    expect(result.services.every((s) => !s.found)).toBe(true)
  })

  it('returns not-found entries on non-Windows without executing anything', async () => {
    setPlatform('linux')
    const result = await scanStopedServices()
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
    expect(result.missingCount).toBe(7)
  })
})

// ── setStopedService ──────────────────────────────────────────

describe('setStopedService', () => {
  it('reports success and flags a reboot when the OK marker is printed', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|PcaSvc\n' })
    const result = await setStopedService('PcaSvc', true)
    expect(result).toEqual({
      success: true,
      changed: ['PcaSvc'],
      failed: [],
      rebootRequired: true,
    })
  })

  it('always flags a reboot requirement after a successful change', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|DPS\n' })
    const result = await setStopedService('DPS', false)
    expect(result.rebootRequired).toBe(true)
  })

  it('surfaces the PowerShell failure reason', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'FAIL|EventLog|Access is denied\n' })
    const result = await setStopedService('EventLog', false)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Access is denied')
    expect(result.rebootRequired).toBe(false)
    expect(result.failed).toEqual([{ id: 'EventLog', error: 'Access is denied' }])
  })

  it('treats empty output as a failure', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    const result = await setStopedService('SysMain', true)
    expect(result.success).toBe(false)
    expect(result.error).toBe('No response from Service Control Manager')
  })

  it('rejects unknown service ids without executing PowerShell', async () => {
    const result = await setStopedService('Spooler', false)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Unknown service')
    expect(result.rebootRequired).toBe(false)
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })

  it('rejects non-string ids without executing PowerShell', async () => {
    const result = await setStopedService(42, true)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Unknown service')
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean enabled flag', async () => {
    const result = await setStopedService('PcaSvc', 'yes')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid enabled flag')
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })

  it('reports a thrown exec error as a failure', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('timeout'))
    const result = await setStopedService('DiagTrack', true)
    expect(result.success).toBe(false)
    expect(result.error).toBe('timeout')
  })

  it('passes the enable flag into the generated script', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|ADPSvc\n' })
    await setStopedService('ADPSvc', true)
    const script = mocks.execFileAsync.mock.calls[0]?.[1]?.at(-1) as string
    expect(script).toContain('-StartupType Automatic')
  })
})

// ── setAllStopedServices ──────────────────────────────────────

describe('setAllStopedServices', () => {
  it('enables every catalog service and reports all 7 as changed', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|X\n' })
    const result = await setAllStopedServices(true)
    expect(result.success).toBe(true)
    expect(result.changed).toHaveLength(7)
    expect(result.rebootRequired).toBe(true)
  })

  it('disables every catalog service', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|X\n' })
    const result = await setAllStopedServices(false)
    expect(result.success).toBe(true)
    expect(result.changed).toHaveLength(7)
  })

  it('keeps going when one service fails and records the failure', async () => {
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: 'OK|PcaSvc\n' })
      .mockResolvedValueOnce({ stdout: 'FAIL|DPS|Access is denied\n' })
      .mockResolvedValue({ stdout: 'OK|X\n' })
    const result = await setAllStopedServices(true)
    expect(result.success).toBe(true)
    expect(result.changed).toHaveLength(6)
    expect(result.failed).toEqual([{ id: 'DPS', error: 'Access is denied' }])
  })

  it('reports failure when nothing could be changed', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'FAIL|X|boom\n' })
    const result = await setAllStopedServices(true)
    expect(result.success).toBe(false)
    expect(result.changed).toHaveLength(0)
    expect(result.failed).toHaveLength(7)
    expect(result.rebootRequired).toBe(false)
    expect(result.error).toBe('boom')
  })

  it('rejects a non-boolean flag without executing PowerShell', async () => {
    const result = await setAllStopedServices('on')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid enabled flag')
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })

  it('no-ops on non-Windows', async () => {
    setPlatform('darwin')
    const result = await setAllStopedServices(true)
    expect(result.success).toBe(false)
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })
})

// ── Registration ──────────────────────────────────────────────

describe('registerStopedServicesIpc', () => {
  it('registers the three STOPED channels', () => {
    registerStopedServicesIpc()
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IPC.STOPED_SERVICES_STATUS)
    expect(channels).toContain(IPC.STOPED_SERVICES_SET)
    expect(channels).toContain(IPC.STOPED_SERVICES_SET_ALL)
  })

  it('the status handler returns the scan result', async () => {
    registerStopedServicesIpc()
    mocks.execFileAsync.mockResolvedValue({ stdout: 'SVC|PcaSvc|Running|Auto\n' })
    const handler = mocks.ipcHandle.mock.calls.find((c) => c[0] === IPC.STOPED_SERVICES_STATUS)?.[1] as () => Promise<{
      services: unknown[]
    }>
    const result = await handler()
    expect(result.services).toHaveLength(7)
  })

  it('the set handler forwards id and enabled to the core function', async () => {
    registerStopedServicesIpc()
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|PcaSvc\n' })
    const handler = mocks.ipcHandle.mock.calls.find((c) => c[0] === IPC.STOPED_SERVICES_SET)?.[1] as (
      e: unknown,
      id: unknown,
      enabled: unknown,
    ) => Promise<{ success: boolean }>
    const result = await handler(null, 'PcaSvc', true)
    expect(result.success).toBe(true)
  })
})
