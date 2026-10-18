// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ platform: 'win32' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/renderer-logger', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ action }: { action: React.ReactNode }) => <div data-testid="page-header">{action}</div>,
}))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/ErrorAlert', () => ({ ErrorAlert: () => null }))
vi.mock('@/components/shared/ScanProgress', () => ({
  ScanProgress: ({ progress, currentPath }: { progress: number; currentPath: string }) => (
    <div data-testid="scan-progress">
      {progress}:{currentPath}
    </div>
  ),
}))

import { toast } from 'sonner'
import { useDiskStore } from '@/stores/disk-store'
import { DiskAnalyzerPage } from './DiskAnalyzerPage'

function mockBridge(diskFileTypes: ReturnType<typeof vi.fn>, diskAnalyze?: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { dinho: unknown }).dinho = {
    diskDrives: vi.fn().mockResolvedValue([]),
    diskFileTypes,
    diskAnalyze: diskAnalyze ?? vi.fn(),
  }
}

/**
 * Returns an empty result for the first `maxResolve` calls, then a promise that
 * never settles. Without the loop guard this bounds the effect cycle to
 * `maxResolve + 1` calls instead of hanging the test runner forever.
 */
function makeDiskFileTypes(maxResolve: number) {
  let calls = 0
  return vi.fn().mockImplementation(() => {
    calls++
    if (calls <= maxResolve) return Promise.resolve([])
    return new Promise<never>(() => {})
  })
}

describe('DiskAnalyzerPage file-type auto-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDiskStore.setState({
      // Pre-seeded so the drives effect never fires (an empty list would keep
      // re-triggering itself with an asynchronous store update).
      drives: [{ letter: 'C', label: 'System', totalSize: 100, freeSpace: 50, usedSpace: 50 }],
      selectedDrive: 'C',
      data: { name: 'C:', path: 'C:', size: 1000, children: [] },
      analyzing: false,
      breadcrumb: [],
      error: null,
      fileTypes: [],
      fileTypesLoading: false,
    })
  })

  it('scans file types only once even when the result is empty (no infinite loop)', async () => {
    const diskFileTypes = makeDiskFileTypes(1)
    mockBridge(diskFileTypes)
    render(<DiskAnalyzerPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('viewFileTypes'))
    })
    // Give React time to flush any (buggy) follow-up effect cycles.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(diskFileTypes).toHaveBeenCalledTimes(1)
  })

  it('re-scans after a new analysis creates a fresh data object', async () => {
    const diskFileTypes = makeDiskFileTypes(2)
    mockBridge(diskFileTypes)
    render(<DiskAnalyzerPage />)

    await act(async () => {
      fireEvent.click(screen.getByText('viewFileTypes'))
    })
    expect(diskFileTypes).toHaveBeenCalledTimes(1)

    // A new analysis replaces the root node → the file-type scan should rerun once.
    await act(async () => {
      useDiskStore.setState({ data: { name: 'C:', path: 'C:', size: 2000, children: [] } })
    })
    expect(diskFileTypes).toHaveBeenCalledTimes(2)
  })
})

interface ProgressPayload {
  category?: string
  phase?: string
  currentPath?: string
  progress?: number
  itemsFound?: number
  sizeFound?: number
}

describe('DiskAnalyzerPage live progress + empty-result guard (A4/A5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDiskStore.setState({
      drives: [{ letter: 'C', label: 'System', totalSize: 100, freeSpace: 50, usedSpace: 50 }],
      selectedDrive: 'C',
      data: { name: 'C:', path: 'C:', size: 1000, children: [] },
      analyzing: false,
      breadcrumb: [],
      error: null,
      fileTypes: [],
      fileTypesLoading: false,
    })
  })

  function subscribeProgress() {
    const emitter: { cb?: (data: ProgressPayload) => void } = {}
    const unsubscribe = vi.fn()
    mockBridge(makeDiskFileTypes(1))
    ;(window.dinho as unknown as { onScanProgress: unknown }).onScanProgress = vi.fn(
      (cb: (data: ProgressPayload) => void) => {
        emitter.cb = cb
        return unsubscribe
      },
    )
    return { emitter, unsubscribe }
  }

  it('A4: shows real per-entry progress for disk categories and ignores foreign ones', async () => {
    const { emitter } = subscribeProgress()
    const diskAnalyze = vi.fn(() => new Promise<never>(() => {}))
    ;(window.dinho as unknown as { diskAnalyze: unknown }).diskAnalyze = diskAnalyze

    render(<DiskAnalyzerPage />)
    expect(
      (window.dinho as unknown as { onScanProgress: ReturnType<typeof vi.fn> }).onScanProgress,
    ).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.click(screen.getByText('analyzeButton'))
    })
    // analyzing=true → fallback progress before any event arrives
    expect(screen.getByTestId('scan-progress').textContent).toContain('0:')

    await act(async () => {
      emitter.cb?.({
        category: 'disk',
        phase: 'scanning',
        currentPath: 'C:\\Windows',
        progress: 42,
        itemsFound: 7,
        sizeFound: 1234,
      })
    })
    expect(screen.getByTestId('scan-progress').textContent).toBe('42:C:\\Windows')

    // The SCAN_PROGRESS channel is shared with the cleaner pages — foreign
    // categories must not clobber this page's progress.
    await act(async () => {
      emitter.cb?.({
        category: 'cleaner',
        phase: 'scanning',
        currentPath: 'X',
        progress: 99,
        itemsFound: 0,
        sizeFound: 0,
      })
    })
    expect(screen.getByTestId('scan-progress').textContent).toBe('42:C:\\Windows')
  })

  it('A4: unsubscribes from the progress channel on unmount', () => {
    const { unsubscribe } = subscribeProgress()
    const { unmount } = render(<DiskAnalyzerPage />)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('A5: an empty result is an error, never a successful "empty disk"', async () => {
    const diskAnalyze = vi.fn().mockResolvedValue({ name: '', path: '', size: 0, children: [] })
    mockBridge(makeDiskFileTypes(1), diskAnalyze)

    render(<DiskAnalyzerPage />)
    await act(async () => {
      fireEvent.click(screen.getByText('analyzeButton'))
    })

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe('failedToAnalyzeToastWindows')
    const state = useDiskStore.getState()
    expect(state.analyzing).toBe(false)
    expect(state.data).toBeNull()
    expect(state.error).toBe('failedToAnalyzeErrorWindows')
  })
})
