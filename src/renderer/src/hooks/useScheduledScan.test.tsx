// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const mockScanStore = {
  status: 'idle',
  results: [],
  setStatus: vi.fn(),
  setResults: vi.fn(),
  addResults: vi.fn(),
  setProgress: vi.fn(),
  getState: vi.fn(),
}
mockScanStore.getState.mockReturnValue(mockScanStore)

const mockHistoryStore = {
  addEntry: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn(),
}
mockHistoryStore.getState.mockReturnValue(mockHistoryStore)

const mockSettingsStore = {
  settings: { cleaner: { protectRecycleBin: true } },
  getState: vi.fn(),
}
mockSettingsStore.getState.mockReturnValue(mockSettingsStore)

vi.mock('@/stores/scan-store', () => ({
  useScanStore: { getState: () => mockScanStore },
}))

vi.mock('@/stores/history-store', () => ({
  useHistoryStore: { getState: () => mockHistoryStore },
}))

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: { getState: () => mockSettingsStore },
  refreshSettings: vi.fn(),
}))

import { toast } from 'sonner'
import { useScheduledScan } from './useScheduledScan'

function mockWindowDinho() {
  window.dinho = {
    systemScan: vi.fn().mockResolvedValue([]),
    systemClean: vi.fn(),
    browserScan: vi.fn().mockResolvedValue([]),
    browserClean: vi.fn(),
    appScan: vi.fn().mockResolvedValue([]),
    appClean: vi.fn(),
    gamingScan: vi.fn().mockResolvedValue([]),
    gamingClean: vi.fn(),
    recycleBinScan: vi.fn().mockResolvedValue([]),
    recycleBinClean: vi.fn(),
    databaseScan: vi.fn().mockResolvedValue([]),
    databaseClean: vi.fn(),
    shortcutScan: vi.fn().mockResolvedValue([]),
    shortcutClean: vi.fn(),
    environmentScan: vi.fn().mockResolvedValue([]),
    environmentClean: vi.fn(),
    winSxSScan: vi.fn().mockResolvedValue([]),
    winSxSClean: vi.fn().mockResolvedValue({ totalCleaned: 0, filesDeleted: 0 }),
    diskRepairDism: vi.fn().mockResolvedValue({
      success: true,
      needsAdmin: false,
      requiresReboot: false,
      summaryCode: 'dismHealthy',
    }),
    diskRepairSfc: vi.fn().mockResolvedValue({
      success: true,
      needsAdmin: false,
      requiresReboot: false,
      summaryCode: 'sfcHealthy',
    }),
    diskTrimList: vi.fn().mockResolvedValue([]),
    diskTrimRun: vi.fn().mockResolvedValue([]),
    powerPlansList: vi.fn().mockResolvedValue([]),
    powerPlansActivate: vi.fn().mockResolvedValue({ success: true }),
    networkScan: vi.fn().mockResolvedValue([]),
    networkClean: vi.fn().mockResolvedValue({ cleaned: 0 }),
    memoryOptimize: vi.fn().mockResolvedValue({ success: true, freedBytes: 0 }),
    uninstallLeftoversScan: vi.fn().mockResolvedValue([]),
    uninstallLeftoversClean: vi.fn(),
    registryScan: vi.fn().mockResolvedValue([]),
    registryFix: vi.fn(),
    driverUpdateScan: vi.fn().mockResolvedValue({ updates: [] }),
    driverUpdateInstall: vi.fn(),
    driverScan: vi.fn().mockResolvedValue({ packages: [] }),
    driverClean: vi.fn(),
    malwareScan: vi.fn().mockResolvedValue({ threats: [] }),
    malwareQuarantine: vi.fn(),
    privacyScan: vi.fn().mockResolvedValue({ score: 0, total: 0, protected: 0 }),
    startupList: vi.fn().mockResolvedValue([]),
    vulnerabilityScan: vi.fn().mockResolvedValue({ vulnerable: 0 }),
    softwareUpdateCheck: vi.fn().mockResolvedValue({ apps: [], packageManagerName: null }),
    softwareUpdateRun: vi.fn(),
    notifyScheduledScanComplete: vi.fn(),
    scheduleRunComplete: vi.fn(),
    onScheduleRunTrigger: vi.fn(),
  } as never
}

