import type { DnsPreset, WindowsTweakDef, WindowsTweakState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWindowsTweaksStore } from './windows-tweaks-store'

function mockKudu() {
  const mock = {
    windowsTweaksStatus: vi.fn(),
    windowsTweaksGetDnsPresets: vi.fn(),
    windowsTweaksApply: vi.fn(),
    windowsTweaksRevert: vi.fn(),
    windowsTweaksSetDns: vi.fn(),
    windowsTweaksNetshTcp: vi.fn(),
    onWindowsTweaksApplyProgress: vi.fn(() => vi.fn()),
    onWindowsTweaksRevertProgress: vi.fn(() => vi.fn()),
  }
  if (typeof window === 'undefined') {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ;(globalThis as any).window = {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  ;(window as any).dinho = mock
  return mock
}

function makeTweakDef(overrides: Partial<WindowsTweakDef> = {}): WindowsTweakDef {
  return {
    id: 'tweak-1',
    name: 'Disable Animations',
    description: 'Disable window animations',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion',
    key: 'DisableAnimations',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    ...overrides,
  }
}

function makeTweakState(overrides: Partial<WindowsTweakState> = {}): WindowsTweakState {
  return {
    applied: false,
    tweak: makeTweakDef(),
    ...overrides,
  }
}

function makeDnsPreset(overrides: Partial<DnsPreset> = {}): DnsPreset {
  return {
    name: 'Google DNS',
    primary: '8.8.8.8',
    secondary: '8.8.4.4',
    ...overrides,
  }
}

describe('windows-tweaks-store', () => {
  beforeEach(() => {
    useWindowsTweaksStore.setState({
      tweaks: [],
      dnsPresets: [],
      selectedIds: new Set(),
      scanning: false,
      applying: false,
      progress: null,
      lastResult: null,
      revertResult: null,
      expandedCategories: new Set(['mouse', 'network', 'system', 'gaming']),
    })
  })

  it('starts with default state', () => {
    const state = useWindowsTweaksStore.getState()
    expect(state.tweaks).toEqual([])
    expect(state.dnsPresets).toEqual([])
    expect(state.selectedIds.size).toBe(0)
    expect(state.scanning).toBe(false)
    expect(state.applying).toBe(false)
    expect(state.progress).toBeNull()
    expect(state.lastResult).toBeNull()
    expect(state.revertResult).toBeNull()
  })

  it('load fetches tweaks status', async () => {
    const kudu = mockKudu()
    const tweaks = [makeTweakState({ applied: false })]
    kudu.windowsTweaksStatus.mockResolvedValue(tweaks)
    await useWindowsTweaksStore.getState().load()
    expect(kudu.windowsTweaksStatus).toHaveBeenCalled()
    expect(useWindowsTweaksStore.getState().tweaks).toEqual(tweaks)
    expect(useWindowsTweaksStore.getState().scanning).toBe(false)
  })

  it('load handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksStatus.mockRejectedValue(new Error('fail'))
    await useWindowsTweaksStore.getState().load()
    expect(useWindowsTweaksStore.getState().scanning).toBe(false)
  })

  it('loadDnsPresets fetches DNS presets', async () => {
    const kudu = mockKudu()
    const presets = [makeDnsPreset({ name: 'Cloudflare' })]
    kudu.windowsTweaksGetDnsPresets.mockResolvedValue(presets)
    await useWindowsTweaksStore.getState().loadDnsPresets()
    expect(useWindowsTweaksStore.getState().dnsPresets).toEqual(presets)
  })

  it('loadDnsPresets handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksGetDnsPresets.mockRejectedValue(new Error('fail'))
    await useWindowsTweaksStore.getState().loadDnsPresets()
  })

  it('apply does nothing when no selections', async () => {
    const kudu = mockKudu()
    await useWindowsTweaksStore.getState().apply()
    expect(kudu.windowsTweaksApply).not.toHaveBeenCalled()
  })

  it('apply calls kudu and reloads', async () => {
    const kudu = mockKudu()
    const result = { succeeded: 1, failed: 0, errors: [], rebootRequired: [], logoffRequired: [] }
    kudu.windowsTweaksApply.mockResolvedValue(result)
    kudu.windowsTweaksStatus.mockResolvedValue([])
    useWindowsTweaksStore.setState({ selectedIds: new Set(['tweak-1']) })
    await useWindowsTweaksStore.getState().apply()
    expect(kudu.onWindowsTweaksApplyProgress).toHaveBeenCalled()
    expect(kudu.windowsTweaksApply).toHaveBeenCalledWith(['tweak-1'])
    expect(useWindowsTweaksStore.getState().lastResult).toEqual(result)
    expect(useWindowsTweaksStore.getState().applying).toBe(false)
    expect(useWindowsTweaksStore.getState().selectedIds.size).toBe(0)
  })

  it('apply handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksApply.mockRejectedValue(new Error('fail'))
    useWindowsTweaksStore.setState({ selectedIds: new Set(['tweak-1']) })
    await useWindowsTweaksStore.getState().apply()
    expect(useWindowsTweaksStore.getState().applying).toBe(false)
  })

  it('revert does nothing when no selections', async () => {
    const kudu = mockKudu()
    await useWindowsTweaksStore.getState().revert()
    expect(kudu.windowsTweaksRevert).not.toHaveBeenCalled()
  })

  it('revert calls kudu and reloads', async () => {
    const kudu = mockKudu()
    const result = { succeeded: 1, failed: 0, errors: [], rebootRequired: [], logoffRequired: [] }
    kudu.windowsTweaksRevert.mockResolvedValue(result)
    kudu.windowsTweaksStatus.mockResolvedValue([])
    useWindowsTweaksStore.setState({ selectedIds: new Set(['tweak-1']) })
    await useWindowsTweaksStore.getState().revert()
    expect(kudu.onWindowsTweaksRevertProgress).toHaveBeenCalled()
    expect(kudu.windowsTweaksRevert).toHaveBeenCalledWith(['tweak-1'])
    expect(useWindowsTweaksStore.getState().revertResult).toEqual(result)
    expect(useWindowsTweaksStore.getState().applying).toBe(false)
  })

  it('revert handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksRevert.mockRejectedValue(new Error('fail'))
    useWindowsTweaksStore.setState({ selectedIds: new Set(['tweak-1']) })
    await useWindowsTweaksStore.getState().revert()
    expect(useWindowsTweaksStore.getState().applying).toBe(false)
  })

  it('toggle adds and removes from selectedIds', () => {
    useWindowsTweaksStore.getState().toggle('a')
    expect(useWindowsTweaksStore.getState().selectedIds.has('a')).toBe(true)
    useWindowsTweaksStore.getState().toggle('a')
    expect(useWindowsTweaksStore.getState().selectedIds.has('a')).toBe(false)
  })

  it('selectAll selects only non-applied tweaks', () => {
    const tweaks = [
      makeTweakState({ applied: true, tweak: makeTweakDef({ id: 'a' }) }),
      makeTweakState({ applied: false, tweak: makeTweakDef({ id: 'b' }) }),
    ]
    useWindowsTweaksStore.setState({ tweaks })
    useWindowsTweaksStore.getState().selectAll()
    const selected = useWindowsTweaksStore.getState().selectedIds
    expect(selected.has('a')).toBe(false)
    expect(selected.has('b')).toBe(true)
  })

  it('deselectAll clears selectedIds', () => {
    useWindowsTweaksStore.setState({ selectedIds: new Set(['a']) })
    useWindowsTweaksStore.getState().deselectAll()
    expect(useWindowsTweaksStore.getState().selectedIds.size).toBe(0)
  })

  it('toggleCategory toggles expanded categories', () => {
    useWindowsTweaksStore.getState().toggleCategory('mouse')
    expect(useWindowsTweaksStore.getState().expandedCategories.has('mouse')).toBe(false)
    useWindowsTweaksStore.getState().toggleCategory('mouse')
    expect(useWindowsTweaksStore.getState().expandedCategories.has('mouse')).toBe(true)
  })

  it('setDns calls kudu and returns result', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksSetDns.mockResolvedValue(true)
    const result = await useWindowsTweaksStore.getState().setDns('8.8.8.8', '8.8.4.4')
    expect(kudu.windowsTweaksSetDns).toHaveBeenCalledWith('8.8.8.8', '8.8.4.4')
    expect(result).toBe(true)
  })

  it('setDns handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksSetDns.mockRejectedValue(new Error('fail'))
    const result = await useWindowsTweaksStore.getState().setDns('1.1.1.1')
    expect(result).toBe(false)
  })

  it('netshTcpApply calls netsh TCP apply', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksNetshTcp.mockResolvedValue({ success: true })
    const result = await useWindowsTweaksStore.getState().netshTcpApply()
    expect(kudu.windowsTweaksNetshTcp).toHaveBeenCalledWith('apply')
    expect(result.success).toBe(true)
  })

  it('netshTcpApply handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksNetshTcp.mockRejectedValue(new Error('fail'))
    const result = await useWindowsTweaksStore.getState().netshTcpApply()
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('netshTcpRevert calls netsh TCP revert', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksNetshTcp.mockResolvedValue({ success: true })
    const result = await useWindowsTweaksStore.getState().netshTcpRevert()
    expect(kudu.windowsTweaksNetshTcp).toHaveBeenCalledWith('revert')
    expect(result.success).toBe(true)
  })

  it('netshTcpRevert handles error', async () => {
    const kudu = mockKudu()
    kudu.windowsTweaksNetshTcp.mockRejectedValue(new Error('fail'))
    const result = await useWindowsTweaksStore.getState().netshTcpRevert()
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
