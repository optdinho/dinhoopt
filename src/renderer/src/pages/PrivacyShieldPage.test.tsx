// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivacyShieldPage } from './PrivacyShieldPage'

const { mockState, addEntryMock, ipcCalls } = vi.hoisted(() => {
  const mockState: Record<string, unknown> = {}
  const addEntryMock = vi.fn()
  const ipcCalls = {
    privacyApply: vi.fn(),
    privacyScan: vi.fn(),
    privacyRevert: vi.fn(),
  }
  return { mockState, addEntryMock, ipcCalls }
})

vi.mock('@/stores/privacy-store', () => ({
  usePrivacyStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => selector(mockState)),
    { getState: () => mockState },
  ),
}))

vi.mock('@/stores/history-store', () => ({
  useHistoryStore: { getState: () => ({ addEntry: addEntryMock }) },
}))

vi.mock('@/hooks/useProgressListener', () => ({
  useProgressListener: () => undefined,
}))

vi.mock('@/lib/renderer-logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ action }: { action?: ReactNode }) => <div>{action}</div>,
}))

vi.mock('@/components/cleaner/ElevationBanner', () => ({
  ElevationBanner: () => null,
}))

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: () => null,
}))

vi.mock('./privacy/PrivacyShieldComponents', () => ({
  categories: [
    {
      id: 'telemetry',
      labelKey: 'privacy.catTelemetry',
      descriptionKey: 'privacy.catTelemetryDesc',
      color: '#f59e0b',
      bg: 'rgba(0,0,0,0.1)',
      border: 'rgba(0,0,0,0.2)',
      icon: () => null,
    },
  ],
  ScoreRing: () => null,
}))

function makeState(enabled = false) {
  return {
    settings: [
      {
        id: 'a',
        category: 'telemetry',
        label: 'A',
        description: 'desc',
        enabled,
        reversible: true,
        requiresAdmin: false,
      },
    ],
    score: enabled ? 100 : 0,
    total: 1,
    protected: enabled ? 1 : 0,
  }
}

const REAL_RESULT = { succeeded: 1, failed: 0, skipped: 0, errors: [] }

function fakeAllFailedResult(count: number) {
  return {
    succeeded: 0,
    failed: count,
    skipped: 0,
    errors: [{ id: '', label: 'privacy.allSettingsLabel', reason: 'privacy.ipcCallFailed' }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  addEntryMock.mockReset()
  addEntryMock.mockResolvedValue(undefined)

  Object.assign(mockState, {
    state: makeState(false),
    status: 'idle',
    applyResult: null,
    expandedCategories: new Set<string>(),
    progress: null,
    setStatus: vi.fn(),
    setState: vi.fn(),
    setApplyResult: vi.fn(),
    setProgress: vi.fn(),
    setExpandedCategories: vi.fn(),
    toggleCategory: vi.fn(),
  })

  window.dinho = {
    onPrivacyProgress: vi.fn(() => () => undefined),
    privacyScan: vi.fn(),
    privacyApply: vi.fn(),
    privacyRevert: vi.fn(),
  } as unknown as typeof window.dinho

  ipcCalls.privacyScan.mockReset()
  ipcCalls.privacyApply.mockReset()
  ipcCalls.privacyRevert.mockReset()
  ;(window.dinho.privacyScan as ReturnType<typeof vi.fn>).mockResolvedValue(makeState(true))
  ;(window.dinho.privacyApply as ReturnType<typeof vi.fn>).mockResolvedValue(REAL_RESULT)
  ;(window.dinho.privacyRevert as ReturnType<typeof vi.fn>).mockResolvedValue(REAL_RESULT)
})

async function clickControlled(control: HTMLElement | Promise<HTMLElement>): Promise<void> {
  await act(async () => {
    fireEvent.click(control as HTMLElement)
  })
}

async function renderAndClickProtectAll(): Promise<void> {
  render(<PrivacyShieldPage embedded />)
  await clickControlled(screen.getByText('privacy.protectAllButton'))
}

describe('PrivacyShieldPage — apply result integrity', () => {
  it('keeps the real result when the follow-up rescan fails', async () => {
    ;(window.dinho.privacyScan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rescan failed'))

    await renderAndClickProtectAll()

    expect(mockState.setApplyResult).toHaveBeenLastCalledWith(REAL_RESULT)
    expect(mockState.setApplyResult).not.toHaveBeenCalledWith(fakeAllFailedResult(1))
    expect(mockState.setStatus).toHaveBeenLastCalledWith('done')
  })

  it('keeps the real result when the history entry fails', async () => {
    addEntryMock.mockRejectedValue(new Error('idb write failed'))

    await renderAndClickProtectAll()

    expect(mockState.setApplyResult).toHaveBeenLastCalledWith(REAL_RESULT)
    expect(mockState.setApplyResult).not.toHaveBeenCalledWith(fakeAllFailedResult(1))
    expect(mockState.setStatus).toHaveBeenLastCalledWith('done')
  })

  it('still reports a real apply failure (ipc call rejects)', async () => {
    ;(window.dinho.privacyApply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))

    await renderAndClickProtectAll()

    expect(mockState.setApplyResult).toHaveBeenLastCalledWith(fakeAllFailedResult(1))
    expect(mockState.setStatus).toHaveBeenLastCalledWith('done')
  })

  it('keeps the real category result when the follow-up rescan fails', async () => {
    ;(window.dinho.privacyScan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rescan failed'))

    render(<PrivacyShieldPage embedded />)
    await clickControlled(screen.getByText('privacy.protectAllCategoryButton'))

    expect(mockState.setApplyResult).toHaveBeenLastCalledWith(REAL_RESULT)
    expect(mockState.setApplyResult).not.toHaveBeenCalledWith(fakeAllFailedResult(1))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a real category apply failure with the category id', async () => {
    ;(window.dinho.privacyApply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))

    render(<PrivacyShieldPage embedded />)
    await clickControlled(screen.getByText('privacy.protectAllCategoryButton'))

    expect(mockState.setApplyResult).toHaveBeenLastCalledWith({
      succeeded: 0,
      failed: 1,
      skipped: 0,
      errors: [{ id: '', label: 'telemetry', reason: 'privacy.ipcCallFailed' }],
    })
    expect(toast.error).toHaveBeenCalledWith('privacy.applyFailed', { description: 'privacy.applyFailedDescription' })
  })

  it('does not report a toggle failure when the apply succeeded but the rescan failed', async () => {
    ;(window.dinho.privacyScan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rescan failed'))
    mockState.expandedCategories = new Set(['telemetry'])

    render(<PrivacyShieldPage embedded />)

    const row = screen.getByText('A').closest('.gap-4') as HTMLElement
    const toggle = row.querySelector('button') as HTMLButtonElement
    await clickControlled(toggle)

    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('privacy.settingEnabled')
    expect(mockState.setStatus).toHaveBeenLastCalledWith('done')
  })
})

describe('PrivacyShieldPage — scan failure feedback', () => {
  it('surfaces a failed scan with a toast instead of failing silently', async () => {
    mockState.state = null
    ;(window.dinho.privacyScan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ipc down'))

    render(<PrivacyShieldPage embedded />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(toast.error).toHaveBeenCalledWith('privacy.scanFailedToast', {
      description: 'privacy.scanFailedDescription',
    })
  })
})

describe('PrivacyShieldPage — toggle accessibility', () => {
  it('exposes the setting toggle as a named switch', async () => {
    mockState.expandedCategories = new Set(['telemetry'])

    render(<PrivacyShieldPage embedded />)

    const toggle = screen.getByRole('switch', { name: 'A' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
