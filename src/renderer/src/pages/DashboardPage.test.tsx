// @vitest-environment jsdom

import { CleanerType } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  excluded: new Set<string>(),
  systemScan: vi.fn(),
  systemClean: vi.fn(),
  registry: false,
  drivers: false,
  addEntry: vi.fn(),
  recompute: vi.fn(),
  setDiskHealth: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() } }))
vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({
    platform: 'win32',
    features: { registry: mocks.registry, drivers: mocks.drivers, gameMode: false, clips: false },
  }),
}))
vi.mock('@/stores/stats-store', () => ({
  useStatsStore: (sel: (s: unknown) => unknown) =>
    sel({
      stats: { totalSpaceSaved: 0, totalFilesCleaned: 0, totalScans: 0, lastScanDate: null, recentActivity: [] },
      loaded: true,
      recompute: mocks.recompute,
    }),
}))
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: (sel: (s: unknown) => unknown) => sel({ entries: [], addEntry: mocks.addEntry }),
}))
vi.mock('@/stores/scan-store', () => ({
  useScanStore: (sel: (s: unknown) => unknown) => sel({ excludedSubcategories: mocks.excluded }),
}))
vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: (sel: (s: unknown) => unknown) => sel({ hasChecked: false }),
}))
vi.mock('@/stores/service-store', () => ({
  useServiceStore: (sel: (s: unknown) => unknown) => sel({ hasScanned: false }),
}))
vi.mock('@/stores/startup-store', () => ({ useStartupStore: (sel: (s: unknown) => unknown) => sel({ items: [] }) }))
vi.mock('@/stores/game-mode-store', () => ({
  useGameModeStore: (sel: (s: unknown) => unknown) => sel({ active: false }),
}))
vi.mock('@/stores/perf-store', () => ({
  usePerfStore: (sel: (s: unknown) => unknown) => sel({ setDiskHealth: mocks.setDiskHealth }),
}))

// Heavy children stubbed: this suite targets the one-click clean exclusions.
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/shared/StaggerContainer', () => ({
  StaggerContainer: ({ children }: { children: ReactNode }) => children,
  StaggerItem: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/dashboard/HealthCard', () => ({ HealthCard: () => null }))
vi.mock('@/components/dashboard/GameModeCard', () => ({ GameModeCard: () => null }))
vi.mock('@/components/dashboard/GameClipsCard', () => ({ GameClipsCard: () => null }))
vi.mock('@/components/dashboard/MiniGauge', () => ({ MiniGauge: () => null }))
vi.mock('@/components/dashboard/ProgressBanner', () => ({ ProgressBanner: () => null }))
vi.mock('@/components/dashboard/ResultBanner', () => ({
  ResultBanner: ({ result }: { result: Record<string, unknown> | null }) =>
    result ? <div data-testid="result-banner">{JSON.stringify(result)}</div> : null,
}))
vi.mock('@/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: () => void; confirmLabel: string }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
    ) : null,
}))
vi.mock('./dashboard/DashboardComponents', () => ({
  CLEANER_SCAN_FNS: [{ type: 'system', scan: mocks.systemScan, clean: mocks.systemClean }],
  MiniGaugeSkeleton: () => null,
}))

import { DashboardPage } from './DashboardPage'

function systemResult(subcategory: string, ids: string[]): ScanResult {
  return {
    category: CleanerType.System,
    subcategory,
    items: ids.map((id) => ({
      id,
      path: `C:\\${id}`,
      size: 10,
      category: CleanerType.System,
      subcategory,
      lastModified: 0,
      selected: true,
    })),
    totalSize: ids.length * 10,
    itemCount: ids.length,
  }
}

const emptyClean = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }

async function runQuickClean() {
  render(<DashboardPage />)
  fireEvent.click(screen.getByText('quickCleanTitle'))
  fireEvent.click(screen.getByText('quickCleanConfirmLabel'))
}

