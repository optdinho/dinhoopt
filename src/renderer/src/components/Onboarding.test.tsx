// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
        ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
  ) as any,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = [
    'Briefcase',
    'Check',
    'ChevronLeft',
    'ChevronRight',
    'Gamepad2',
    'Monitor',
    'Rocket',
    'Shield',
    'Sparkles',
  ]
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('@/components/shared/StaggerContainer', () => ({
  StaggerContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ platform: 'win32' }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))

const mockSystemScan = vi.fn()

window.dinho = {
  systemScan: mockSystemScan,
} as Record<string, unknown> as typeof window.dinho

import { Onboarding } from './Onboarding'

async function reachHealthCheckStep() {
  const view = render(<Onboarding onComplete={vi.fn()} />)
  await act(async () => {
    fireEvent.click(screen.getByText('getStarted'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('continue'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('continue'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('healthCheckButton'))
  })
  return view
}

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockSystemScan.mockResolvedValue([{ itemCount: 10, totalSize: 0 }])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('cancels the health check scan when unmounted mid-scan', async () => {
    const { unmount } = await reachHealthCheckStep()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    await act(async () => {
      unmount()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    expect(window.dinho?.systemScan).not.toHaveBeenCalled()
  })

  it('completes the health check scan and shows the result', async () => {
    await reachHealthCheckStep()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500)
    })

    expect(window.dinho?.systemScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText('99%')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('continue')).toBeTruthy()
    expect(screen.queryByText('skip')).toBeNull()
  })
})
