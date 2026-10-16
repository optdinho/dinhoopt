// @vitest-environment jsdom
import { CleanerType, ScanStatus } from '@shared/enums'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  protectRecycleBin: false,
  platform: 'win32',
  addEntry: vi.fn(),
  recompute: vi.fn(),
  confirmOnConfirm: null as null | (() => void),
  logger: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

const store = {
  status: ScanStatus.Idle,
  results: [] as unknown[],
  progress: null,
  cleanSummary: null,
  excludedSubcategories: new Set<string>(),
  setStatus: vi.fn(),
  setResults: vi.fn(),
  addResults: vi.fn(),
  setProgress: vi.fn(),
  setCleanSummary: vi.fn(),
  toggleSubcategory: vi.fn(),
  getTotalSize: () => 0,
  toggleCategory: vi.fn(),
}

vi.mock('@/stores/scan-store', () => ({ useScanStore: () => store }))
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (sel: (s: unknown) => unknown) =>
    sel({ settings: { cleaner: { protectRecycleBin: mocks.protectRecycleBin } } }),
}))
vi.mock('@/stores/stats-store', () => ({
  useStatsStore: (sel: (s: unknown) => unknown) => sel({ recompute: mocks.recompute }),
}))
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: (sel: (s: unknown) => unknown) => sel({ addEntry: mocks.addEntry }),
}))
vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ platform: mocks.platform }) }))
vi.mock('@/lib/renderer-logger', () => ({ default: mocks.logger }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Heavy children stubbed out: this suite is about the page's own structure.
vi.mock('@/components/cleaner/CleanSummary', () => ({ CleanSummary: () => null }))
vi.mock('@/components/cleaner/NetworkCleanupModal', () => ({ NetworkCleanupModal: () => null }))
vi.mock('@/components/shared/ScanProgress', () => ({ ScanProgress: () => null }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmLabel,
  }: {
    open: boolean
    onConfirm: () => void
    confirmLabel: string
  }) => {
    mocks.confirmOnConfirm = onConfirm
    return open ? (
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
    ) : null
  },
}))
vi.mock('@/components/shared/ReportCard', () => ({
  ReportCard: () => null,
  loadReport: () => null,
  saveReport: vi.fn(),
}))
vi.mock('./cleaner/CategoryResultsPanel', () => ({ CategoryResultsPanel: () => null }))

import { CleanerPage } from './CleanerPage'
import { categories } from './cleaner/CleanerPageConstants'

beforeEach(() => {
  vi.clearAllMocks()
  store.status = ScanStatus.Idle
  store.results = []
  store.cleanSummary = null
  store.progress = null
  store.excludedSubcategories = new Set<string>()
  mocks.protectRecycleBin = false
  mocks.confirmOnConfirm = null
  ;(window as unknown as { dinho: Record<string, unknown> }).dinho = {}
})

const emptyClean = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }

function systemResult(items: Array<{ id: string }>, subcategory = 'system-temp') {
  return {
    category: CleanerType.System,
    subcategory,
    itemCount: items.length,
    totalSize: items.length,
    items: items.map((i) => ({
      id: i.id,
      path: `C:\\${i.id}.tmp`,
      size: 1,
      category: CleanerType.System,
      subcategory,
      lastModified: 0,
      selected: false,
    })),
  }
}

function winSxSResult() {
  return {
    category: CleanerType.WinSxS,
    subcategory: 'Component Store',
    itemCount: 1,
    totalSize: 512,
    items: [
      {
        id: 'winsxs-1',
        path: 'WinSxS',
        size: 512,
        category: CleanerType.WinSxS,
        subcategory: 'Component Store',
        lastModified: 0,
        selected: false,
      },
    ],
  }
}

describe('CleanerPage category navigation', () => {
  it('renders every visible category exactly once', () => {
    render(<CleanerPage />)
    for (const cat of categories) {
      expect(screen.getAllByText(cat.labelKey)).toHaveLength(1)
    }
  })

  it('groups the categories under section headings', () => {
    render(<CleanerPage />)
    expect(screen.getByText('groupSystem')).not.toBeNull()
    expect(screen.getByText('groupApps')).not.toBeNull()
    expect(screen.getByText('groupMaintenance')).not.toBeNull()
  })

  it('lists the groups in a fixed order, Sistema first', () => {
    render(<CleanerPage />)
    const order = screen.getAllByTestId(/^group-heading-/).map((el) => el.getAttribute('data-testid'))
    expect(order).toEqual(['group-heading-groupSystem', 'group-heading-groupApps', 'group-heading-groupMaintenance'])
  })

  it('keeps every category inside the group it declares', () => {
    render(<CleanerPage />)
    for (const groupKey of ['groupSystem', 'groupApps', 'groupMaintenance']) {
      const section = screen.getByTestId(`category-group-${groupKey}`)
      const members = categories.filter((c) => c.group === groupKey)
      for (const cat of members) {
        expect(within(section).getByText(cat.labelKey)).not.toBeNull()
      }
      // and nothing that does not belong to it
      const others = categories.filter((c) => c.group !== groupKey)
      for (const cat of others) {
        expect(within(section).queryByText(cat.labelKey)).toBeNull()
      }
    }
  })

  it('hides the recycle bin category when the lixeira is protected', () => {
    mocks.protectRecycleBin = true
    render(<CleanerPage />)
    const recycleKey = categories.find((c) => c.type === CleanerType.RecycleBin)!.labelKey
    expect(screen.queryByText(recycleKey)).toBeNull()
  })
})

