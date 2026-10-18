import type { RegistryEntry } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliContext } from '../types'
import { handleRegistry } from './registry'

vi.mock('../../ipc/registry-cleaner.ipc', () => ({
  scanRegistry: vi.fn(),
  fixRegistryEntries: vi.fn(),
}))

vi.mock('../../services/settings-store', () => ({
  getSettings: vi.fn(() => ({ registryIgnoredTweaks: [] })),
}))

const { scanRegistry, fixRegistryEntries } = await import('../../ipc/registry-cleaner.ipc')
const { getSettings } = await import('../../services/settings-store')

const ctx: CliContext = { json: false, verbosity: 'quiet' }

function entry(overrides: Partial<RegistryEntry>): RegistryEntry {
  return {
    id: 'id',
    type: 'obsolete',
    keyPath: 'HKLM\\X',
    valueName: 'Y',
    issue: 'issue',
    risk: 'low',
    selected: true,
    ...overrides,
  }
}

describe('handleRegistry fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSettings).mockReturnValue({ registryIgnoredTweaks: [] } as never)
    vi.mocked(fixRegistryEntries).mockResolvedValue({
      fixed: 1,
      failed: 0,
      failures: [],
      fixedByType: {},
      backupFailed: false,
    })
  })

  it('excludes tweaks on the persistent ignore list when --all is used', async () => {
    vi.mocked(scanRegistry).mockResolvedValue([
      entry({
        type: 'performance',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
        valueName: 'Start',
      }),
      entry({ type: 'network', keyPath: 'HKLM\\Kept', valueName: 'Enabled' }),
    ])
    vi.mocked(getSettings).mockReturnValue({
      registryIgnoredTweaks: ['hklm\\system\\currentcontrolset\\services\\sysmain|start'],
    } as never)

    await handleRegistry(['fix', '--all'], ctx)

    const passed = vi.mocked(fixRegistryEntries).mock.calls[0]?.[0] as RegistryEntry[]
    expect(passed).toHaveLength(1)
    expect(passed[0]?.keyPath).toBe('HKLM\\Kept')
  })

  it('skips entries the scanner left unselected when --all is used', async () => {
    vi.mocked(scanRegistry).mockResolvedValue([
      entry({ type: 'performance', keyPath: 'HKLM\\Advisory', selected: false }),
      entry({ type: 'network', keyPath: 'HKLM\\Recommended', selected: true }),
    ])

    await handleRegistry(['fix', '--all'], ctx)

    const passed = vi.mocked(fixRegistryEntries).mock.calls[0]?.[0] as RegistryEntry[]
    expect(passed).toHaveLength(1)
    expect(passed[0]?.keyPath).toBe('HKLM\\Recommended')
  })

  it('fixes only high-risk selected entries by default', async () => {
    vi.mocked(scanRegistry).mockResolvedValue([
      entry({ type: 'obsolete', keyPath: 'HKLM\\High', risk: 'high', selected: true }),
      entry({ type: 'obsolete', keyPath: 'HKLM\\Low', risk: 'low', selected: true }),
    ])

    await handleRegistry(['fix'], ctx)

    const passed = vi.mocked(fixRegistryEntries).mock.calls[0]?.[0] as RegistryEntry[]
    expect(passed).toHaveLength(1)
    expect(passed[0]?.keyPath).toBe('HKLM\\High')
  })
})
