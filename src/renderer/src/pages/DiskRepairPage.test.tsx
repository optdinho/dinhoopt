// @vitest-environment jsdom
import type { DiskRepairProgress, DiskRepairResult } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ platform: 'win32' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }))
vi.mock('@/lib/renderer-logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))

import { toast } from 'sonner'
import { useDiskStore } from '@/stores/disk-store'
import { DiskRepairPage } from './DiskRepairPage'

const ENGLISH_SUMMARY = 'Windows found and repaired corrupted system files.'

function makeResult(over: Partial<DiskRepairResult> = {}): DiskRepairResult {
  return {
    tool: 'sfc',
    success: true,
    exitCode: 0,
    summary: ENGLISH_SUMMARY,
    summaryCode: 'sfcRepaired',
    log: '',
    requiresReboot: false,
    needsAdmin: false,
    ...over,
  }
}

function mockBridge(sfc: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { dinho: unknown }).dinho = {
    diskRepairSfc: sfc,
    diskRepairDism: vi.fn().mockResolvedValue(makeResult({ tool: 'dism' })),
    diskRepairChkdsk: vi.fn().mockResolvedValue(makeResult({ tool: 'chkdsk' })),
    onDiskRepairProgress: vi.fn(() => vi.fn()),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useDiskStore.setState({
    repairRunning: false,
    repairProgress: null,
    sfcResult: null,
    dismResult: null,
    chkdskResult: null,
  })
  mockBridge(vi.fn().mockResolvedValue(makeResult()))
})

describe('DiskRepairPage i18n (summaryCode/messageCode)', () => {
  it('renders the translated summary for a coded result, never the English prose', () => {
    useDiskStore.setState({ sfcResult: makeResult() })
    render(<DiskRepairPage />)
    expect(screen.getByText('repairCode.sfcRepaired')).not.toBeNull()
    expect(screen.queryByText(ENGLISH_SUMMARY)).toBeNull()
  })

  it('falls back to the English summary when the code is absent (log/legacy shape)', () => {
    useDiskStore.setState({
      dismResult: makeResult({
        tool: 'dism',
        summary: 'Custom English summary',
        summaryCode: undefined as unknown as never,
      }),
    })
    render(<DiskRepairPage />)
    expect(screen.getByText('Custom English summary')).not.toBeNull()
    expect(screen.queryByText(/repairCode\./)).toBeNull()
  })

  it('prefers messageCode over the raw progress message', () => {
    const repairProgress: DiskRepairProgress = {
      tool: 'sfc',
      phase: 'running',
      percent: 42,
      message: 'SFC: 42% complete',
      messageCode: 'percent',
      messageParams: { percent: 42 },
    }
    useDiskStore.setState({ repairRunning: true, repairProgress })
    render(<DiskRepairPage />)
    expect(screen.getByText('repairProgress.percent')).not.toBeNull()
    expect(screen.queryByText('SFC: 42% complete')).toBeNull()
  })

  it('shows the raw message when no messageCode is present (initial t() message)', () => {
    useDiskStore.setState({
      repairRunning: true,
      repairProgress: { tool: 'sfc', phase: 'running', percent: 0, message: 'startingSfc' },
    })
    render(<DiskRepairPage />)
    expect(screen.getByText('startingSfc')).not.toBeNull()
  })
})

describe('DiskRepairPage toasts', () => {
  it('success toast carries the translated summary as description', async () => {
    const sfc = vi.fn().mockResolvedValue(makeResult({ summaryCode: 'sfcNoViolations' }))
    mockBridge(sfc)
    render(<DiskRepairPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('runSfc'))
    })

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('sfcCompletedToast', {
        description: 'repairCode.sfcNoViolations',
      }),
    )
    expect(useDiskStore.getState().repairRunning).toBe(false)
  })

  it('needsAdmin resolves to the admin toast, not a success toast', async () => {
    const sfc = vi
      .fn()
      .mockResolvedValue(makeResult({ success: false, summaryCode: 'adminRequired', needsAdmin: true }))
    mockBridge(sfc)
    render(<DiskRepairPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('runSfc'))
    })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('adminRequiredToast', {
        description: 'adminRequiredSfcDesc',
      }),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('failure toast carries the translated failure summary', async () => {
    const sfc = vi.fn().mockResolvedValue(
      makeResult({
        success: false,
        summary: 'SFC exited with code 1.',
        summaryCode: 'sfcExitCode',
        summaryParams: { code: '1' },
      }),
    )
    mockBridge(sfc)
    render(<DiskRepairPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('runSfc'))
    })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('sfcFinishedWithIssuesToast', {
        description: 'repairCode.sfcExitCode',
      }),
    )
  })

  it('rejected IPC call toasts the failure and resets the running state', async () => {
    const sfc = vi.fn().mockRejectedValue(new Error('boom'))
    mockBridge(sfc)
    render(<DiskRepairPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('runSfc'))
    })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('sfcFailedToast'))
    expect(useDiskStore.getState().repairRunning).toBe(false)
    expect(useDiskStore.getState().repairProgress).toBeNull()
  })
})

describe('DiskRepairPage progress listener', () => {
  it('subscribes exactly once on mount with the stable store action', () => {
    render(<DiskRepairPage />)
    const bridge = window.dinho as unknown as { onDiskRepairProgress: ReturnType<typeof vi.fn> }
    expect(bridge.onDiskRepairProgress).toHaveBeenCalledTimes(1)
  })

  it('routes subscribed events into the store', () => {
    let captured: ((data: DiskRepairProgress) => void) | null = null
    const subscribe = vi.fn((cb: (data: DiskRepairProgress) => void) => {
      captured = cb
      return vi.fn()
    })
    ;(window as unknown as { dinho: unknown }).dinho = {
      diskRepairSfc: vi.fn(),
      diskRepairDism: vi.fn(),
      diskRepairChkdsk: vi.fn(),
      onDiskRepairProgress: subscribe,
    }
    render(<DiskRepairPage />)
    expect(captured).not.toBeNull()
    act(() => {
      captured?.({ tool: 'dism', phase: 'running', percent: 10, message: 'x' })
    })
    expect(useDiskStore.getState().repairProgress).toEqual({
      tool: 'dism',
      phase: 'running',
      percent: 10,
      message: 'x',
    })
  })
})