describe('DashboardPage one-click clean — subcategory exclusions (M3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.excluded = new Set<string>()
    mocks.registry = false
    mocks.drivers = false
    mocks.systemScan.mockResolvedValue([])
    mocks.systemClean.mockResolvedValue(emptyClean)
    mocks.addEntry.mockResolvedValue(undefined)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = {
      perfQuickStats: vi.fn().mockResolvedValue(null),
      perfGetDiskHealth: vi.fn().mockResolvedValue(null),
    }
  })

  it('cleans every found item when nothing is excluded', async () => {
    mocks.systemScan.mockResolvedValue([systemResult('system-temp', ['a']), systemResult('system-wer', ['b'])])

    await runQuickClean()

    await waitFor(() => expect(mocks.systemClean).toHaveBeenCalledWith(['a', 'b']))
  })

  it('skips a subcategory excluded with the composite category:subcategory key', async () => {
    mocks.systemScan.mockResolvedValue([systemResult('system-temp', ['a']), systemResult('system-wer', ['b'])])
    mocks.excluded = new Set([`${CleanerType.System}:system-wer`])

    await runQuickClean()

    await waitFor(() => expect(mocks.systemClean).toHaveBeenCalledWith(['a']))
  })

  it('does not exclude when only the subcategory name matches under another category', async () => {
    mocks.systemScan.mockResolvedValue([systemResult('system-temp', ['a'])])
    mocks.excluded = new Set([`${CleanerType.Browser}:system-temp`])

    await runQuickClean()

    await waitFor(() => expect(mocks.systemClean).toHaveBeenCalledWith(['a']))
  })

  it('does not clean at all when every subcategory is excluded', async () => {
    mocks.systemScan.mockResolvedValue([systemResult('system-temp', ['a'])])
    mocks.excluded = new Set([`${CleanerType.System}:system-temp`])

    await runQuickClean()

    await waitFor(() => expect(mocks.systemScan).toHaveBeenCalled())
    expect(mocks.systemClean).not.toHaveBeenCalled()
  })
})

// ── Full system maintenance (7-phase pipeline) ───────────────

function cleanResult(space: number, files: number) {
  return { totalCleaned: space, filesDeleted: files, filesSkipped: 0, errors: [], needsElevation: false }
}

function repairResult(overrides: Record<string, unknown> = {}) {
  return {
    tool: 'dism',
    success: true,
    exitCode: 0,
    summary: '',
    summaryCode: 'dismHealthy',
    log: '',
    requiresReboot: false,
    needsAdmin: false,
    ...overrides,
  }
}

function makeDinho(overrides: Record<string, unknown> = {}) {
  return {
    perfQuickStats: vi.fn().mockResolvedValue(null),
    perfGetDiskHealth: vi.fn().mockResolvedValue(null),
    diskRepairDism: vi.fn().mockResolvedValue(repairResult()),
    diskRepairSfc: vi.fn().mockResolvedValue(repairResult({ tool: 'sfc', summaryCode: 'sfcNoViolations' })),
    winSxSScan: vi.fn().mockResolvedValue([]),
    winSxSClean: vi.fn().mockResolvedValue(cleanResult(2048, 4)),
    softwareUpdateCheck: vi.fn().mockResolvedValue({
      apps: [],
      totalCount: 0,
      majorCount: 0,
      minorCount: 0,
      patchCount: 0,
      packageManagerAvailable: true,
      packageManagerName: 'winget',
    }),
    softwareUpdateRun: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0, errors: [] }),
    driverUpdateScan: vi.fn().mockResolvedValue({ updates: [], allDrivers: [], totalAvailable: 0, scanDuration: 0 }),
    driverUpdateInstall: vi.fn().mockResolvedValue({ installed: 0, failed: 0, rebootRequired: false, errors: [] }),
    diskTrimList: vi.fn().mockResolvedValue([]),
    diskTrimRun: vi.fn().mockResolvedValue([]),
    powerPlansList: vi.fn().mockResolvedValue([]),
    powerPlansActivate: vi.fn().mockResolvedValue({ success: true }),
    networkScan: vi.fn().mockResolvedValue([]),
    networkClean: vi.fn().mockResolvedValue({ cleaned: 0 }),
    memoryOptimize: vi.fn().mockResolvedValue({ success: true, freedBytes: 0 }),
    registryScan: vi.fn().mockResolvedValue([]),
    registryFix: vi.fn().mockResolvedValue({ fixed: 0 }),
    ...overrides,
  }
}

function useDinho(overrides: Record<string, unknown> = {}) {
  const dinho = makeDinho(overrides)
  ;(window as unknown as { dinho: Record<string, unknown> }).dinho = dinho
  return dinho
}

async function runAutoMaintenance() {
  render(<DashboardPage />)
  fireEvent.click(screen.getByText('autoMaintenanceTitle'))
  fireEvent.click(screen.getByText('autoMaintenanceConfirmLabel'))
}

async function readAutoMaintenanceResult() {
  await waitFor(() => expect(screen.getByTestId('result-banner')).toBeTruthy())
  return JSON.parse(screen.getByTestId('result-banner').textContent ?? '{}') as Record<string, unknown>
}

type MockCallOrder = { mock: { invocationCallOrder: number[] } }
const firstCall = (fn: unknown) => (fn as MockCallOrder).mock.invocationCallOrder[0] ?? 0

