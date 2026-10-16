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
    features: { registry: mocks.registry, drivers: false, gameMode: false, clips: false },
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
vi.mock('@/components/dashboard/ResultBanner', () => ({ ResultBanner: () => null }))
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