describe('useScheduledScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScanStore.status = 'idle'
    mockScanStore.results = []
    mockSettingsStore.settings.cleaner.protectRecycleBin = true
  })

  it('subscribes to onScheduleRunTrigger on mount', () => {
    window.dinho = {
      onScheduleRunTrigger: vi.fn(() => vi.fn()),
    } as never
    renderHook(() => useScheduledScan())

    expect(window.dinho.onScheduleRunTrigger).toHaveBeenCalledTimes(1)
  })

  it('returns unsubscribe function from onScheduleRunTrigger', () => {
    const unsubscribe = vi.fn()
    window.dinho = {
      onScheduleRunTrigger: vi.fn(() => unsubscribe),
    } as never

    const { unmount } = renderHook(() => useScheduledScan())

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('processes queued trigger and runs cleaner tasks', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    const payload = {
      scheduleId: 'sched-1',
      scheduleName: 'Weekly Clean',
      tasks: ['cleaner:system'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())

    triggerCb!(payload)

    // waitForIdle: scan store status is 'idle' so it should pass immediately
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.systemScan).toHaveBeenCalledTimes(1)
    expect(mockScanStore.addResults).toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('Weekly Clean'), expect.any(Object))
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-1', 'success')
  })

  it('auto-applies when autoApply is true', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockResolvedValue([
      {
        category: 'system',
        subcategory: 'temp',
        items: [{ id: 'item1', path: '/tmp/x', size: 100, selected: true }],
        totalSize: 100,
        itemCount: 1,
      },
    ])
    window.dinho.systemClean = vi.fn().mockResolvedValue({
      filesDeleted: 1,
      totalCleaned: 100,
    })

    const payload = {
      scheduleId: 'sched-2',
      scheduleName: 'Auto Clean',
      tasks: ['cleaner:system'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())

    triggerCb!(payload)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.systemScan).toHaveBeenCalled()
    expect(window.dinho.systemClean).toHaveBeenCalledWith(['item1'])
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-2', 'success')
  })

  it('skips recycle bin when protectRecycleBin is true', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    const payload = {
      scheduleId: 'sched-3',
      scheduleName: 'Skip Recycle',
      tasks: ['cleaner:recycleBin'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())

    triggerCb!(payload)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.recycleBinScan).not.toHaveBeenCalled()
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-3', 'success')
  })

  it('handles registry tasks', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.registryScan = vi.fn().mockResolvedValue([{ id: 'reg1' }])
    window.dinho.registryFix = vi.fn().mockResolvedValue({ fixed: 1 })

    const payload = {
      scheduleId: 'sched-4',
      scheduleName: 'Registry Fix',
      tasks: ['registry'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())

    triggerCb!(payload)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.registryScan).toHaveBeenCalled()
    expect(window.dinho.registryFix).toHaveBeenCalledWith(['reg1'])
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-4', 'success')
  })

  it('handles driver update tasks', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.driverUpdateScan = vi.fn().mockResolvedValue({ updates: [{ updateId: 'drv1' }] })
    window.dinho.driverUpdateInstall = vi.fn().mockResolvedValue({ installed: 1 })

    const payload = {
      scheduleId: 'sched-5',
      scheduleName: 'Driver Update',
      tasks: ['drivers'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())

    triggerCb!(payload)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.driverUpdateScan).toHaveBeenCalled()
    expect(window.dinho.driverUpdateInstall).toHaveBeenCalledWith(['drv1'])
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-5', 'success')
  })

  it('queues multiple triggers and processes sequentially', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    const payload1 = {
      scheduleId: 'sched-a',
      scheduleName: 'A',
      tasks: ['cleaner:system'],
      autoApply: false,
    }
    const payload2 = {
      scheduleId: 'sched-b',
      scheduleName: 'B',
      tasks: ['cleaner:browsers'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload1) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload1) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())

    triggerCb!(payload1)
    triggerCb!(payload2)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.systemScan).toHaveBeenCalledTimes(1)
    expect(window.dinho.browserScan).toHaveBeenCalledTimes(1)
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-a', 'success')
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-b', 'success')
  })

  it('runs recycle bin scan when protectRecycleBin is false', async () => {
    mockWindowDinho()
    mockSettingsStore.settings.cleaner.protectRecycleBin = false
    vi.useFakeTimers()

    const payload = {
      scheduleId: 'sched-rb',
      scheduleName: 'Recycle Bin',
      tasks: ['cleaner:recycleBin'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.recycleBinScan).toHaveBeenCalledTimes(1)
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-rb', 'success')
  })

  it('sets status to partial when cleaner scan throws', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockRejectedValue(new Error('scan failed'))

    const payload = {
      scheduleId: 'sched-cscanerr',
      scheduleName: 'Cleaner Scan Error',
      tasks: ['cleaner:system'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-cscanerr', 'partial')
    expect(mockScanStore.setStatus).toHaveBeenCalledWith('complete')
  })

  it('sets status to partial when cleaner clean throws with autoApply', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockResolvedValue([
      {
        category: 'system',
        subcategory: 'temp',
        items: [{ id: 'item1', path: '/tmp/x', size: 100, selected: true }],
        totalSize: 100,
        itemCount: 1,
      },
    ])
    window.dinho.systemClean = vi.fn().mockRejectedValue(new Error('clean failed'))

    const payload = {
      scheduleId: 'sched-ccleanerr',
      scheduleName: 'Cleaner Clean Error',
      tasks: ['cleaner:system'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.systemClean).toHaveBeenCalledWith(['item1'])
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-ccleanerr', 'partial')
  })

  it('sets status to partial when registry scan throws', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.registryScan = vi.fn().mockRejectedValue(new Error('registry scan failed'))

    const payload = {
      scheduleId: 'sched-regscanerr',
      scheduleName: 'Registry Scan Error',
      tasks: ['registry'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-regscanerr', 'partial')
  })

  it('sets status to partial when registry fix throws with autoApply', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.registryScan = vi.fn().mockResolvedValue([{ id: 'reg1' }])
    window.dinho.registryFix = vi.fn().mockRejectedValue(new Error('fix failed'))

    const payload = {
      scheduleId: 'sched-regfixerr',
      scheduleName: 'Registry Fix Error',
      tasks: ['registry'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.registryFix).toHaveBeenCalledWith(['reg1'])
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-regfixerr', 'partial')
  })

  it('sets status to partial when driver update scan throws', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.driverUpdateScan = vi.fn().mockRejectedValue(new Error('driver scan failed'))

    const payload = {
      scheduleId: 'sched-drvscanerr',
      scheduleName: 'Driver Scan Error',
      tasks: ['drivers'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-drvscanerr', 'partial')
  })

  it('sets status to partial when driver install throws with autoApply', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.driverUpdateScan = vi.fn().mockResolvedValue({ updates: [{ updateId: 'drv1' }] })
    window.dinho.driverUpdateInstall = vi.fn().mockRejectedValue(new Error('install failed'))

    const payload = {
      scheduleId: 'sched-drvinstallerr',
      scheduleName: 'Driver Install Error',
      tasks: ['drivers'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.driverUpdateInstall).toHaveBeenCalledWith(['drv1'])
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-drvinstallerr', 'partial')
  })

  it('sets status to partial when software update check throws', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.softwareUpdateCheck = vi.fn().mockRejectedValue(new Error('update check failed'))

    const payload = {
      scheduleId: 'sched-swscanerr',
      scheduleName: 'SW Check Error',
      tasks: ['software-update'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-swscanerr', 'partial')
  })

  it('sets status to partial when software update run throws with autoApply', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.softwareUpdateCheck = vi.fn().mockResolvedValue({
      apps: [{ id: 'app1', name: 'App1' }],
      packageManagerName: null,
    })
    window.dinho.softwareUpdateRun = vi.fn().mockRejectedValue(new Error('update run failed'))

    const payload = {
      scheduleId: 'sched-swrunerr',
      scheduleName: 'SW Run Error',
      tasks: ['software-update'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.softwareUpdateRun).toHaveBeenCalledWith(['app1'], undefined)
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-swrunerr', 'partial')
  })

  it('handles software update tasks with autoApply', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.softwareUpdateCheck = vi.fn().mockResolvedValue({
      apps: [
        { id: 'app1', name: 'App1' },
        { id: 'app2', name: 'App2' },
      ],
      packageManagerName: 'winget',
    })
    window.dinho.softwareUpdateRun = vi.fn().mockResolvedValue({ succeeded: 2 })

    const payload = {
      scheduleId: 'sched-sw',
      scheduleName: 'Software Update',
      tasks: ['software-update'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.softwareUpdateCheck).toHaveBeenCalledTimes(1)
    expect(window.dinho.softwareUpdateRun).toHaveBeenCalledWith(['app1', 'app2'], 'winget')
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-sw', 'success')
  })

  it('does not call clean functions when autoApply is false', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockResolvedValue([
      {
        category: 'system',
        subcategory: 'temp',
        items: [{ id: 'item1', path: '/tmp/x', size: 100, selected: true }],
        totalSize: 100,
        itemCount: 1,
      },
    ])

    const payload = {
      scheduleId: 'sched-noapply',
      scheduleName: 'No Auto Apply',
      tasks: ['cleaner:system'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.systemClean).not.toHaveBeenCalled()
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-noapply', 'success')
  })

  it('skips schedule when manual scan is still running (waitForIdle timeout)', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    mockScanStore.status = 'scanning'

    const payload = {
      scheduleId: 'sched-timeout',
      scheduleName: 'Timeout Scan',
      tasks: ['cleaner:system'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)

    // Advance past the 300s waitForIdle timeout
    await vi.advanceTimersByTimeAsync(310_000)

    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-timeout', 'failed')
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Timeout Scan'), expect.any(Object))
    expect(window.dinho.systemScan).not.toHaveBeenCalled()
  })

  it('handles empty tasks gracefully', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    const payload = {
      scheduleId: 'sched-empty',
      scheduleName: 'Empty Tasks',
      tasks: ['unknown:task'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-empty', 'success')
    expect(mockHistoryStore.addEntry).toHaveBeenCalledTimes(1)
  })

  it('creates history entry with correct data after success', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockResolvedValue([
      {
        category: 'system',
        subcategory: 'temp',
        items: [
          { id: 'item1', path: '/tmp/x', size: 100, selected: true },
          { id: 'item2', path: '/tmp/y', size: 200, selected: true },
        ],
        totalSize: 300,
        itemCount: 2,
      },
    ])
    window.dinho.systemClean = vi.fn().mockResolvedValue({
      filesDeleted: 2,
      totalCleaned: 300,
    })

    const payload = {
      scheduleId: 'sched-history',
      scheduleName: 'History Test',
      tasks: ['cleaner:system'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(mockHistoryStore.addEntry).toHaveBeenCalledTimes(1)
    const entry = mockHistoryStore.addEntry.mock.calls[0]![0]
    expect(entry.type).toBe('cleaner')
    expect(entry.scheduleName).toBe('History Test')
    expect(entry.totalItemsFound).toBe(2)
    expect(entry.totalItemsCleaned).toBe(2)
    expect(entry.totalItemsSkipped).toBe(0)
    expect(entry.totalSpaceSaved).toBe(300)
    expect(entry.scheduled).toBe(true)
    expect(entry.categories).toEqual([{ name: 'System', itemsFound: 2, itemsCleaned: 2, spaceSaved: 300 }])
  })

  it('calls success toast after completing a scheduled run', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    const payload = {
      scheduleId: 'sched-toast',
      scheduleName: 'Toast Test',
      tasks: ['cleaner:system'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Toast Test'), expect.any(Object))
  })

  it('calls notifyScheduledScanComplete with correct totals', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockResolvedValue([
      {
        category: 'system',
        subcategory: 'temp',
        items: [{ id: 'item1', path: '/tmp/x', size: 500, selected: true }],
        totalSize: 500,
        itemCount: 1,
      },
    ])
    window.dinho.systemClean = vi.fn().mockResolvedValue({
      filesDeleted: 1,
      totalCleaned: 500,
    })

    const payload = {
      scheduleId: 'sched-notify',
      scheduleName: 'Notify Test',
      tasks: ['cleaner:system'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.notifyScheduledScanComplete).toHaveBeenCalledWith(500, 1)
  })

  it('runs the full maintenance pipeline when the task is selected', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    window.dinho.systemScan = vi.fn().mockResolvedValue([
      {
        category: 'system',
        subcategory: 'temp',
        items: [{ id: 'item1', path: '/tmp/x', size: 500, selected: true }],
        totalSize: 500,
        itemCount: 1,
      },
    ])
    window.dinho.systemClean = vi.fn().mockResolvedValue({ filesDeleted: 1, totalCleaned: 500 })
    window.dinho.registryScan = vi.fn().mockResolvedValue([{ id: 'reg1' }])
    window.dinho.registryFix = vi.fn().mockResolvedValue({ fixed: 1 })
    window.dinho.softwareUpdateCheck = vi.fn().mockResolvedValue({
      apps: [{ id: 'app1', selected: true }],
      packageManagerName: 'winget',
    })
    window.dinho.softwareUpdateRun = vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 })
    window.dinho.driverUpdateScan = vi.fn().mockResolvedValue({ updates: [{ updateId: 'drv1', selected: true }] })
    window.dinho.driverUpdateInstall = vi.fn().mockResolvedValue({ installed: 1, failed: 0, rebootRequired: false })
    window.dinho.driverScan = vi.fn().mockResolvedValue({
      packages: [{ publishedName: 'oem1.inf', isCurrent: false, selected: true }],
    })
    window.dinho.driverClean = vi.fn().mockResolvedValue({ removed: 1, spaceRecovered: 512 })
    window.dinho.malwareScan = vi.fn().mockResolvedValue({
      threats: [{ path: 'C:\\evil', detectionName: 'EICAR', severity: 'high', source: 'signature', details: '' }],
    })
    window.dinho.malwareQuarantine = vi.fn().mockResolvedValue({ succeeded: 1 })
    window.dinho.privacyScan = vi.fn().mockResolvedValue({ score: 80, total: 10, protected: 7 })
    window.dinho.startupList = vi.fn().mockResolvedValue([{ enabled: true, impact: 'high' }])
    window.dinho.vulnerabilityScan = vi.fn().mockResolvedValue({ vulnerable: 2 })

    const payload = {
      scheduleId: 'sched-full',
      scheduleName: 'Full Maintenance',
      tasks: ['full-maintenance'],
      autoApply: true,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.diskRepairDism).toHaveBeenCalled()
    expect(window.dinho.winSxSClean).toHaveBeenCalled()
    expect(window.dinho.systemClean).toHaveBeenCalledWith(['item1'])
    expect(window.dinho.registryFix).toHaveBeenCalledWith(['reg1'])
    expect(window.dinho.softwareUpdateRun).toHaveBeenCalledWith(['app1'], 'winget')
    expect(window.dinho.driverUpdateInstall).toHaveBeenCalledWith(['drv1'])
    expect(window.dinho.driverClean).toHaveBeenCalledWith(['oem1.inf'])
    expect(window.dinho.malwareQuarantine).toHaveBeenCalledWith(
      ['C:\\evil'],
      expect.arrayContaining([expect.objectContaining({ path: 'C:\\evil', detectionName: 'EICAR' })]),
    )
    expect(window.dinho.vulnerabilityScan).toHaveBeenCalled()
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-full', 'success')

    const entry = mockHistoryStore.addEntry.mock.calls[0]![0]
    expect(entry.scheduleName).toBe('Full Maintenance')
    expect(entry.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Full Maintenance',
          itemsFound: 8,
          itemsCleaned: 6,
          spaceSaved: 1012,
        }),
      ]),
    )
  })

  it('only scans during full maintenance when autoApply is false', async () => {
    mockWindowDinho()
    vi.useFakeTimers()

    const payload = {
      scheduleId: 'sched-full-scan',
      scheduleName: 'Full Maintenance Scan',
      tasks: ['full-maintenance'],
      autoApply: false,
    }

    let triggerCb: (p: typeof payload) => void
    window.dinho.onScheduleRunTrigger = vi.fn((cb: (p: typeof payload) => void) => {
      triggerCb = cb
      return vi.fn()
    }) as never

    renderHook(() => useScheduledScan())
    triggerCb!(payload)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(window.dinho.systemScan).toHaveBeenCalled()
    expect(window.dinho.registryScan).toHaveBeenCalled()
    expect(window.dinho.softwareUpdateCheck).toHaveBeenCalled()
    expect(window.dinho.driverUpdateScan).toHaveBeenCalled()
    expect(window.dinho.malwareScan).toHaveBeenCalled()
    expect(window.dinho.privacyScan).toHaveBeenCalled()
    expect(window.dinho.startupList).toHaveBeenCalled()
    expect(window.dinho.vulnerabilityScan).toHaveBeenCalled()
    expect(window.dinho.driverScan).toHaveBeenCalled()

    expect(window.dinho.diskRepairDism).not.toHaveBeenCalled()
    expect(window.dinho.winSxSClean).not.toHaveBeenCalled()
    expect(window.dinho.systemClean).not.toHaveBeenCalled()
    expect(window.dinho.registryFix).not.toHaveBeenCalled()
    expect(window.dinho.softwareUpdateRun).not.toHaveBeenCalled()
    expect(window.dinho.driverUpdateInstall).not.toHaveBeenCalled()
    expect(window.dinho.malwareQuarantine).not.toHaveBeenCalled()
    expect(window.dinho.driverClean).not.toHaveBeenCalled()
    expect(window.dinho.memoryOptimize).not.toHaveBeenCalled()
    expect(window.dinho.scheduleRunComplete).toHaveBeenCalledWith('sched-full-scan', 'success')
  })
})