describe('DashboardPage full system maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.excluded = new Set<string>()
    mocks.registry = true
    mocks.drivers = true
    mocks.systemScan.mockResolvedValue([])
    mocks.systemClean.mockResolvedValue(cleanResult(0, 0))
    mocks.addEntry.mockResolvedValue(undefined)
  })

  it('runs every phase in order and aggregates the report', async () => {
    mocks.systemScan.mockResolvedValue([systemResult('system-temp', ['a'])])
    mocks.systemClean.mockResolvedValue(cleanResult(1024, 2))

    const dinho = useDinho({
      registryScan: vi.fn().mockResolvedValue([{ id: 'r1', selected: true }]),
      registryFix: vi.fn().mockResolvedValue({ fixed: 3 }),
      softwareUpdateCheck: vi.fn().mockResolvedValue({
        apps: [
          {
            id: 'Google.Chrome',
            name: 'Chrome',
            currentVersion: '1',
            availableVersion: '2',
            source: 'winget',
            severity: 'minor',
            selected: true,
          },
        ],
        totalCount: 1,
        majorCount: 0,
        minorCount: 1,
        patchCount: 0,
        packageManagerAvailable: true,
        packageManagerName: 'winget',
      }),
      softwareUpdateRun: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0, errors: [] }),
      driverUpdateScan: vi.fn().mockResolvedValue({
        updates: [{ updateId: 'wu-1', selected: true }],
        allDrivers: [],
        totalAvailable: 1,
        scanDuration: 0,
      }),
      driverUpdateInstall: vi.fn().mockResolvedValue({ installed: 1, failed: 0, rebootRequired: true, errors: [] }),
      diskTrimList: vi
        .fn()
        .mockResolvedValue([{ id: 'C', mediaType: 'NVMe', trimSupport: 'supported', isRemovable: false }]),
      diskTrimRun: vi
        .fn()
        .mockResolvedValue([{ driveId: 'C', success: true, durationMs: 1, exitCode: 0, summary: '', timestamp: 0 }]),
      powerPlansList: vi.fn().mockResolvedValue([
        {
          guid: 'hp',
          name: 'High performance',
          description: '',
          isActive: false,
          isHighPerformance: true,
          isBalanced: false,
          isPowerSaver: false,
          isUltimatePerformance: false,
        },
      ]),
      networkScan: vi.fn().mockResolvedValue([{ id: 'n1', selected: true }]),
      networkClean: vi.fn().mockResolvedValue({ cleaned: 2 }),
      memoryOptimize: vi.fn().mockResolvedValue({ success: true, freedBytes: 4096 }),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(result).toMatchObject({
      spaceRecovered: 1024 + 2048,
      filesCleaned: 2 + 4,
      registryFixed: 3,
      updatesAvailable: 0,
      networkCleaned: 2,
      memoryFreed: 4096,
      appsUpdated: 1,
      driversUpdated: 1,
      trimDrives: 1,
      powerPlanActivated: 'High performance',
      rebootRequired: true,
      systemRepairStatus: 'resultSystemHealthy',
    })

    expect(dinho.diskRepairSfc).not.toHaveBeenCalled()
    expect(dinho.softwareUpdateRun).toHaveBeenCalledWith(['Google.Chrome'])
    expect(dinho.driverUpdateInstall).toHaveBeenCalledWith(['wu-1'])
    expect(dinho.diskTrimRun).toHaveBeenCalledWith(['C'])
    expect(dinho.powerPlansActivate).toHaveBeenCalledWith('hp')

    const order = [
      dinho.diskRepairDism,
      dinho.winSxSClean,
      mocks.systemScan,
      dinho.registryScan,
      dinho.softwareUpdateCheck,
      dinho.driverUpdateScan,
      dinho.diskTrimList,
      dinho.powerPlansList,
      dinho.networkScan,
      dinho.memoryOptimize,
    ].map(firstCall)
    expect(order).toEqual([...order].sort((a, b) => a - b))

    expect(mocks.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        totalSpaceSaved: 1024 + 2048,
        totalItemsCleaned: 2 + 4 + 3 + 2 + 1 + 1,
        totalItemsSkipped: 0,
        categories: expect.arrayContaining([
          expect.objectContaining({ name: 'historyAutoMaintenance' }),
          expect.objectContaining({ name: 'historyRegistry' }),
          expect.objectContaining({ name: 'historyAppsUpdated' }),
          expect.objectContaining({ name: 'historyDriversUpdated' }),
        ]),
      }),
    )
  })

  it('runs SFC when DISM repaired corruption and reports the repair', async () => {
    useDinho({
      diskRepairDism: vi.fn().mockResolvedValue(repairResult({ summaryCode: 'dismRepaired' })),
      diskRepairSfc: vi
        .fn()
        .mockResolvedValue(repairResult({ tool: 'sfc', summaryCode: 'sfcNoViolations', requiresReboot: true })),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(result.systemRepairStatus).toBe('resultSystemRepaired')
    expect(result.rebootRequired).toBe(true)
    expect((window.dinho.diskRepairSfc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]).toEqual(['C'])
  })

  it('falls back to SFC when DISM fails and still reports a healthy check', async () => {
    useDinho({
      diskRepairDism: vi
        .fn()
        .mockResolvedValue(repairResult({ success: false, exitCode: 1, summaryCode: 'dismExitCode' })),
      diskRepairSfc: vi.fn().mockResolvedValue(repairResult({ tool: 'sfc', summaryCode: 'sfcNoViolations' })),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(result.systemRepairStatus).toBe('resultSystemHealthy')
  })

  it('stops after DISM when admin rights are missing', async () => {
    const dinho = useDinho({
      diskRepairDism: vi.fn().mockResolvedValue(repairResult({ success: false, needsAdmin: true, exitCode: null })),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(dinho.diskRepairSfc).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('toastWindowsRepairFailed')
    expect(result.systemRepairStatus).toBeUndefined()
  })

  it('does not run winget when the update check fails', async () => {
    const dinho = useDinho({
      softwareUpdateCheck: vi.fn().mockResolvedValue({
        apps: [],
        totalCount: 0,
        majorCount: 0,
        minorCount: 0,
        patchCount: 0,
        packageManagerAvailable: false,
        packageManagerName: null,
        failure: 'check-failed',
      }),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(dinho.softwareUpdateRun).not.toHaveBeenCalled()
    expect(result.appsUpdated).toBe(0)
  })

  it('keeps failed app updates as still available', async () => {
    useDinho({
      softwareUpdateCheck: vi.fn().mockResolvedValue({
        apps: [
          {
            id: 'app.one',
            name: 'One',
            currentVersion: '1',
            availableVersion: '2',
            source: 'winget',
            severity: 'minor',
            selected: true,
          },
          {
            id: 'app.two',
            name: 'Two',
            currentVersion: '1',
            availableVersion: '2',
            source: 'winget',
            severity: 'minor',
            selected: true,
          },
        ],
        totalCount: 2,
        majorCount: 0,
        minorCount: 2,
        patchCount: 0,
        packageManagerAvailable: true,
        packageManagerName: 'winget',
      }),
      softwareUpdateRun: vi.fn().mockResolvedValue({
        succeeded: 1,
        failed: 1,
        errors: [{ appId: 'app.two', name: 'Two', reason: 'in use' }],
      }),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(result.appsUpdated).toBe(1)
    expect(result.updatesAvailable).toBe(1)
    expect(mocks.addEntry).toHaveBeenCalledWith(expect.objectContaining({ totalItemsSkipped: 1 }))
  })

  it('only trims removable-safe supported SSD/NVMe drives', async () => {
    const dinho = useDinho({
      diskTrimList: vi.fn().mockResolvedValue([
        { id: 'C', mediaType: 'NVMe', trimSupport: 'supported', isRemovable: false },
        { id: 'D', mediaType: 'SSD', trimSupport: 'disabled', isRemovable: false },
        { id: 'E', mediaType: 'HDD', trimSupport: 'supported', isRemovable: false },
        { id: 'F', mediaType: 'SSD', trimSupport: 'supported', isRemovable: true },
      ]),
      diskTrimRun: vi
        .fn()
        .mockResolvedValue([{ driveId: 'C', success: true, durationMs: 1, exitCode: 0, summary: '', timestamp: 0 }]),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(dinho.diskTrimRun).toHaveBeenCalledWith(['C'])
    expect(result.trimDrives).toBe(1)
  })

  it('prefers the ultimate plan and skips activation when it is already active', async () => {
    const dinho = useDinho({
      powerPlansList: vi.fn().mockResolvedValue([
        {
          guid: 'hp',
          name: 'High performance',
          description: '',
          isActive: false,
          isHighPerformance: true,
          isBalanced: false,
          isPowerSaver: false,
          isUltimatePerformance: false,
        },
        {
          guid: 'ult',
          name: 'Ultimate Performance',
          description: '',
          isActive: true,
          isHighPerformance: false,
          isBalanced: false,
          isPowerSaver: false,
          isUltimatePerformance: true,
        },
      ]),
    })

    await runAutoMaintenance()
    const result = await readAutoMaintenanceResult()

    expect(dinho.powerPlansActivate).not.toHaveBeenCalled()
    expect(result.powerPlanActivated).toBe('Ultimate Performance')
  })

  it('skips the driver phase when the platform has no driver support', async () => {
    mocks.drivers = false
    const dinho = useDinho()

    await runAutoMaintenance()
    await readAutoMaintenanceResult()

    expect(dinho.driverUpdateScan).not.toHaveBeenCalled()
    expect(dinho.driverUpdateInstall).not.toHaveBeenCalled()
  })
})
