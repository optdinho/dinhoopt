// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStore = {
  tweaks: [],
  dnsPresets: [],
  dnsBenchmark: [],
  dnsBenchmarking: false,
  currentDns: { primary: null, secondary: null, source: 'none' },
  selectedIds: new Set<string>(),
  scanning: false,
  applying: false,
  progress: null,
  lastResult: null,
  revertResult: null,
  expandedCategories: new Set<string>(),
  gamingTimer: null,
  gamingTimerLoading: false,
  load: vi.fn(),
  loadDnsPresets: vi.fn(),
  loadCurrentDns: vi.fn(),
  loadGamingTimer: vi.fn(),
  toggle: vi.fn(),
  apply: vi.fn(),
  revert: vi.fn(),
  selectAll: vi.fn(),
  deselectAll: vi.fn(),
  setDns: vi.fn(),
  benchmarkDns: vi.fn(),
  toggleCategory: vi.fn(),
  netshTcpApply: vi.fn(),
  netshTcpRevert: vi.fn(),
  setGamingTimer: vi.fn(),
  revertGamingTimer: vi.fn(),
  setAutoTuning: vi.fn(),
}

vi.mock('@/stores/windows-tweaks-store', () => ({
  useWindowsTweaksStore: Object.assign((selector: (s: typeof mockStore) => unknown) => selector(mockStore), {
    getState: () => mockStore,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('framer-motion', async () => (await import('../../../test-motion-mock')).motionMock)

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = [
    'Accessibility',
    'TriangleAlert',
    'CircleCheckBig',
    'ChevronDown',
    'Cpu',
    'Gamepad2',
    'Globe',
    'Keyboard',
    'Monitor',
    'MonitorCog',
    'Mouse',
    'Shield',
    'Timer',
    'Wifi',
    'CircleX',
    'ExternalLink',
    'Info',
    'Loader2',
    'Zap',
    'ZapOff',
  ]
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/TweakRow', () => ({
  TweakRow: (_props: any) => null,
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

import { WindowsTweaksPage } from './WindowsTweaksPage'

describe('WindowsTweaksPage', () => {
  beforeEach(() => {
    mockStore.tweaks = []
    mockStore.scanning = false
    vi.clearAllMocks()
  })

  it('renders empty state when no tweaks', () => {
    render(<WindowsTweaksPage />)
    expect(screen.getByTestId('empty-state')).toBeTruthy()
    expect(screen.getByText('emptyStateTitle')).toBeTruthy()
    expect(screen.getByText('emptyStateDescription')).toBeTruthy()
  })

  it('renders scanning spinner when scanning', () => {
    mockStore.scanning = true
    render(<WindowsTweaksPage />)
    expect(screen.getByText('scanningTweaks')).toBeTruthy()
    expect(screen.queryByTestId('empty-state')).toBeNull()
  })

  it('renders tweaks when available', () => {
    mockStore.tweaks = [
      { applied: false, tweak: { id: 't1', name: 'Tweak 1', description: '', category: 'system', level: 'basico' } },
      { applied: true, tweak: { id: 't2', name: 'Tweak 2', description: '', category: 'mouse', level: 'basico' } },
    ] as never
    render(<WindowsTweaksPage />)
    expect(screen.queryByTestId('empty-state')).toBeNull()
  })
})

describe('WindowsTweaksPage layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.scanning = false
    mockStore.tweaks = [
      { applied: false, tweak: { id: 't1', name: 'Tweak 1', description: '', category: 'system', level: 'basico' } },
    ] as never
    mockStore.dnsPresets = []
    mockStore.currentDns = { primary: null, secondary: null, source: 'none' }
    mockStore.gamingTimer = null
  })

  it('shows the advanced tools before the tweak categories', () => {
    render(<WindowsTweaksPage />)
    const categories = screen.getByTestId('tweak-categories')
    const advanced = screen.getByTestId('advanced-tools')
    expect(advanced.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('collects TCP/IP, timer and DNS into one advanced section', () => {
    render(<WindowsTweaksPage />)
    const advanced = screen.getByTestId('advanced-tools')
    expect(advanced.querySelector('[data-testid="section-tcpip"]')).not.toBeNull()
    expect(advanced.querySelector('[data-testid="section-timer"]')).not.toBeNull()
  })

  it('hides the DNS section when there are no presets', () => {
    render(<WindowsTweaksPage />)
    expect(screen.getByTestId('advanced-tools').querySelector('[data-testid="section-dns"]')).toBeNull()
  })

  it('shows the DNS section when presets exist', () => {
    mockStore.dnsPresets = [{ name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' }] as never
    render(<WindowsTweaksPage />)
    expect(screen.getByTestId('section-dns')).not.toBeNull()
  })

  it('opens with every category collapsed', () => {
    expect(mockStore.expandedCategories.size).toBe(0)
  })

  it('groups the bulk actions with the counters in one toolbar', () => {
    render(<WindowsTweaksPage />)
    const toolbar = screen.getByTestId('tweak-toolbar')
    expect(toolbar.querySelector('[data-testid="toolbar-counters"]')).not.toBeNull()
    expect(toolbar.querySelector('[data-testid="toolbar-actions"]')).not.toBeNull()
  })

  it('does not double the page padding the shell already provides', () => {
    const { container } = render(<WindowsTweaksPage />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toMatch(/(^|\s)p-6(\s|$)/)
  })

  it('keeps the empty and scanning states free of the extra padding too', () => {
    const { container } = render(<WindowsTweaksPage />)
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/(^|\s)p-6(\s|$)/)
  })
})
