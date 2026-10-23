// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerState = vi.hoisted(() => ({ pathname: '/', navigate: vi.fn() }))

vi.mock('@/lib/app-version', () => ({ APP_VERSION: '2.0.9' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: routerState.pathname }),
  useNavigate: () => routerState.navigate,
}))

vi.mock('@/assets/logo-80.png', () => ({ default: 'logo.png' }))

vi.mock('lucide-react', () => {
  const Stub = () => null
  const names = [
    'Activity',
    'BatteryCharging',
    'Bug',
    'CalendarClock',
    'ChevronRight',
    'Clapperboard',
    'ClipboardCheck',
    'Clock',
    'CopyCheck',
    'Cpu',
    'Database',
    'Download',
    'Eraser',
    'Eye',
    'FileUp',
    'Flame',
    'FolderX',
    'Gamepad2',
    'Gauge',
    'Globe',
    'HardDrive',
    'History',
    'Info',
    'KeyRound',
    'LayoutDashboard',
    'MemoryStick',
    'Menu',
    'MousePointerClick',
    'Package',
    'PackageCheck',
    'PackageMinus',
    'PowerOff',
    'Rocket',
    'Scan',
    'Search',
    'Server',
    'Settings',
    'Shield',
    'ShieldAlert',
    'Sliders',
    'Sparkles',
    'Trash2',
    'Wifi',
    'Wrench',
    'X',
    'Zap',
  ]
  const map: Record<string, unknown> = {}
  for (const name of names) map[name] = Stub
  return map
})

vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({
    platform: 'win32',
    features: {
      registry: true,
      debloater: true,
      drivers: true,
      gameMode: true,
      firewallAudit: true,
      contextMenu: true,
      windowsTweaks: true,
      benchmark: true,
      clips: true,
      compliance: true,
      vulnerability: true,
    },
  }),
}))

vi.mock('@/stores/driver-store', () => ({
  useDriverStore: (selector: (s: unknown) => unknown) => selector({ updates: [] }),
}))
vi.mock('@/stores/game-mode-store', () => ({
  useGameModeStore: (selector: (s: unknown) => unknown) => selector({ active: false }),
}))
vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: (selector: (s: unknown) => unknown) => selector({ apps: [] }),
}))

import { Sidebar } from './Sidebar'

const noop = () => {}

function renderSidebar() {
  return render(<Sidebar collapsed={false} onToggle={noop} />)
}

describe('Sidebar news dots', () => {
  beforeEach(() => {
    localStorage.clear()
    routerState.pathname = '/'
  })
  afterEach(() => localStorage.clear())

  it('shows no dots on a fresh install', () => {
    const { queryAllByTestId } = renderSidebar()
    expect(queryAllByTestId(/^nav-news-/)).toHaveLength(0)
  })

  it('marks only the sections with news since the recorded version', () => {
    localStorage.setItem('dinho-nav-news', JSON.stringify({ baseline: '2.0.7', dismissed: {} }))
    const { getByTestId, queryByTestId } = renderSidebar()
    expect(getByTestId('nav-news-optimize')).toBeTruthy()
    expect(queryByTestId('nav-news-protect')).toBeNull()
    expect(queryByTestId('nav-news-clean')).toBeNull()
  })

  it('clears the dot once the user navigates into that section', async () => {
    localStorage.setItem('dinho-nav-news', JSON.stringify({ baseline: '2.0.7', dismissed: {} }))
    const view = renderSidebar()
    expect(view.getByTestId('nav-news-optimize')).toBeTruthy()
    routerState.pathname = '/settings'
    view.rerender(<Sidebar collapsed={false} onToggle={() => {}} />)
    await waitFor(() => expect(view.queryByTestId('nav-news-optimize')).toBeNull())
  })

  it('does not light up when the baseline already matches the running version', () => {
    localStorage.setItem('dinho-nav-news', JSON.stringify({ baseline: '2.0.9', dismissed: {} }))
    const { queryAllByTestId } = renderSidebar()
    expect(queryAllByTestId(/^nav-news-/)).toHaveLength(0)
  })
})

describe('Sidebar group parents', () => {
  beforeEach(() => {
    localStorage.clear()
    routerState.pathname = '/'
    routerState.navigate.mockClear()
  })
  afterEach(() => localStorage.clear())

  it('expands without navigating when a parent is clicked', () => {
    const { getByRole } = renderSidebar()
    const parent = getByRole('button', { name: 'systemHardening' })
    expect(parent.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(parent)
    expect(routerState.navigate).not.toHaveBeenCalled()
    expect(parent.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens the parent submenu when a child route is active', () => {
    routerState.pathname = '/privacy'
    const { getByRole } = renderSidebar()
    expect(getByRole('button', { name: 'systemHardening' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('highlights the parent while a child route is active', () => {
    routerState.pathname = '/privacy'
    const { getByRole } = renderSidebar()
    const parent = getByRole('button', { name: 'systemHardening' })
    // The active bar is the only element carrying the plain section colour class.
    expect(parent.querySelector('.bg-red-500')).not.toBeNull()
  })

  it('still navigates from a leaf item', () => {
    const { getByRole } = renderSidebar()
    fireEvent.click(getByRole('button', { name: 'network' }))
    expect(routerState.navigate).toHaveBeenCalledWith('/network')
  })
})

describe('Sidebar search shortcut hint', () => {
  beforeEach(() => {
    localStorage.clear()
    routerState.pathname = '/'
  })
  afterEach(() => localStorage.clear())

  it('advertises Ctrl+K (not the macOS ⌘K) on Windows', () => {
    const { container } = renderSidebar()
    const kbd = container.querySelector('kbd')
    expect(kbd).toBeTruthy()
    expect(kbd?.textContent).toBe('Ctrl+K')
    expect(container.textContent).not.toContain('⌘K')
  })
})
