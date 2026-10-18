// @vitest-environment jsdom
import type { TrimDriveInfo, TrimProgress, TrimRunResult } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
vi.mock('@/lib/renderer-logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        confirm-mock
      </button>
    ) : null,
}))

import { toast } from 'sonner'
import { useDiskMaintenanceStore } from '@/stores/disk-maintenance-store'
import { DiskMaintenancePage } from './DiskMaintenancePage'

let listResult: TrimDriveInfo[] = []

function drive(over: Partial<TrimDriveInfo> = {}): TrimDriveInfo {
  return {
    id: 'C',
    letter: 'C',
    label: 'System',
    totalSize: 512_110_190_592,
    freeSpace: 214_748_364_800,
    mediaType: 'SSD',
    busType: 'NVMe',
    filesystem: 'NTFS',
    isRemovable: false,
    isEncrypted: false,
    trimSupport: 'supported',
    status: 'recommended',
    statusReason: 'Last TRIM was over 30 days ago.',
    statusReasonCode: 'recommendedStale',
    lastTrimAt: null,
    ...over,
  }
}

function trimResult(over: Partial<TrimRunResult> = {}): TrimRunResult {
  return {
    driveId: 'C',
    success: true,
    durationMs: 1200,
    exitCode: 0,
    summary: 'TRIM completed successfully.',
    summaryCode: 'completed',
    log: '',
    timestamp: Date.now(),
    ...over,
  }
}

function mockBridge(run: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue([])) {
  ;(window as unknown as { dinho: unknown }).dinho = {
    diskTrimList: vi.fn(() => Promise.resolve(listResult)),
    diskTrimRun: run,
    onDiskTrimProgress: vi.fn(() => vi.fn()),
  }
}

function bridge(): {
  diskTrimList: ReturnType<typeof vi.fn>
  diskTrimRun: ReturnType<typeof vi.fn>
  onDiskTrimProgress: ReturnType<typeof vi.fn>
} {
  return window.dinho as never
}

beforeEach(() => {
  vi.clearAllMocks()
  listResult = []
  useDiskMaintenanceStore.setState({
    drives: [],
    loading: false,
    error: null,
    selected: new Set(),
    filter: 'all',
    runStates: {},
    results: {},
    progress: {},
    batchRunning: false,
  })
  mockBridge()
})

async function select(...ids: string[]): Promise<void> {
  // The store update must flush inside `act`, otherwise the run button is still
  // disabled when the click is dispatched (stale render).
  await act(async () => {
    useDiskMaintenanceStore.setState({ selected: new Set(ids) })
  })
}

async function renderAndLoad(drives: TrimDriveInfo[]): Promise<void> {
  listResult = drives
  render(<DiskMaintenancePage />)
  await screen.findByText(drives[0]?.label ?? 'System')
}

async function runSelectedBatch(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText('trimRunSelected'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('confirm-mock'))
  })
}

describe('DiskMaintenancePage i18n (statusReasonCode/summaryCode/timeAgo)', () => {
  it('translates the status reason into the pill tooltip, never English prose', async () => {
    await renderAndLoad([drive()])
    expect(screen.getByTitle('reasonCode.recommendedStale')).not.toBeNull()
    expect(screen.queryByText('Last TRIM was over 30 days ago.')).toBeNull()
  })

  it('falls back to the English reason when the code is absent', async () => {
    await renderAndLoad([drive({ statusReasonCode: undefined as unknown as never })])
    expect(screen.getByTitle('Last TRIM was over 30 days ago.')).not.toBeNull()
    expect(screen.queryByText(/reasonCode\./)).toBeNull()
  })

  it('formats relative time through t() instead of hardcoded English', async () => {
    await renderAndLoad([drive({ lastTrimAt: Date.now() - 2 * 60 * 60 * 1000 })])
    expect(screen.getByText(/timeAgo\.hours/)).not.toBeNull()
    expect(screen.queryByText(/hours ago/)).toBeNull()
  })

  it('shows "never recorded" through the locale key for a null timestamp', async () => {
    await renderAndLoad([drive()])
    expect(screen.getByText(/trimNeverRecorded/)).not.toBeNull()
  })

  it('renders the translated run summary for a coded result', async () => {
    listResult = [drive()]
    useDiskMaintenanceStore.setState({
      results: { C: trimResult() },
      runStates: { C: 'done' },
    })
    render(<DiskMaintenancePage />)
    await screen.findByText('System')
    expect(screen.getByText('trimCode.completed')).not.toBeNull()
    expect(screen.queryByText('TRIM completed successfully.')).toBeNull()
  })

  it('falls back to the English summary when no code is present', async () => {
    listResult = [drive()]
    useDiskMaintenanceStore.setState({
      results: { C: trimResult({ summaryCode: undefined as unknown as never, summary: 'Custom English summary' }) },
      runStates: { C: 'done' },
    })
    render(<DiskMaintenancePage />)
    await screen.findByText('System')
    expect(screen.getByText('Custom English summary')).not.toBeNull()
  })

  it('translates fixed progress messages via messageCode', async () => {
    const progress: TrimProgress = {
      driveId: 'C',
      phase: 'running',
      percent: -1,
      message: 'Starting Optimize-Volume...',
      messageCode: 'starting',
    }
    listResult = [drive()]
    useDiskMaintenanceStore.setState({ progress: { C: progress }, runStates: { C: 'running' } })
    render(<DiskMaintenancePage />)
    await screen.findByText('System')
    expect(screen.getByText('trimProgress.starting')).not.toBeNull()
    expect(screen.queryByText('Starting Optimize-Volume...')).toBeNull()
  })
})

