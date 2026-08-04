// @vitest-environment jsdom

import type { AppInstallerApp, AppInstallProgress, AppInstallResult } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sampleApps: AppInstallerApp[] = [
  {
    id: 'Mozilla.Firefox',
    name: 'Firefox',
    category: 'browser',
    description: 'Browser',
    isInstalled: false,
  },
  {
    id: 'Google.Chrome',
    name: 'Chrome',
    category: 'browser',
    isInstalled: true,
  },
  {
    id: 'Discord.Discord',
    name: 'Discord',
    category: 'communication',
    isInstalled: false,
  },
]

const sampleResult: AppInstallResult = {
  succeeded: 1,
  failed: 1,
  errors: [{ appId: 'Discord.Discord', name: 'Discord', reason: 'rejected' }],
}

const mockStore = {
  apps: [] as AppInstallerApp[],
  loading: false,
  installing: false,
  cancelled: false,
  progress: null as AppInstallProgress | null,
  installResult: null as AppInstallResult | null,
  error: null as string | null,
  hasLoaded: false,
  wingetAvailable: true,
  searchQuery: '',
  categoryFilter: 'all',
  showOnlySelected: false,
  selectedIds: new Set<string>(),
  setApps: vi.fn(),
  setLoading: vi.fn(),
  setInstalling: vi.fn(),
  setProgress: vi.fn(),
  setInstallResult: vi.fn(),
  setError: vi.fn(),
  setHasLoaded: vi.fn(),
  setWingetAvailable: vi.fn(),
  setSearchQuery: vi.fn(),
  setCategoryFilter: vi.fn(),
  setShowOnlySelected: vi.fn(),
  toggleSelected: vi.fn(),
  selectCategory: vi.fn(),
  deselectAll: vi.fn(),
  reset: vi.fn(),
}

vi.mock('@/stores/app-installer-store', () => ({
  useAppInstallerStore: Object.assign((selector: (s: typeof mockStore) => unknown) => selector(mockStore), {
    getState: () => mockStore,
  }),
}))

const mockAddEntry = vi.fn()
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: { getState: () => ({ addEntry: mockAddEntry }) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = [
    'Check',
    'CircleCheckBig',
    'CircleX',
    'Download',
    'Loader2',
    'Package',
    'RefreshCw',
    'Search',
    'TriangleAlert',
    'X',
  ]
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, description }: any) => (
    <div data-testid="page-header">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}))

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description }: any) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}))

vi.mock('@/components/shared/ErrorAlert', () => ({
  ErrorAlert: ({ message }: any) => <div data-testid="error-alert">{message}</div>,
}))

vi.mock('@/components/shared/StatCard', () => ({
  StatCard: ({ label, value }: any) => (
    <div data-testid="stat-card">
      <span>{label}</span>
      <span>{String(value)}</span>
    </div>
  ),
}))

const mockListAvailable = vi.fn<() => Promise<{ apps: AppInstallerApp[]; wingetAvailable: boolean }>>()
const mockInstall = vi.fn<(ids: string[]) => Promise<AppInstallResult>>()
const mockCancel = vi.fn<() => Promise<unknown>>()
const mockOnProgress = vi.fn<(cb: (p: AppInstallProgress) => void) => () => void>(() => vi.fn())

window.dinho = {
  appInstallerListAvailable: mockListAvailable,
  appInstallerInstall: mockInstall,
  appInstallerCancel: mockCancel,
  onAppInstallerProgress: mockOnProgress,
  log: vi.fn(),
} as Record<string, unknown> as typeof window.dinho

import { AppInstallerPage } from './AppInstallerPage'

