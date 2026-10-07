// @vitest-environment jsdom

import type { ComplianceState } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { CompliancePage } from './CompliancePage'

const { mockState } = vi.hoisted(() => {
  const mockState = {
    state: null as ComplianceState | null,
    status: 'idle',
    applyResult: null,
    expandedCategories: new Set<string>(),
    progress: null,
    setState: vi.fn(),
    setStatus: vi.fn(),
    setApplyResult: vi.fn(),
    setExpandedCategories: vi.fn(),
    toggleCategory: vi.fn(),
    setProgress: vi.fn(),
  }
  return { mockState }
})

vi.mock('@/stores/compliance-store', () => ({
  useComplianceStore: Object.assign(
    vi.fn((selector: (s: typeof mockState) => unknown) => selector(mockState)),
    { getState: () => mockState },
  ),
}))

vi.mock('@/stores/history-store', () => ({
  useHistoryStore: vi.fn((selector: (s: { addEntry: unknown }) => unknown) => selector({ addEntry: vi.fn() })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('lucide-react', () => {
  const Icon = () => null
  return {
    CircleCheckBig: Icon,
    Eye: Icon,
    Globe: Icon,
    HardDrive: Icon,
    Loader2: Icon,
    Lock: Icon,
    RefreshCw: Icon,
    ShieldAlert: Icon,
    ShieldCheck: Icon,
    TriangleAlert: Icon,
  }
})

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: () => null,
}))

vi.mock('@/components/shared/EmptyState', () => ({
  EmptyState: () => null,
}))

vi.mock('@/components/cleaner/ElevationBanner', () => ({
  ElevationBanner: () => null,
}))

const makeState = (): ComplianceState => ({
  checks: [
    {
      id: 'c1',
      category: 'uac',
      severity: 'critical',
      label: 'UAC enabled',
      description: 'desc',
      compliant: true,
      reversible: true,
      applicable: true,
      requiresAdmin: false,
      expected: 'Enabled',
    },
  ],
  score: 100,
  total: 1,
  compliant: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockState.state = makeState()
  mockState.status = 'done'
  mockState.expandedCategories = new Set(['uac'])
  mockState.progress = null
  window.dinho = {
    onComplianceProgress: vi.fn(() => () => undefined),
    complianceScan: vi.fn().mockResolvedValue(makeState()),
    complianceRevert: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0, errors: [] }),
  } as never
})

const clickRevert = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'revertSelected' }))
  })
}

describe('CompliancePage runRevert feedback', () => {
  it('toasts error when a revert fails (result.failed > 0)', async () => {
    ;(window.dinho.complianceRevert as ReturnType<typeof vi.fn>).mockResolvedValue({
      succeeded: 0,
      failed: 1,
      errors: [{ id: 'c1', label: 'UAC enabled', reason: 'boom' }],
    })
    render(<CompliancePage />)
    await clickRevert()
    expect(toast.error).toHaveBeenCalledWith('applyFailed')
  })

  it('toasts both success and error on a partial revert', async () => {
    ;(window.dinho.complianceRevert as ReturnType<typeof vi.fn>).mockResolvedValue({
      succeeded: 1,
      failed: 1,
      errors: [{ id: 'c1', label: 'UAC enabled', reason: 'boom' }],
    })
    render(<CompliancePage />)
    await clickRevert()
    expect(toast.success).toHaveBeenCalledWith('checksReverted')
    expect(toast.error).toHaveBeenCalledWith('applyFailed')
  })

  it('toasts only success when every revert succeeds', async () => {
    render(<CompliancePage />)
    await clickRevert()
    expect(toast.success).toHaveBeenCalledWith('checksReverted')
    expect(toast.error).not.toHaveBeenCalled()
    expect(mockState.setApplyResult).toHaveBeenCalledWith({ succeeded: 1, failed: 0, errors: [] })
  })

  it('toasts error when the revert IPC rejects', async () => {
    ;(window.dinho.complianceRevert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('pipe down'))
    render(<CompliancePage />)
    await clickRevert()
    expect(toast.error).toHaveBeenCalledWith('applyFailed')
    expect(mockState.setStatus).toHaveBeenCalledWith('done')
  })
})