describe('CleanerPage summary placement', () => {
  it('does not show the recoverable total before a scan', () => {
    render(<CleanerPage />)
    expect(screen.queryByText('totalRecoverable')).toBeNull()
  })

  it('puts the recoverable total above the category list, not below it', () => {
    store.results = [{ category: CleanerType.System, itemCount: 3, items: [] }]
    store.getTotalSize = () => 1024
    render(<CleanerPage />)

    const total = screen.getByText('totalRecoverable')
    const firstGroup = screen.getByTestId('group-heading-groupSystem')
    // In document order the summary must precede the navigation it summarises.
    expect(total.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('CleanerPage header actions', () => {
  it('offers scan, quick clean and full clean in the header', () => {
    render(<CleanerPage />)
    const header = screen.getByTestId('page-header-actions')
    expect(within(header).getByText('scanButton')).not.toBeNull()
    expect(within(header).getByText('quickCleanButton')).not.toBeNull()
    expect(within(header).getByText('fullCleanButton')).not.toBeNull()
    expect(within(header).queryByText('networkLink')).toBeNull()
  })

  it('still offers the network cleanup action somewhere reachable', () => {
    render(<CleanerPage />)
    expect(screen.getByText('networkLink')).not.toBeNull()
  })
})

describe('CleanerPage naming', () => {
  it('titles the page with the module name', () => {
    render(<CleanerPage />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('pageTitle')
  })
})

describe('CleanerPage failure surfacing', () => {
  it('logs when a category scan fails', async () => {
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = {
      systemScan: vi.fn().mockRejectedValue(new Error('scan boom')),
    }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('scanButton'))

    await waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'CleanerPage',
        expect.stringContaining('Scan failed'),
        expect.anything(),
      ),
    )
  })

  it('records a failed category clean in the summary instead of dropping it', async () => {
    store.results = [
      {
        category: CleanerType.System,
        subcategory: 'system-temp',
        itemCount: 1,
        totalSize: 10,
        items: [
          {
            id: 'x',
            path: 'C:\\x.tmp',
            size: 10,
            category: CleanerType.System,
            subcategory: 'system-temp',
            lastModified: 0,
            selected: true,
          },
        ],
      },
    ]
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = {
      systemClean: vi.fn().mockRejectedValue(new Error('clean boom')),
    }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))
    fireEvent.click(screen.getByText('confirmQuickCleanLabel'))

    await waitFor(() => expect(store.setCleanSummary).toHaveBeenCalled())
    const summary = store.setCleanSummary.mock.calls.at(-1)![0] as {
      errors: { reason: string }[]
      categories: { type: string; cleaned: number }[]
    }

    // The failure is logged, counted as an error and kept in the breakdown.
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'CleanerPage',
      expect.stringContaining('Clean failed'),
      expect.anything(),
    )
    expect(summary.errors.some((e) => e.reason === 'clean boom')).toBe(true)
    expect(summary.categories.find((c) => c.type === CleanerType.System)).toMatchObject({ cleaned: 0 })
  })
})

describe('CleanerPage scan scope', () => {
  it('skips the WinSxS analysis during the normal scan', async () => {
    const winSxSScan = vi.fn().mockResolvedValue([])
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { winSxSScan }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('scanButton'))

    await waitFor(() => expect(store.setStatus).toHaveBeenCalledWith(ScanStatus.Complete))
    expect(winSxSScan).not.toHaveBeenCalled()
  })
})

