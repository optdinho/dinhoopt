import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFileAsync = vi.fn()

vi.mock('./exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  psUtf8: (s: string) => s,
}))

import type { GameModeConfig, GameModeSnapshot } from '@shared/types'
import {
  auditAntiCheatRisk,
  auditConsent,
  auditOrphanProcesses,
  auditPlatformCompatibility,
  auditRegistryTweakImpact,
  auditRestoreCompleteness,
  auditServiceHealth,
  auditTimerResolution,
  runGameModeAudit,
} from './game-mode-audit'

beforeEach(() => {
  vi.clearAllMocks()
})

function mockPsSuccess(stdout: string) {
  mockExecFileAsync.mockResolvedValue({ stdout, stderr: '' })
}

function mockTasklistSuccess(processes: string[]) {
  const csv = processes.map((p) => `"${p}","1234"`).join('\n')
  mockExecFileAsync.mockResolvedValue({ stdout: csv, stderr: '' })
}

function mockFailure(message: string) {
  mockExecFileAsync.mockRejectedValue(new Error(message))
}

describe('auditServiceHealth', () => {
  it('reports passed when service is stopped and disabled', async () => {
    mockPsSuccess('{ "Status": "Stopped", "StartType": "Disabled" }')
    const checks = await auditServiceHealth([{ name: 'WSearch', originalStartType: 'Automatic', wasRunning: true }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
    expect(checks[0]!.severity).toBe('info')
  })

  it('reports warning when service is still running', async () => {
    mockPsSuccess('{ "Status": "Running", "StartType": "Automatic" }')
    const checks = await auditServiceHealth([{ name: 'WSearch', originalStartType: 'Automatic', wasRunning: true }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
  })

  it('reports error when service query fails', async () => {
    mockFailure('Service not found')
    const checks = await auditServiceHealth([{ name: 'WSearch', originalStartType: 'Automatic', wasRunning: true }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('error')
  })

  it('handles multiple services', async () => {
    mockPsSuccess('{ "Status": "Stopped", "StartType": "Disabled" }')
    const checks = await auditServiceHealth([
      { name: 'WSearch', originalStartType: 'Automatic', wasRunning: true },
      { name: 'SysMain', originalStartType: 'Manual', wasRunning: false },
    ])
    expect(checks).toHaveLength(2)
    expect(checks.every((c) => c.passed)).toBe(true)
  })
})

describe('auditOrphanProcesses', () => {
  it('returns empty when no processes were killed', async () => {
    const checks = await auditOrphanProcesses([])
    expect(checks).toEqual([])
  })

  it('reports passed when all killed processes are gone', async () => {
    mockTasklistSuccess(['svchost.exe', 'explorer.exe'])
    const checks = await auditOrphanProcesses([{ pid: 1234, name: 'chrome.exe' }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('reports warning when some processes are still running', async () => {
    mockTasklistSuccess(['chrome.exe', 'explorer.exe'])
    const checks = await auditOrphanProcesses([
      { pid: 1234, name: 'chrome.exe' },
      { pid: 5678, name: 'discord.exe' },
    ])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
    expect(checks[0]!.details).toContain('chrome.exe')
  })

  it('handles tasklist failure gracefully', async () => {
    mockFailure('tasklist failed')
    const checks = await auditOrphanProcesses([{ pid: 1234, name: 'chrome.exe' }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })
})

describe('auditAntiCheatRisk', () => {
  it('reports passed when no anti-cheat processes are running', async () => {
    mockTasklistSuccess(['svchost.exe', 'explorer.exe'])
    const checks = await auditAntiCheatRisk(['sys-timer-resolution', 'net-disable-nagle'])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('reports warning when anti-cheat is detected with conflicts', async () => {
    mockTasklistSuccess(['EasyAntiCheat.exe', 'explorer.exe'])
    const checks = await auditAntiCheatRisk(['sys-timer-resolution', 'net-disable-nagle'])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
    expect(checks[0]!.category).toBe('anti-cheat')
    expect(checks[0]!.details).toContain('EasyAntiCheat.exe')
  })

  it('reports multiple anti-cheat conflicts', async () => {
    mockTasklistSuccess(['EasyAntiCheat.exe', 'vgc.exe'])
    const checks = await auditAntiCheatRisk(['sys-timer-resolution', 'sys-disable-game-bar'])
    expect(checks).toHaveLength(2)
    expect(checks.every((c) => !c.passed)).toBe(true)
  })

  it('ignores running anti-cheat when no conflicting opts are active', async () => {
    mockTasklistSuccess(['EasyAntiCheat.exe'])
    const checks = await auditAntiCheatRisk(['svc-wsearch'])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('handles tasklist failure', async () => {
    mockFailure('tasklist failed')
    const checks = await auditAntiCheatRisk(['sys-timer-resolution'])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })
})

describe('auditPlatformCompatibility', () => {
  const origPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform })
  })

  it('reports passed on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const checks = await auditPlatformCompatibility()
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('reports warning on non-win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const checks = await auditPlatformCompatibility()
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
  })
})

describe('auditRegistryTweakImpact', () => {
  it('returns empty when no tweaks were applied', async () => {
    const checks = await auditRegistryTweakImpact([])
    expect(checks).toEqual([])
  })

  it('reports passed when tweak was applied to 0', async () => {
    mockPsSuccess('0')
    const checks = await auditRegistryTweakImpact([{ path: 'HKCU:\\Test', name: 'TestVal', originalValue: 1 }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('reports passed when tweak had no previous value and current is 0', async () => {
    mockPsSuccess('0')
    const checks = await auditRegistryTweakImpact([{ path: 'HKCU:\\NullVal', name: 'NullVal', originalValue: null }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
    expect(checks[0]!.details).toContain('had no previous value')
  })

  it('reports warning when tweak value is not 0', async () => {
    mockPsSuccess('1')
    const checks = await auditRegistryTweakImpact([{ path: 'HKCU:\\Test', name: 'TestVal', originalValue: 1 }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
  })

  it('handles registry read error gracefully', async () => {
    mockFailure('Cannot find path')
    const checks = await auditRegistryTweakImpact([{ path: 'HKCU:\\Test', name: 'TestVal', originalValue: 1 }])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('error')
  })
})

describe('auditRestoreCompleteness', () => {
  it('reports passed when no errors occurred', async () => {
    const checks = await auditRestoreCompleteness([])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('reports error when there are restore errors', async () => {
    const checks = await auditRestoreCompleteness(['Failed to restore WSearch', 'Failed to restore power plan'])
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('error')
    expect(checks[0]!.details).toContain('2')
  })
})

describe('auditConsent', () => {
  it('reports passed when no permanent tweaks', async () => {
    const checks = await auditConsent(false)
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
  })

  it('reports warning when permanent tweaks exist', async () => {
    const checks = await auditConsent(true)
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
  })
})

describe('auditTimerResolution', () => {
  it('reports passed when timer was not modified', async () => {
    const checks = await auditTimerResolution(null)
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
    expect(checks[0]!.details).toContain('was not modified')
  })

  it('reports passed when timer was applied', async () => {
    const checks = await auditTimerResolution(1)
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(true)
    expect(checks[0]!.details).toContain('NtSetTimerResolution')
  })
})

describe('runGameModeAudit', () => {
  const mockSnapshot: GameModeSnapshot = {
    activatedAt: '2025-01-01T00:00:00Z',
    active: true,
    services: [{ name: 'WSearch', originalStartType: 'Automatic', wasRunning: true }],
    killedProcesses: [{ pid: 1234, name: 'chrome.exe' }],
    originalPowerPlanGuid: null,
    originalFocusAssistState: null,
    powerSaveBlockerId: null,
    originalTimerResolution: 156250,
    nagleInterfaces: [],
    registryTweaks: [{ path: 'HKCU:\\Test', name: 'TestVal', originalValue: 1 }],
    gameProcessPriorities: [],
  }

  const mockConfig: GameModeConfig = {
    enabledOptimizations: ['sys-timer-resolution', 'svc-wsearch'],
    customProcessKillList: [],
    autoDetect: false,
    autoDeactivate: true,
    customGameProcesses: [],
    gameProfiles: {},
  }

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  it('runs pre-activation audit', async () => {
    mockTasklistSuccess(['svchost.exe'])
    const report = await runGameModeAudit('pre-activation', { config: mockConfig })
    expect(report.phase).toBe('pre-activation')
    expect(report.checks.length).toBeGreaterThan(0)
    expect(report.summary.passed + report.summary.warnings + report.summary.errors).toBe(report.checks.length)
  })

  it('runs post-activation audit', async () => {
    mockPsSuccess('{ "Status": "Stopped", "StartType": "Disabled" }')
    mockTasklistSuccess(['svchost.exe'])
    const report = await runGameModeAudit('post-activation', {
      config: mockConfig,
      snapshot: mockSnapshot,
    })
    expect(report.phase).toBe('post-activation')
    expect(report.checks.length).toBeGreaterThan(0)
  })

  it('runs pre-deactivation audit', async () => {
    mockPsSuccess('{ "Status": "Stopped", "StartType": "Disabled" }')
    const report = await runGameModeAudit('pre-deactivation', { snapshot: mockSnapshot })
    expect(report.phase).toBe('pre-deactivation')
    expect(report.checks.length).toBeGreaterThan(0)
  })

  it('runs post-restore audit with errors', async () => {
    mockPsSuccess('{ "Status": "Stopped", "StartType": "Disabled" }')
    const report = await runGameModeAudit('post-restore', {
      snapshot: mockSnapshot,
      errors: ['Failed to restore power plan'],
    })
    expect(report.phase).toBe('post-restore')
    expect(report.checks.length).toBeGreaterThan(0)
    const restoreCheck = report.checks.find((c) => c.id === 'restore-completeness')
    expect(restoreCheck).toBeDefined()
    expect(restoreCheck!.passed).toBe(false)
  })
})
