// @vitest-environment jsdom
import { CleanerType, ScanStatus } from '@shared/enums'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  protectRecycleBin: false,
  platform: 'win32',
}))

const store = {
  status: ScanStatus.Idle,
  results: [] as unknown[],
  progress: null,
  cleanSummary: null,
  setStatus: vi.fn(),
  setResults: vi.fn(),
  addResults: vi.fn(),
  setProgress: vi.fn(),
  setCleanSummary: vi.fn(),
  toggleSubcategory: vi.fn(),
  getSelectedIds: () => [] as string[],
  getSelectedSize: () => 0,
  getTotalSize: () => 0,
  toggleCategory: vi.fn(),
}

vi.mock('@/stores/scan-store', () => ({ useScanStore: () => store }))
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (sel: (s: unknown) => unknown) =>
    sel({ settings: { cleaner: { protectRecycleBin: mocks.protectRecycleBin } } }),
}))
vi.mock('@/stores/stats-store', () => ({
  useStatsStore: (sel: (s: unknown) => unknown) => sel({ recompute: vi.fn() }),
}))
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: (sel: (s: unknown) => unknown) => sel({ addEntry: vi.fn() }),
}))
vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ platform: mocks.platform }) }))
vi.mock('@/lib/renderer-logger', () => ({ default: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Heavy children stubbed out: this suite is about the page's own structure.
vi.mock('@/components/cleaner/CleanSummary', () => ({ CleanSummary: () => null }))
vi.mock('@/components/cleaner/NetworkCleanupModal', () => ({ NetworkCleanupModal: () => null }))
vi.mock('@/components/shared/ScanProgress', () => ({ ScanProgress: () => null }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/StickyActionBar', () => ({ StickyActionBar: () => null }))
vi.mock('@/components/shared/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
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
  mocks.protectRecycleBin = false
})

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
  it('keeps only the scan and clean actions in the header', () => {
    render(<CleanerPage />)
    const header = screen.getByTestId('page-header-actions')
    expect(within(header).getByText('scanButton')).not.toBeNull()
    expect(within(header).getByText('cleanButton')).not.toBeNull()
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
