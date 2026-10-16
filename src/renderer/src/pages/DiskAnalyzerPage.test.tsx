// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ platform: 'win32' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/renderer-logger', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/ErrorAlert', () => ({ ErrorAlert: () => null }))
vi.mock('@/components/shared/ScanProgress', () => ({ ScanProgress: () => null }))

import { useDiskStore } from '@/stores/disk-store'
import { DiskAnalyzerPage } from './DiskAnalyzerPage'

function mockBridge(diskFileTypes: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { dinho: unknown }).dinho = {
    diskDrives: vi.fn().mockResolvedValue([]),
    diskFileTypes,
    diskAnalyze: vi.fn(),
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
