// @vitest-environment jsdom

import type { DnsBenchmarkResult, DnsPreset, GamingTimerStatus } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = ['ExternalLink', 'Globe', 'Info', 'Loader2', 'Timer', 'TriangleAlert', 'Zap', 'ZapOff']
  const iconMap: Record<string, unknown> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

import type { AdvancedToolsProps } from './AdvancedTools'
import { AdvancedTools } from './AdvancedTools'

const PRESETS: DnsPreset[] = [
  { name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' },
  { name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4' },
  { name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112' },
]

const TIMER = {
  hpetOff: false,
  tscSyncPolicy: 'default',
  dynamicTickDisabled: false,
  autoTuningDisabled: false,
} as unknown as GamingTimerStatus

const RESULTS: DnsBenchmarkResult[] = [
  { server: '1.1.1.1', ok: true, avgMs: 32.4, bestMs: 28.1, samples: 3 },
  { server: '8.8.8.8', ok: true, avgMs: 11.2, bestMs: 9.4, samples: 3 },
  { server: '9.9.9.9', ok: true, avgMs: 55.8, bestMs: 49, samples: 3 },
]

const noop = vi.fn()

function renderTools(overrides: Partial<AdvancedToolsProps> = {}) {
  const props: AdvancedToolsProps = {
    applying: false,
    dnsPresets: PRESETS,
    dnsBenchmark: [],
    dnsBenchmarking: false,
    currentDns: { primary: null, secondary: null, source: 'none' },
    gamingTimer: TIMER,
    gamingTimerLoading: false,
    onBenchmarkDns: noop,
    onApplyTcp: noop,
    onRevertTcp: noop,
    onSetDns: noop,
    onSetTimer: noop,
    onRevertTimer: noop,
    onSetAutoTuning: noop,
    onOpenExternal: noop,
    ...overrides,
  }
  render(<AdvancedTools {...props} />)
  return props
}

const asButton = (el: HTMLElement): HTMLButtonElement => el as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdvancedTools layout', () => {
  it('explains what the section is for', () => {
    renderTools()
    expect(screen.getByTestId('advanced-tools')).not.toBeNull()
    expect(screen.getByTestId('advanced-tools-intro').textContent).toContain('rede')
  })

  it('renders the three tool cards', () => {
    renderTools()
    expect(screen.getByTestId('section-tcpip')).not.toBeNull()
    expect(screen.getByTestId('section-timer')).not.toBeNull()
    expect(screen.getByTestId('section-dns')).not.toBeNull()
  })

  it('warns that some tools are documented as debug-only', () => {
    renderTools()
    expect(screen.getByTestId('timer-caution').textContent).toContain('depuração')
  })

  it('hides the dns card when there are no presets', () => {
    renderTools({ dnsPresets: [] })
    expect(screen.queryByTestId('section-dns')).toBeNull()
  })
})

describe('documentation links', () => {
  it('offers a learn-more link per card', () => {
    renderTools()
    expect(screen.getAllByTestId('learn-more')).toHaveLength(3)
  })

  it('only links to microsoft documentation over https', () => {
    renderTools()
    for (const link of screen.getAllByTestId('learn-more')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/learn\.microsoft\.com\//)
    }
  })

  it('opens the link in the system browser instead of inside the app', () => {
    const onOpenExternal = vi.fn()
    renderTools({ onOpenExternal })
    fireEvent.click(screen.getAllByTestId('learn-more')[0]!)
    expect(onOpenExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/learn\.microsoft\.com\//))
  })
})

describe('DNS benchmark', () => {
  it('shows every preset as a choice even before measuring', () => {
    renderTools()
    expect(screen.getByTestId('dns-options')).toBeTruthy()
    expect(screen.getAllByTestId('dns-result-row').map((r) => r.getAttribute('data-preset'))).toEqual([
      'Cloudflare',
      'Google',
      'Quad9',
    ])
    expect(screen.queryByTestId('dns-best-badge')).toBeNull()
  })

  it('explains that measuring only sorts the list', () => {
    renderTools()
    expect(screen.getByTestId('dns-options')).toBeTruthy()
    expect(screen.getByText(/Pode usar qualquer uma das op/i)).toBeTruthy()
  })

  it('lets you pick a preset other than the best one', () => {
    const onSetDns = vi.fn()
    renderTools({ dnsBenchmark: RESULTS, onSetDns })
    const cloudflare = screen
      .getAllByTestId('dns-result-row')
      .find((r) => r.getAttribute('data-preset') === 'Cloudflare')!
    fireEvent.click(cloudflare)
    expect(onSetDns).toHaveBeenCalledWith('1.1.1.1', '1.0.0.1')
  })

  it('shows which DNS is in use and marks that row as current', () => {
    renderTools({ currentDns: { primary: '1.1.1.1', secondary: '1.0.0.1', source: 'manual' } })
    const current = screen.getAllByTestId('dns-result-row').find((r) => r.getAttribute('data-active') === 'true')
    expect(current?.getAttribute('data-preset')).toBe('Cloudflare')
    expect(screen.getAllByTestId('dns-active-badge')).toHaveLength(1)
    expect(screen.getByTestId('dns-current-value').textContent).toContain('1.1.1.1')
  })

  it('marks the in-use row as checked for assistive tech', () => {
    renderTools({ currentDns: { primary: '9.9.9.9', secondary: '149.112.112.112', source: 'manual' } })
    const quad9 = screen.getAllByTestId('dns-result-row').find((r) => r.getAttribute('data-preset') === 'Quad9')!
    expect(quad9.getAttribute('aria-checked')).toBe('true')
  })

  it('says the DNS comes from DHCP when it does', () => {
    renderTools({ currentDns: { primary: '8.8.8.8', secondary: null, source: 'dhcp' } })
    expect(screen.getByTestId('dns-current-value').textContent).toContain('via DHCP')
  })

  it('shows no current DNS when none is detected', () => {
    renderTools()
    expect(screen.getByTestId('dns-current').textContent).toContain('não detetado')
  })

  it('triggers the measurement from the button', () => {
    const onBenchmarkDns = vi.fn()
    renderTools({ onBenchmarkDns })
    fireEvent.click(screen.getByTestId('dns-benchmark-button'))
    expect(onBenchmarkDns).toHaveBeenCalledTimes(1)
  })

  it('disables the button while measuring', () => {
    renderTools({ dnsBenchmarking: true })
    expect(asButton(screen.getByTestId('dns-benchmark-button')).disabled).toBe(true)
  })

  it('lists the presets ordered from fastest to slowest', () => {
    renderTools({ dnsBenchmark: RESULTS })
    const rows = screen.getAllByTestId('dns-result-row')
    expect(rows.map((r) => r.getAttribute('data-preset'))).toEqual(['Google', 'Cloudflare', 'Quad9'])
  })

  it('marks the fastest preset as the best option', () => {
    renderTools({ dnsBenchmark: RESULTS })
    expect(screen.getAllByTestId('dns-best-badge')).toHaveLength(1)
    const best = screen.getAllByTestId('dns-result-row').find((r) => r.getAttribute('data-best') === 'true')
    expect(best?.getAttribute('data-preset')).toBe('Google')
  })

  it('shows the measured average latency in milliseconds', () => {
    renderTools({ dnsBenchmark: RESULTS })
    expect(screen.getByTestId('dns-row-Google').textContent).toBe('11.2 ms')
  })

  it('applies the fastest preset from the shortcut button', () => {
    const onSetDns = vi.fn()
    renderTools({ dnsBenchmark: RESULTS, onSetDns })
    fireEvent.click(screen.getByTestId('dns-apply-best'))
    expect(onSetDns).toHaveBeenCalledWith('8.8.8.8', '8.8.4.4')
  })

  it('applies a specific preset when its own row is clicked', () => {
    const onSetDns = vi.fn()
    renderTools({ dnsBenchmark: RESULTS, onSetDns })
    const row = screen.getAllByTestId('dns-result-row').find((r) => r.getAttribute('data-preset') === 'Quad9')
    fireEvent.click(row!)
    expect(onSetDns).toHaveBeenCalledWith('9.9.9.9', '149.112.112.112')
  })

  it('reports a resolver that did not answer', () => {
    renderTools({
      dnsBenchmark: [
        { server: '1.1.1.1', ok: true, avgMs: 30, bestMs: 28, samples: 3 },
        { server: '8.8.8.8', ok: false, avgMs: null, bestMs: null, samples: 0, error: 'timeout' },
      ],
    })
    expect(screen.getByTestId('dns-row-Google').textContent).toBe('sem resposta')
  })

  it('does not offer the best shortcut when nothing answered', () => {
    renderTools({
      dnsBenchmark: [{ server: '8.8.8.8', ok: false, avgMs: null, bestMs: null, samples: 0, error: 'timeout' }],
    })
    expect(screen.queryByTestId('dns-apply-best')).toBeNull()
  })
})

describe('TCP/IP controls', () => {
  it('applies and reverts', () => {
    const onApplyTcp = vi.fn()
    const onRevertTcp = vi.fn()
    renderTools({ onApplyTcp, onRevertTcp })
    fireEvent.click(screen.getByTestId('tcp-apply'))
    fireEvent.click(screen.getByTestId('tcp-revert'))
    expect(onApplyTcp).toHaveBeenCalledTimes(1)
    expect(onRevertTcp).toHaveBeenCalledTimes(1)
  })

  it('blocks the controls while another tweak batch is running', () => {
    renderTools({ applying: true })
    expect(asButton(screen.getByTestId('tcp-apply')).disabled).toBe(true)
    expect(asButton(screen.getByTestId('tcp-revert')).disabled).toBe(true)
  })
})

describe('timer controls', () => {
  it('shows a placeholder while the status loads', () => {
    renderTools({ gamingTimer: null, gamingTimerLoading: true })
    expect(screen.getByTestId('timer-loading')).not.toBeNull()
    expect(screen.queryByTestId('toggle-hpet')).toBeNull()
  })

  it('toggles hpet, dynamic tick and autotuning', () => {
    const onSetTimer = vi.fn()
    const onSetAutoTuning = vi.fn()
    renderTools({ onSetTimer, onSetAutoTuning })
    fireEvent.click(screen.getByTestId('toggle-hpet'))
    expect(onSetTimer).toHaveBeenCalledWith({ hpetOff: true })
    fireEvent.click(screen.getByTestId('toggle-dynamic-tick'))
    expect(onSetTimer).toHaveBeenCalledWith({ dynamicTickDisabled: true })
    fireEvent.click(screen.getByTestId('toggle-autotuning'))
    expect(onSetAutoTuning).toHaveBeenCalledWith('apply')
  })

  it('exposes the switches with the correct state', () => {
    renderTools({ gamingTimer: { ...TIMER, hpetOff: true } as unknown as GamingTimerStatus })
    expect(screen.getByTestId('toggle-hpet').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('toggle-autotuning').getAttribute('aria-checked')).toBe('false')
  })

  it('selects a tsc sync policy', () => {
    const onSetTimer = vi.fn()
    renderTools({ onSetTimer })
    fireEvent.click(screen.getByTestId('tsc-legacy'))
    expect(onSetTimer).toHaveBeenCalledWith({ tscSyncPolicy: 'legacy' })
  })

  it('reverts every timer setting', () => {
    const onRevertTimer = vi.fn()
    renderTools({ onRevertTimer })
    fireEvent.click(screen.getByTestId('timer-revert'))
    expect(onRevertTimer).toHaveBeenCalledTimes(1)
  })
})
