// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/lib/renderer-logger', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: (sel: (s: unknown) => unknown) => sel({ addEntry: vi.fn() }),
}))
vi.mock('@/stores/stats-store', () => ({
  useStatsStore: (sel: (s: unknown) => unknown) => sel({ recompute: vi.fn() }),
}))
vi.mock('@/components/shared/ConfirmDialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/components/shared/Checkbox', () => ({ Checkbox: () => null }))

import type { NetworkItem } from '@shared/types'
import { NetworkCleanupModal } from './NetworkCleanupModal'

function mockScan(impl: () => Promise<NetworkItem[]>) {
  const networkScan = vi.fn().mockImplementation(impl)
  ;(window as unknown as { dinho: unknown }).dinho = { networkScan }
  return networkScan
}

describe('NetworkCleanupModal scan failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not retry the scan in a loop on failure and shows a retry action', async () => {
    let calls = 0
    const networkScan = mockScan(() => {
      calls++
      // First attempt fails; a second attempt would hang so a buggy loop is
      // bounded to two calls instead of freezing the runner.
      if (calls <= 1) return Promise.reject(new Error('network scan failed'))
      return new Promise<NetworkItem[]>(() => {})
    })

    render(<NetworkCleanupModal open onClose={vi.fn()} />)

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(networkScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText('scanFailedToast')).not.toBeNull()
  })

  it('resets and scans again when reopened after a failure', async () => {
    let calls = 0
    const item: NetworkItem = { id: 'dns1', type: 'dns-cache', label: 'DNS entry', detail: 'x', selected: true }
    const networkScan = mockScan(() => {
      calls++
      if (calls === 1) return Promise.reject(new Error('network scan failed'))
      return Promise.resolve([item])
    })

    const { rerender } = render(<NetworkCleanupModal open onClose={vi.fn()} />)
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(networkScan).toHaveBeenCalledTimes(1)

    // Close → state resets; reopen → a fresh scan runs and succeeds.
    rerender(<NetworkCleanupModal open={false} onClose={vi.fn()} />)
    await act(async () => {})
    rerender(<NetworkCleanupModal open onClose={vi.fn()} />)
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(networkScan).toHaveBeenCalledTimes(2)
    expect(screen.getByText('DNS entry')).not.toBeNull()
  })
})