describe('DiskMaintenancePage batch run (A6 + toasts)', () => {
  it('A6: empty backend results toast failure and stop the rows from spinning forever', async () => {
    const run = vi.fn().mockResolvedValue([])
    mockBridge(run)
    await renderAndLoad([drive()])
    await select('C')

    await runSelectedBatch()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('trimNoResultsToast'))
    expect(run).toHaveBeenCalledWith(['C'])
    expect(useDiskMaintenanceStore.getState().runStates.C).toBe('failed')
    expect(useDiskMaintenanceStore.getState().batchRunning).toBe(false)
    expect(useDiskMaintenanceStore.getState().selected.size).toBe(0)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('success path toasts the translated success key and marks the row done', async () => {
    mockBridge(vi.fn().mockResolvedValue([trimResult()]))
    await renderAndLoad([drive()])
    await select('C')

    await runSelectedBatch()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('trimCompletedToast'))
    expect(useDiskMaintenanceStore.getState().runStates.C).toBe('done')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('rejected batch toasts trimBatchFailed and marks every row failed', async () => {
    mockBridge(vi.fn().mockRejectedValue(new Error('boom')))
    await renderAndLoad([drive()])
    await select('C')

    await runSelectedBatch()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('trimBatchFailed'))
    expect(useDiskMaintenanceStore.getState().runStates.C).toBe('failed')
    expect(useDiskMaintenanceStore.getState().batchRunning).toBe(false)
  })
})

describe('DiskMaintenancePage filters and listener', () => {
  it('SSD filter hides non-SSD drives', async () => {
    await renderAndLoad([
      drive(),
      drive({ id: 'D', letter: 'D', label: 'Data', mediaType: 'HDD', status: 'not-applicable' }),
    ])
    expect(screen.getByText('Data')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByText('trimFilterSsd'))
    })

    expect(screen.queryByText('Data')).toBeNull()
    expect(screen.getByText('System')).not.toBeNull()
  })

  it('subscribes to the trim progress listener exactly once', async () => {
    await renderAndLoad([drive()])
    expect(bridge().onDiskTrimProgress).toHaveBeenCalledTimes(1)
  })

  it('routes subscribed progress events into the store', async () => {
    let captured: ((data: TrimProgress) => void) | null = null
    ;(window as unknown as { dinho: unknown }).dinho = {
      diskTrimList: vi.fn(() => Promise.resolve([drive()])),
      diskTrimRun: vi.fn(),
      onDiskTrimProgress: vi.fn((cb: (data: TrimProgress) => void) => {
        captured = cb
        return vi.fn()
      }),
    }
    render(<DiskMaintenancePage />)
    await screen.findByText('System')
    expect(captured).not.toBeNull()
    act(() => {
      captured?.({ driveId: 'C', phase: 'starting', percent: -1, message: 'x', messageCode: 'starting' })
    })
    expect(useDiskMaintenanceStore.getState().progress.C?.messageCode).toBe('starting')
  })
})
