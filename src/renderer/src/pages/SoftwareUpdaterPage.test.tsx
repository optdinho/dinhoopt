// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
  apps: [] as { id: string; name: string; severity: string; selected: boolean }[],
  ignoredApps: [] as { id: string; name: string; severity: string; selected: boolean }[],
  ignoredIds: new Set<string>(),
  loading: false,
  updating: false,
  progress: null as unknown,
  updateResult: null as unknown,
  error: null as string | null,
  hasChecked: false,
  packageManagerAvailable: true,
  packageManagerName: 'winget' as string | null,
  searchQuery: '',
  severityFilter: 'all',
  sortField: 'severity',
  sortDirection: 'asc',
  autoInstallUpdates: false,
  autoInstallSchedule: 'daily' as 'daily' | 'weekly' | null,

  setApps: vi.fn(),
  setLoading: vi.fn(),
  setUpdating: vi.fn(),
  setProgress: vi.fn(),
  setUpdateResult: vi.fn(),
  setError: vi.fn(),
  setHasChecked: vi.fn(),
  setPackageManagerAvailable: vi.fn(),
  setPackageManagerName: vi.fn(),
  setSearchQuery: vi.fn(),
  setSeverityFilter: vi.fn(),
  setSortField: vi.fn(),
  setSortDirection: vi.fn(),
  selectAll: vi.fn(),
  deselectAll: vi.fn(),
  toggleAppSelected: vi.fn(),
  removeApps: vi.fn(),
  ignoreApp: vi.fn(),
  unignoreApp: vi.fn(),
  loadIgnoredIds: vi.fn(),
  reset: vi.fn(),
}

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: (s: typeof store) => unknown) => fn,
}))

vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
    getState: () => store,
  }),
}))

const settingsStore = {
  settings: { autoInstallUpdates: false, autoInstallSchedule: 'daily' as 'daily' | 'weekly' | null } as {
    autoInstallUpdates: boolean
    autoInstallSchedule: 'daily' | 'weekly' | null
  },
  updateSettings: vi.fn((patch: Partial<Record<string, unknown>>) => {
    settingsStore.settings = { ...settingsStore.settings, ...(patch as object) }
  }),
}

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: Object.assign((selector: (s: typeof settingsStore) => unknown) => selector(settingsStore), {
    getState: () => settingsStore,
  }),
}))

vi.mock('@/stores/history-store', () => ({
  useHistoryStore: { getState: () => ({ addEntry: vi.fn() }) },
}))

vi.mock('@/lib/renderer-logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('lucide-react', () => {
  const Icon = (props: Record<string, unknown>) => <div {...props} />
  const icons = [
    'ArrowUpDown',
    'ChevronDown',
    'ChevronRight',
    'CircleCheckBig',
    'CircleX',
    'Download',
    'EyeOff',
    'Filter',
    'Loader2',
    'Package',
    'RefreshCw',
    'Search',
    'Sparkles',
    'TriangleAlert',
    'X',
  ]
  const map: Record<string, unknown> = {}
  for (const name of icons) map[name] = Icon
  return map
})

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}))

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

vi.mock('@/components/shared/ErrorAlert', () => ({
  ErrorAlert: ({ message }: { message: string }) => <div data-testid="error-alert">{message}</div>,
}))

vi.mock('@/components/shared/OutsideClickHandler', () => ({
  OutsideClickHandler: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/shared/StatCard', () => ({
  StatCard: ({ label }: { label: string }) => <div data-testid="stat-card">{label}</div>,
}))

vi.mock('./software-updater/SoftwareUpdaterRows', () => ({
  AppRow: ({ app, onIgnore }: { app: { id: string }; onIgnore: () => void }) => (
    <div data-testid={`app-${app.id}`}>
      <button type="button" data-testid={`ignore-${app.id}`} onClick={onIgnore}>
        ignore
      </button>
    </div>
  ),
  IgnoredRow: ({ app, onUnignore }: { app: { id: string }; onUnignore: () => void }) => (
    <div data-testid={`ignored-${app.id}`}>
      <button type="button" data-testid={`unignore-${app.id}`} onClick={onUnignore}>
        unignore
      </button>
    </div>
  ),
  UpToDateRow: ({ app }: { app: { id: string } }) => <div data-testid={`uptodate-${app.id}`} />,
}))

let loaderFn: (() => void) | null = null

vi.mock('./software-updater/useIgnoredUpdatesLoader', () => ({
  useInitialLoader: (fn: () => void) => {
    loaderFn = fn
  },
}))

vi.mock('./software-updater/useUpdaterProgress', () => ({
  useUpdaterProgress: () => {},
}))

vi.mock('./software-updater/useFilteredAndSortedApps', () => ({
  useFilteredAndSortedApps: () => ({
    filteredApps: store.apps,
    upToDate: [],
    selectedCount: 0,
    allSelected: false,
    isBusy: store.loading || store.updating,
    majorCount: 0,
    minorCount: 0,
    patchCount: 0,
  }),
}))

const mockCheck = vi.fn()
const mockSettingsSet = vi.fn()

