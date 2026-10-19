// @vitest-environment jsdom

import type { StartupBootTrace, StartupItem } from '@shared/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfirmRender = vi.fn()

// The mocked `t` is a single stable function, like the real i18next instance:
// `loadItems` is a useCallback([t]), so an unstable `t` would change its
// identity on every render and re-trigger the mount effect forever.
vi.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts && 'level' in opts ? `${key}::${String(opts.level)}` : key
  return { useTranslation: () => ({ t }) }
})

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('lucide-react', () => {
  const Icon = (props: any) => <div {...props} />
  const iconMap: Record<string, any> = {}
  for (const name of ['CalendarClock', 'Filter', 'RefreshCw', 'Shield', 'Trash2', 'Zap']) {
    iconMap[name] = Icon
  }
  return iconMap
})

vi.mock('@/lib/renderer-logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, action }: any) => (
    <div data-testid="page-header">
      <div>{title}</div>
      {action}
    </div>
  ),
}))

vi.mock('@/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: (props: any) => {
    mockConfirmRender(props)
    if (!props.open) return null
    return (
      <div data-testid="confirm-dialog">
        <button type="button" data-testid="confirm-accept" onClick={props.onConfirm}>
          accept
        </button>
      </div>
    )
  },
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

vi.mock('@/stores/history-store', () => ({
  useHistoryStore: { getState: () => ({ addEntry: vi.fn().mockResolvedValue(undefined) }) },
}))

vi.mock('./startup/StartupComponents', () => ({
  BootTracePanel: () => null,
  impactStyles: {
    high: { bg: '#7f1d1d', text: '#fca5a5' },
    medium: { bg: '#78350f', text: '#fcd34d' },
    low: { bg: '#14532d', text: '#86efac' },
    none: { bg: '#27272a', text: '#a1a1aa' },
  },
  SafetyTooltip: ({ text, children }: any) => (
    <div data-testid="safety-tooltip" data-text={text}>
      {children}
    </div>
  ),
  safetyIcon: () => () => null,
  safetyScoreColor: () => ({ bg: '#000', text: '#fff' }),
  sourceKeys: {
    'registry-hkcu': 'sourceUserRegistry',
    'registry-hklm': 'sourceSystemRegistry',
    'startup-folder': 'sourceStartupFolder',
    'task-scheduler': 'sourceTaskScheduler',
  },
}))

import logger from '@/lib/renderer-logger'
import { useStartupStore } from '@/stores/startup-store'

import { StartupPage } from './StartupPage'

const emptyTrace: StartupBootTrace = {
  totalBootMs: 0,
  lastBootDate: null,
  mainPathMs: 0,
  startupAppsMs: 0,
  entries: [],
  available: false,
  needsAdmin: false,
}

function makeItem(overrides: Partial<StartupItem> = {}): StartupItem {
  return {
    id: 'item-1',
    name: 'Test App',
    displayName: 'Test App',
    enabled: true,
    source: 'registry-hkcu',
    location: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    command: 'C:\\App\\test.exe',
    impact: 'high',
    publisher: 'Test Inc',
    ...overrides,
  }
}