describe('CleanerPage clean modes', () => {
  it('quick clean cleans the light categories and never touches WinSxS', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }])]
    const systemClean = vi.fn().mockResolvedValue(emptyClean)
    const winSxSScan = vi.fn().mockResolvedValue([])
    const winSxSClean = vi.fn().mockResolvedValue(emptyClean)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean, winSxSScan, winSxSClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))
    fireEvent.click(screen.getByText('confirmQuickCleanLabel'))

    await waitFor(() => expect(systemClean).toHaveBeenCalled())
    expect(winSxSScan).not.toHaveBeenCalled()
    expect(winSxSClean).not.toHaveBeenCalled()
  })

  it('quick clean ignores WinSxS results even when they are present in the store', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }]), winSxSResult()]
    const systemClean = vi.fn().mockResolvedValue(emptyClean)
    const winSxSClean = vi.fn().mockResolvedValue(emptyClean)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean, winSxSClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))
    fireEvent.click(screen.getByText('confirmQuickCleanLabel'))

    await waitFor(() => expect(systemClean).toHaveBeenCalledWith(['a']))
    expect(winSxSClean).not.toHaveBeenCalled()
  })

  it('full clean analyses WinSxS and then cleans it alongside the light categories', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }])]
    const systemClean = vi.fn().mockResolvedValue({ ...emptyClean, filesDeleted: 1 })
    const winSxSScan = vi.fn().mockResolvedValue([winSxSResult()])
    const winSxSClean = vi.fn().mockResolvedValue({ ...emptyClean, totalCleaned: 512, filesDeleted: 1 })
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean, winSxSScan, winSxSClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('fullCleanButton'))
    fireEvent.click(screen.getByText('confirmFullCleanLabel'))

    await waitFor(() => expect(winSxSClean).toHaveBeenCalled())
    expect(winSxSScan).toHaveBeenCalled()
    expect(systemClean).toHaveBeenCalled()

    // The breakdown reflects the real order of the page: light categories first,
    // WinSxS last.
    const summary = store.setCleanSummary.mock.calls.at(-1)![0] as {
      categories: { type: string }[]
    }
    const order = summary.categories.map((c) => c.type)
    expect(order).toContain(CleanerType.System)
    expect(order.indexOf(CleanerType.System)).toBeLessThan(order.indexOf(CleanerType.WinSxS))
  })

  it('full clean runs the normal scan first when nothing was analysed yet', async () => {
    // No prior scan: the page is idle and has no results. A machine whose only
    // reclaimable data is caught by the light scanners must still be cleaned.
    store.status = ScanStatus.Idle
    const systemScan = vi.fn().mockResolvedValue([systemResult([{ id: 'a' }])])
    const systemClean = vi.fn().mockResolvedValue(emptyClean)
    const winSxSScan = vi.fn().mockResolvedValue([winSxSResult()])
    const winSxSClean = vi.fn().mockResolvedValue(emptyClean)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = {
      systemScan,
      systemClean,
      winSxSScan,
      winSxSClean,
    }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('fullCleanButton'))
    fireEvent.click(screen.getByText('confirmFullCleanLabel'))

    await waitFor(() => expect(systemClean).toHaveBeenCalledWith(['a']))
    expect(winSxSClean).toHaveBeenCalled()
    expect(systemScan).toHaveBeenCalled()
  })

  it('cleans every found item even when nothing is selected', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }, { id: 'b' }])]
    const systemClean = vi.fn().mockResolvedValue(emptyClean)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))
    fireEvent.click(screen.getByText('confirmQuickCleanLabel'))

    await waitFor(() => expect(systemClean).toHaveBeenCalledWith(['a', 'b']))
  })

  it('honours excluded subcategories: an excluded category is not cleaned', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }])]
    store.excludedSubcategories = new Set([`${CleanerType.System}:system-temp`])
    const systemClean = vi.fn().mockResolvedValue(emptyClean)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))
    fireEvent.click(screen.getByText('confirmQuickCleanLabel'))

    await waitFor(() => expect(store.setCleanSummary).toHaveBeenCalled())
    expect(systemClean).not.toHaveBeenCalled()
  })

  it('cleans a category that is not excluded while skipping the excluded one', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }]), systemResult([{ id: 'b' }], 'system-logs')]
    store.excludedSubcategories = new Set([`${CleanerType.System}:system-temp`])
    const systemClean = vi.fn().mockResolvedValue(emptyClean)
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))
    fireEvent.click(screen.getByText('confirmQuickCleanLabel'))

    await waitFor(() => expect(systemClean).toHaveBeenCalledWith(['b']))
  })

  it('ignores a second confirm while a clean is already running', async () => {
    store.status = ScanStatus.Complete
    store.results = [systemResult([{ id: 'a' }])]
    const systemClean = vi.fn().mockReturnValue(new Promise(() => {}))
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { systemClean }

    render(<CleanerPage />)
    fireEvent.click(screen.getByText('quickCleanButton'))

    // Call the confirm handler twice synchronously, as a double-click would.
    const confirm = mocks.confirmOnConfirm
    await act(async () => {
      confirm?.()
      confirm?.()
    })

    await waitFor(() => expect(systemClean).toHaveBeenCalled())
    expect(systemClean).toHaveBeenCalledTimes(1)
  })
})
