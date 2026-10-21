// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ action }: { action?: unknown }) => <div>{action as never}</div>,
}))
vi.mock('@/components/perf/AlertBanner', () => ({ AlertBanner: () => null }))
vi.mock('@/components/perf/DiskHealthPanel', () => ({ DiskHealthPanel: () => null }))
vi.mock('@/components/perf/GaugeCard', () => ({ GaugeCard: () => null }))
vi.mock('@/components/perf/ProcessTable', () => ({ ProcessTable: () => null }))
vi.mock('@/components/perf/SystemInfoHeader', () => ({ SystemInfoHeader: () => null }))
vi.mock('@/components/perf/TimeSeriesChart', () => ({ TimeSeriesChart: () => null }))

import { PerformanceMonitorPage } from './PerformanceMonitorPage'

type Ctx = { perfStopProcessPolling: ReturnType<typeof vi.fn>; perfStartProcessPolling: ReturnType<typeof vi.fn> }

function mockBridge() {
  const ctx: Ctx = {
    perfStartProcessPolling: vi.fn(),
    perfStopProcessPolling: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as unknown as { dinho: unknown }).dinho = {
    onPerfSnapshot: vi.fn(() => vi.fn()),
    onPerfProcessList: vi.fn(() => vi.fn()),
    perfStartMonitoring: vi.fn().mockResolvedValue(undefined),
    perfStopMonitoring: vi.fn().mockResolvedValue(undefined),
    perfGetSystemInfo: vi.fn().mockResolvedValue({}),
    perfGetDiskHealth: vi.fn().mockResolvedValue([]),
    ...ctx,
  }
  return ctx
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PerformanceMonitorPage process polling lifecycle', () => {
  it('stops process polling on unmount, not just monitoring', async () => {
    const ctx = mockBridge()
    const view = render(<PerformanceMonitorPage />)
    await waitFor(() => expect(ctx.perfStartProcessPolling).toHaveBeenCalled())
    view.unmount()
    expect(ctx.perfStopProcessPolling).toHaveBeenCalledTimes(1)
  })

  it('stops process polling when the user pauses', async () => {
    const ctx = mockBridge()
    const { getByText } = render(<PerformanceMonitorPage />)
    await waitFor(() => expect(ctx.perfStartProcessPolling).toHaveBeenCalled())
    fireEvent.click(getByText('pause'))
    await waitFor(() => expect(ctx.perfStopProcessPolling).toHaveBeenCalledTimes(1))
  })
})
