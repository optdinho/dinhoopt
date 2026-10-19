// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tMock } = vi.hoisted(() => ({ tMock: vi.fn((key: string) => key) }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tMock }) }))
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: () => null }))
vi.mock('@/components/shared/HealthScore', () => ({ HealthScore: () => null }))

import { getHealthScore, MemoryOptimizerPage } from '@/pages/MemoryOptimizerPage'
import { useMemoryStore } from '@/stores/memory-store'

const INFO = {
  totalBytes: 16_000_000_000,
  availableBytes: 8_000_000_000,
  usedBytes: 8_000_000_000,
  usedPercent: 50,
  cachedBytes: 2_000_000_000,
}
const PROCESSES = [{ pid: 1, name: 'chrome.exe', workingSetBytes: 100 }]

function mockBridge(overrides: Record<string, unknown> = {}) {
  ;(window as unknown as { dinho: unknown }).dinho = {
    memoryInfo: vi.fn().mockResolvedValue({ info: INFO, processes: PROCESSES }),
    memoryOptimize: vi.fn().mockResolvedValue({ success: true, freedBytes: 0, steps: [] }),
    onMemoryProgress: vi.fn(() => vi.fn()),
    ...overrides,
  }
}

// Acções reais capturadas no carregamento do módulo, para resetStore() desfazer
// qualquer stub aplicado por um teste (o estado partilhado persiste entre testes).
const pristineActions = {
  load: useMemoryStore.getState().load,
  optimize: useMemoryStore.getState().optimize,
}

function resetStore() {
  useMemoryStore.setState({
    info: null,
    processes: [],
    loading: false,
    optimizing: false,
    errorKind: null,
    success: null,
    progress: null,
    result: null,
    load: pristineActions.load,
    optimize: pristineActions.optimize,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  mockBridge()
})

describe('getHealthScore', () => {
  it('is 100 minus the used percentage, floored at 10', () => {
    expect(getHealthScore(0)).toBe(100)
    expect(getHealthScore(30)).toBe(70)
    expect(getHealthScore(70)).toBe(30)
    expect(getHealthScore(85)).toBe(15)
    expect(getHealthScore(95)).toBe(10)
    expect(getHealthScore(100)).toBe(10)
  })
})

describe('MemoryOptimizerPage', () => {
  it('shows the localized load error (never the raw English text)', async () => {
    mockBridge({ memoryInfo: vi.fn().mockRejectedValue(new Error('x')) })
    render(<MemoryOptimizerPage />)
    await waitFor(() => expect(useMemoryStore.getState().errorKind).toBe('load'))
    expect(tMock).toHaveBeenCalledWith('loadError')
    expect(screen.queryByText('Failed to load memory info')).toBeNull()
  })

  it('shows the localized optimize error when every step fails', async () => {
    // load() começa por setar errorKind: null, por isso o load automático do mount
    // apagaria o erro antes de o banner ser observável — neutraliza-se a acção.
    resetStore()
    useMemoryStore.setState({ errorKind: 'optimize', load: vi.fn() })
    render(<MemoryOptimizerPage />)
    expect(await screen.findByText('optimizeError')).toBeTruthy()
  })

  it('shows a full success banner with the freed MB and dismisses it', async () => {
    resetStore()
    useMemoryStore.setState({ success: { freedBytes: 2_097_152, partial: false } })
    render(<MemoryOptimizerPage />)
    expect(await screen.findByText('optimizeSuccess')).toBeTruthy()
    expect(tMock).toHaveBeenCalledWith('optimizeSuccess', { mb: '2.0' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    })
    await waitFor(() => expect(useMemoryStore.getState().success).toBeNull())
  })

  it('shows an amber partial-success banner when a step fails', async () => {
    resetStore()
    useMemoryStore.setState({ success: { freedBytes: 2_097_152, partial: true } })
    render(<MemoryOptimizerPage />)
    expect(await screen.findByText('optimizePartial')).toBeTruthy()
    expect(tMock).toHaveBeenCalledWith('optimizePartial', { mb: '2.0' })
  })

  it('renders localized progress labels and details', async () => {
    resetStore()
    useMemoryStore.setState({ progress: { step: 1, totalSteps: 2, label: 'gc' } })
    render(<MemoryOptimizerPage />)
    await waitFor(() => expect(useMemoryStore.getState().info).not.toBeNull())
    expect(tMock).toHaveBeenCalledWith('step_gc', 'gc')
    expect(tMock).toHaveBeenCalledWith('progress_gc')
    expect(screen.queryByText('Collecting .NET garbage...')).toBeNull()
  })

  it('renders the localized step name in the result table', async () => {
    resetStore()
    useMemoryStore.setState({
      result: {
        success: true,
        freedBytes: 1_000_000,
        steps: [{ name: 'workingset', success: true, freedBytes: 1_000_000 }],
      },
    })
    render(<MemoryOptimizerPage />)
    await waitFor(() => expect(useMemoryStore.getState().info).not.toBeNull())
    expect(tMock).toHaveBeenCalledWith('step_workingset', 'workingset')
  })
})
