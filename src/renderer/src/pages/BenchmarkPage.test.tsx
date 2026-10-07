// @vitest-environment jsdom

import type { BenchmarkResult } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { BenchmarkPage } from './BenchmarkPage'

const { mockStore } = vi.hoisted(() => {
  const mockStore = {
    status: 'idle',
    progress: null,
    result: null as BenchmarkResult | null,
    run: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }
  return { mockStore }
})

vi.mock('@/stores/benchmark-store', () => ({
  useBenchmarkStore: vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => (props: Record<string, unknown>) => createElement(String(tag), props),
    },
  ),
}))

vi.mock('lucide-react', () => {
  const Icon = () => null
  return {
    CircleCheckBig: Icon,
    Cpu: Icon,
    Gauge: Icon,
    MemoryStick: Icon,
    RefreshCw: Icon,
    Star: Icon,
    Thermometer: Icon,
    Timer: Icon,
    TriangleAlert: Icon,
    Wifi: Icon,
    Zap: Icon,
  }
})

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: () => null,
}))

const makeResult = (overrides: Partial<BenchmarkResult> = {}): BenchmarkResult => ({
  score: 80,
  scoreClass: 'A',
  details: {
    cpu: { score: 17, detail: 'Uso médio: 7.0%' },
    ram: { score: 16, detail: 'Livre: 8192MB / 16384MB (50%)' },
    network: { score: 13, detail: 'Ping médio: 20ms, Jitter: 5ms', jitter: 5 },
    latencyDpc: { score: 20, detail: 'Latência DPC: 300µs' },
    temperature: { score: 17, detail: '55°C' },
    tweakBonus: { score: 5, applied: 25, total: 51 },
    powerBonus: { score: 3, plan: 'High Performance' },
  },
  completedAt: new Date().toISOString(),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.status = 'done'
  mockStore.result = makeResult()
})

describe('BenchmarkPage failure feedback', () => {
  it('renders the incomplete warning when the benchmark had failed measurements', () => {
    mockStore.result = makeResult({ failure: 'incomplete', failedMetrics: ['cpu', 'powerPlan'] })
    render(<BenchmarkPage />)
    expect(screen.getByText('incompleteWarning')).not.toBeNull()
  })

  it('renders the cancelled warning when the benchmark was cancelled', () => {
    mockStore.result = makeResult({ failure: 'cancelled', failedMetrics: ['cpu'] })
    render(<BenchmarkPage />)
    expect(screen.getByText('cancelledWarning')).not.toBeNull()
  })

  it('renders no warning when the benchmark completed cleanly', () => {
    render(<BenchmarkPage />)
    expect(screen.queryByText('incompleteWarning')).toBeNull()
    expect(screen.queryByText('cancelledWarning')).toBeNull()
  })
})
