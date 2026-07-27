// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStore = {
  tweaks: [],
  dnsPresets: [],
  selectedIds: new Set<string>(),
  scanning: false,
  applying: false,
  progress: null,
  lastResult: null,
  revertResult: null,
  expandedCategories: new Set<string>(['mouse', 'network', 'system', 'gaming']),
  gamingTimer: null,
  gamingTimerLoading: false,
  load: vi.fn(),
  loadDnsPresets: vi.fn(),
  loadGamingTimer: vi.fn(),
  toggle: vi.fn(),
  apply: vi.fn(),
  revert: vi.fn(),
  selectAll: vi.fn(),
  deselectAll: vi.fn(),
  setDns: vi.fn(),
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

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        // biome-ignore lint/suspicious/noExplicitAny: test
        ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
    // biome-ignore lint/suspicious/noExplicitAny: test
  ) as any,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}))

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
    'Zap',
  ]
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/components/TweakRow', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  TweakRow: (_props: any) => null,
}))

vi.mock('@/components/layout/PageHeader', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  PageHeader: ({ title, description }: any) => (
    <div data-testid="page-header">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}))

vi.mock('@/components/shared/EmptyState', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test mock
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