describe('AppInstallerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.apps = []
    mockStore.loading = false
    mockStore.installing = false
    mockStore.progress = null
    mockStore.installResult = null
    mockStore.error = null
    mockStore.hasLoaded = false
    mockStore.wingetAvailable = true
    mockStore.searchQuery = ''
    mockStore.categoryFilter = 'all'
    mockStore.showOnlySelected = false
    mockStore.selectedIds = new Set<string>()
    mockListAvailable.mockResolvedValue({ apps: sampleApps, wingetAvailable: true })
    mockInstall.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] })
    mockCancel.mockResolvedValue(undefined)
  })

  it('renders the page header', () => {
    render(<AppInstallerPage />)
    expect(screen.getByTestId('page-header')).toBeTruthy()
  })

  it('shows empty state before loading', () => {
    render(<AppInstallerPage />)
    expect(screen.getByTestId('empty-state')).toBeTruthy()
  })

  it('auto-loads apps on mount and renders them', async () => {
    mockStore.hasLoaded = true
    mockStore.apps = sampleApps
    render(<AppInstallerPage />)
    expect(await screen.findByText('Firefox')).toBeTruthy()
    expect(screen.getByText('Chrome')).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
  })

  it('renders the winget not found warning', () => {
    mockStore.hasLoaded = true
    mockStore.wingetAvailable = false
    render(<AppInstallerPage />)
    expect(screen.getByText('wingetNotFound')).toBeTruthy()
    expect(screen.getByText(/wingetRequired/)).toBeTruthy()
  })

  it('renders an error alert when an error is present', () => {
    mockStore.hasLoaded = true
    mockStore.error = 'listFailed'
    render(<AppInstallerPage />)
    expect(screen.getByTestId('error-alert').textContent).toContain('listFailed')
  })

  it('renders stat cards after load', () => {
    mockStore.hasLoaded = true
    mockStore.apps = sampleApps
    render(<AppInstallerPage />)
    const cards = screen.getAllByTestId('stat-card')
    expect(cards.length).toBe(4)
    expect(cards[0]?.textContent).toContain('statAvailable')
  })

  it('renders install progress bar while installing', () => {
    mockStore.installing = true
    mockStore.progress = {
      phase: 'installing',
      current: 1,
      total: 2,
      currentApp: 'Mozilla.Firefox',
      percent: 50,
      status: 'in-progress',
    }
    render(<AppInstallerPage />)
    expect(screen.getByText(/installingProgress/)).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('renders a success result banner when all installs succeed', () => {
    mockStore.hasLoaded = true
    mockStore.installResult = { succeeded: 2, failed: 0, errors: [] }
    render(<AppInstallerPage />)
    expect(screen.getByText(/resultInstalled/)).toBeTruthy()
  })

  it('renders a partial result banner with per-app errors', () => {
    mockStore.hasLoaded = true
    mockStore.installResult = sampleResult
    render(<AppInstallerPage />)
    expect(screen.getByText(/resultFailed/)).toBeTruthy()
    expect(screen.getByText(/Discord: rejected/)).toBeTruthy()
  })

  it('shows a cancel button while installing', () => {
    mockStore.installing = true
    render(<AppInstallerPage />)
    expect(screen.getByText('cancelButton')).toBeTruthy()
  })

  it('shows the install selected button when apps are selected', () => {
    mockStore.hasLoaded = true
    mockStore.selectedIds = new Set(['Mozilla.Firefox'])
    render(<AppInstallerPage />)
    expect(screen.getByText('installSelected')).toBeTruthy()
  })

  it('filters apps by search query', () => {
    mockStore.hasLoaded = true
    mockStore.apps = sampleApps
    mockStore.searchQuery = 'fire'
    render(<AppInstallerPage />)
    expect(screen.queryByText('Discord')).toBeNull()
  })

  it('filters apps to selected only when showOnlySelected', () => {
    mockStore.hasLoaded = true
    mockStore.apps = sampleApps
    mockStore.showOnlySelected = true
    mockStore.selectedIds = new Set(['Google.Chrome'])
    render(<AppInstallerPage />)
    expect(screen.getByText('Chrome')).toBeTruthy()
    expect(screen.queryByText('Firefox')).toBeNull()
  })

  it('installs a single app from its install button', () => {
    mockStore.hasLoaded = true
    mockStore.apps = sampleApps
    render(<AppInstallerPage />)
    const buttons = screen.getAllByText('installButton')
    fireEvent.click(buttons[0] as HTMLElement)
    expect(mockInstall).toHaveBeenCalledWith(['Mozilla.Firefox'])
  })

  it('toasts failures reported through the progress subscription', () => {
    render(<AppInstallerPage />)
    const progressListener = mockOnProgress.mock.calls[0]?.[0]
    progressListener?.({
      phase: 'failed',
      current: 1,
      total: 1,
      currentApp: 'Discord.Discord',
      percent: 100,
      status: 'failed',
      error: 'rejected',
    })
    expect(toast.error).toHaveBeenCalledWith('Discord.Discord: rejected')
  })
})