describe('StartupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.dinho = {
      startupList: vi.fn().mockResolvedValue([]),
      startupBootTrace: vi.fn().mockResolvedValue(emptyTrace),
      startupSafetyFetch: vi.fn().mockResolvedValue({ ratings: [], pending: 0 }),
      startupToggle: vi.fn().mockResolvedValue(true),
      startupDelete: vi.fn().mockResolvedValue(true),
      log: vi.fn(),
    } as Record<string, unknown> as typeof window.dinho
    useStartupStore.setState({
      items: [],
      loading: false,
      error: null,
      sortBy: 'impact',
      filterBy: 'all',
      bootTrace: emptyTrace,
      traceLoading: false,
      deleteTarget: null,
      safetyRatings: {},
      safetyLoading: false,
      safetyFetched: true,
      expandedItemId: null,
    })
  })

  it('renders items with their localized source', () => {
    useStartupStore.setState({ items: [makeItem()] })
    render(<StartupPage />)
    expect(screen.getByText('Test App')).toBeTruthy()
    expect(screen.getByText('sourceUserRegistry')).toBeTruthy()
  })

  // ── S3a ───────────────────────────────────────────────────────────

  it('shows a localized enable/disable error when the toggle fails', async () => {
    useStartupStore.setState({ items: [makeItem({ enabled: true })] })
    vi.mocked(window.dinho.startupToggle).mockResolvedValue(false)
    const { container } = render(<StartupPage />)

    fireEvent.click(container.querySelector('button[class*="rounded-full"]')!)

    const alert = await screen.findByTestId('error-alert')
    expect(alert.textContent).toBe('errorFailedToDisable')
    expect(toast.error).toHaveBeenCalledWith('toastFailedToDisable', { description: 'toastAdminRequired' })
  })

  // ── S3b ───────────────────────────────────────────────────────────

  it('localizes the impact level instead of showing the raw enum value', () => {
    useStartupStore.setState({ items: [makeItem({ impact: 'high' })] })
    render(<StartupPage />)
    expect(screen.getByText('impactLabel::impactLevelHigh')).toBeTruthy()
  })

  // ── S3c ───────────────────────────────────────────────────────────

  it('exposes the toggle as an accessible switch with a localized label', () => {
    useStartupStore.setState({ items: [makeItem({ enabled: true })] })
    render(<StartupPage />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('disableItem')
  })

  // ── S4 ────────────────────────────────────────────────────────────

  it('shows safetyUnavailable once the fetch completed without ratings', () => {
    useStartupStore.setState({ items: [makeItem()] })
    render(<StartupPage />)
    expect(screen.getByTestId('safety-tooltip').getAttribute('data-text')).toBe('safetyUnavailable')
  })

  it('refetches safety ratings on manual refresh', async () => {
    useStartupStore.setState({ items: [makeItem()] })
    const { container } = render(<StartupPage />)
    expect(window.dinho.startupSafetyFetch).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('button[class*="p-2.5"]')!)

    await waitFor(() => expect(window.dinho.startupSafetyFetch).toHaveBeenCalled())
  })

  // ── S9 ────────────────────────────────────────────────────────────

  it('shows the filter empty state when no item matches the filter', () => {
    useStartupStore.setState({ items: [makeItem()], filterBy: 'disabled' })
    render(<StartupPage />)
    expect(screen.getByTestId('empty-state').textContent).toContain('filterEmptyTitle')
  })

  // ── S14 ───────────────────────────────────────────────────────────

  it('does not reload the list in a loop when it is empty (S14)', async () => {
    const startupList = vi.fn().mockResolvedValue([])
    window.dinho.startupList = startupList as unknown as typeof window.dinho.startupList
    render(<StartupPage />)

    await waitFor(() => expect(startupList).toHaveBeenCalled())

    expect(startupList).toHaveBeenCalledTimes(1)
  })

  // ── S8-r ──────────────────────────────────────────────────────────

  it('logs when the toggle request rejects', async () => {
    useStartupStore.setState({ items: [makeItem()] })
    vi.mocked(window.dinho.startupToggle).mockRejectedValue(new Error('ipc down'))
    const { container } = render(<StartupPage />)

    fireEvent.click(container.querySelector('button[class*="rounded-full"]')!)
    await screen.findByTestId('error-alert')

    expect(logger.error).toHaveBeenCalledWith('StartupPage', 'Failed to toggle startup item', expect.any(Error))
  })

  it('logs when the delete request rejects', async () => {
    const item = makeItem()
    useStartupStore.setState({ items: [item], deleteTarget: item })
    vi.mocked(window.dinho.startupDelete).mockRejectedValue(new Error('ipc down'))
    render(<StartupPage />)

    fireEvent.click(screen.getByTestId('confirm-accept'))

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith('StartupPage', 'Failed to delete startup item', expect.any(Error)),
    )
  })

  // ── S12 ───────────────────────────────────────────────────────────

  it('omits the dialog details when there is no command', () => {
    const item = makeItem({ command: '' })
    useStartupStore.setState({ items: [item], deleteTarget: item })
    render(<StartupPage />)
    const props = mockConfirmRender.mock.calls.at(-1)?.[0]
    expect(props).not.toHaveProperty('details')
  })

  it('passes the command as dialog details', () => {
    const item = makeItem({ command: '"C:\\App\\app.exe"' })
    useStartupStore.setState({ items: [item], deleteTarget: item })
    render(<StartupPage />)
    const props = mockConfirmRender.mock.calls.at(-1)?.[0]
    expect(props).toHaveProperty('details', '"C:\\App\\app.exe"')
  })

  it('passes a legacy "undefined" command through (S5 normalises at source)', () => {
    const item = makeItem({ command: 'undefined' })
    useStartupStore.setState({ items: [item], deleteTarget: item })
    render(<StartupPage />)
    const props = mockConfirmRender.mock.calls.at(-1)?.[0] as any
    expect(props.details).toBe('undefined')
  })
})