window.dinho = {
  softwareUpdateCheck: mockCheck,
  softwareUpdateRun: vi.fn(),
  settingsSet: mockSettingsSet,
  log: vi.fn(),
} as unknown as typeof window.dinho

import { SoftwareUpdaterPage } from './SoftwareUpdaterPage'

function resetStore() {
  store.apps = []
  store.ignoredApps = []
  store.ignoredIds = new Set()
  store.loading = false
  store.updating = false
  store.updateResult = null
  store.error = null
  store.hasChecked = false
  store.packageManagerAvailable = true
  store.packageManagerName = 'winget'
  settingsStore.settings = { autoInstallUpdates: false, autoInstallSchedule: 'daily' }
  loaderFn = null
}

describe('SoftwareUpdaterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    mockCheck.mockResolvedValue({
      apps: [],
      totalCount: 0,
      majorCount: 0,
      minorCount: 0,
      patchCount: 0,
      packageManagerAvailable: true,
      packageManagerName: 'winget',
    })
    mockSettingsSet.mockResolvedValue({ success: true })
  })

  it('renders the page header when not embedded', () => {
    render(<SoftwareUpdaterPage />)
    expect(screen.getByTestId('page-header')).toBeTruthy()
  })

  it('shows "all up to date" when there are no updates and no error', () => {
    store.hasChecked = true
    store.packageManagerAvailable = true
    render(<SoftwareUpdaterPage embedded />)
    expect(screen.getByText('softwareUpdater.allUpToDateTitle')).toBeTruthy()
  })

  it('does not show "all up to date" when an error is present', () => {
    store.hasChecked = true
    store.error = 'softwareUpdater.errorCheckFailed'
    render(<SoftwareUpdaterPage embedded />)
    expect(screen.queryByText('softwareUpdater.allUpToDateTitle')).toBeNull()
    expect(screen.getByTestId('error-alert').textContent).toContain('softwareUpdater.errorCheckFailed')
  })

  it('suppresses the package-manager warning when an error is present', () => {
    store.hasChecked = true
    store.packageManagerAvailable = false
    store.error = 'softwareUpdater.errorCheckFailed'
    render(<SoftwareUpdaterPage embedded />)
    expect(screen.queryByText('softwareUpdater.packageManagerNotFound.wingetNotFound')).toBeNull()
    expect(screen.getByTestId('error-alert')).toBeTruthy()
  })

  it('sets an error and skips the success toast when the check reports a failure', async () => {
    mockCheck.mockResolvedValue({
      apps: [],
      totalCount: 0,
      majorCount: 0,
      minorCount: 0,
      patchCount: 0,
      packageManagerAvailable: true,
      packageManagerName: 'winget',
      failure: 'check-failed',
    })
    render(<SoftwareUpdaterPage embedded />)
    await act(async () => {
      loaderFn?.()
    })
    await vi.waitFor(() => {
      expect(store.setError).toHaveBeenCalledWith('softwareUpdater.errorCheckFailed')
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('reverts the auto-install toggle and toasts when persistence fails', async () => {
    mockSettingsSet.mockResolvedValue({ success: false, error: 'rejected' })
    render(<SoftwareUpdaterPage embedded />)

    await act(async () => {
      fireEvent.click(screen.getByText('softwareUpdater.autoInstallLabel'))
    })

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('softwareUpdater.settingsSaveFailed')
    })
    expect(settingsStore.updateSettings).toHaveBeenLastCalledWith({ autoInstallUpdates: false })
  })

  it('reverts the auto-install schedule and toasts when persistence rejects', async () => {
    settingsStore.settings = { autoInstallUpdates: true, autoInstallSchedule: 'daily' }
    mockSettingsSet.mockRejectedValue(new Error('boom'))
    render(<SoftwareUpdaterPage embedded />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText('softwareUpdater.autoInstallScheduleLabel'), {
        target: { value: 'weekly' },
      })
    })

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('softwareUpdater.settingsSaveFailed')
    })
    expect(settingsStore.updateSettings).toHaveBeenLastCalledWith({ autoInstallSchedule: 'daily' })
  })

  it('toasts when persisting an ignored app fails', async () => {
    store.hasChecked = true
    store.apps = [{ id: 'App1', name: 'App1', severity: 'minor', selected: false }]
    store.ignoreApp.mockResolvedValue(false)
    render(<SoftwareUpdaterPage embedded />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('ignore-App1'))
    })

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('softwareUpdater.settingsSaveFailed')
    })
  })

  it('dismisses the update result banner', () => {
    store.updateResult = { succeeded: 2, failed: 0, errors: [] }
    render(<SoftwareUpdaterPage embedded />)

    fireEvent.click(screen.getByLabelText('common:dismiss'))

    expect(store.setUpdateResult).toHaveBeenCalledWith(null)
  })

  it('lists the failing app name in the result banner', () => {
    store.updateResult = {
      succeeded: 0,
      failed: 1,
      errors: [{ appId: 'Some.App', name: 'Some App', reason: 'Installer type changed' }],
    }
    render(<SoftwareUpdaterPage embedded />)

    expect(screen.getByText(/Some App/)).toBeTruthy()
  })
})
