import { beforeEach, describe, expect, it } from 'vitest'
import { useFirewallStore } from './firewall-store'

function makeRule(
  name: string,
  overrides: Partial<{ selected: boolean; issues: import('@shared/types').FirewallIssue[] }> = {},
) {
  return {
    name,
    displayName: name,
    description: '',
    group: '',
    profiles: ['Any'] as import('@shared/types').FirewallProfile[],
    protocol: 'TCP',
    localPort: '*',
    remoteAddress: '*',
    program: '',
    programResolved: '',
    programExists: false,
    signature: 'signed' as const,
    builtin: false,
    enabled: true,
    issues: overrides.issues ?? [],
    risk: 'medium' as const,
    selected: overrides.selected ?? false,
  }
}

describe('firewall-store', () => {
  beforeEach(() => {
    useFirewallStore.setState({
      rules: [],
      scanning: false,
      applying: false,
      scanProgress: null,
      applyResult: null,
      error: null,
      hasScanned: false,
      searchQuery: '',
      riskFilter: 'all',
      programFilter: 'all',
      showBuiltin: false,
    })
  })

  it('starts with default state', () => {
    const s = useFirewallStore.getState()
    expect(s.rules).toEqual([])
    expect(s.scanning).toBe(false)
    expect(s.applying).toBe(false)
    expect(s.hasScanned).toBe(false)
    expect(s.searchQuery).toBe('')
    expect(s.riskFilter).toBe('all')
    expect(s.programFilter).toBe('all')
    expect(s.showBuiltin).toBe(false)
  })

  it('setRules replaces rules', () => {
    const rules = [makeRule('Rule1'), makeRule('Rule2')]
    useFirewallStore.getState().setRules(rules)
    expect(useFirewallStore.getState().rules).toEqual(rules)
  })

  it('setScanning updates scanning', () => {
    useFirewallStore.getState().setScanning(true)
    expect(useFirewallStore.getState().scanning).toBe(true)
  })

  it('setApplying updates applying', () => {
    useFirewallStore.getState().setApplying(true)
    expect(useFirewallStore.getState().applying).toBe(true)
  })

  it('setScanProgress updates progress', () => {
    const p: import('@shared/types').FirewallScanProgress = {
      phase: 'classifying',
      current: 5,
      total: 100,
      currentRule: 'Rule1',
    }
    useFirewallStore.getState().setScanProgress(p)
    expect(useFirewallStore.getState().scanProgress).toEqual(p)
  })

  it('setApplyResult updates result', () => {
    const r: import('@shared/types').FirewallApplyResult = { succeeded: 3, failed: 0, errors: [] }
    useFirewallStore.getState().setApplyResult(r)
    expect(useFirewallStore.getState().applyResult).toEqual(r)
  })

  it('setError updates error', () => {
    useFirewallStore.getState().setError('access denied')
    expect(useFirewallStore.getState().error).toBe('access denied')
  })

  it('setHasScanned updates hasScanned', () => {
    useFirewallStore.getState().setHasScanned(true)
    expect(useFirewallStore.getState().hasScanned).toBe(true)
  })

  it('setSearchQuery updates searchQuery', () => {
    useFirewallStore.getState().setSearchQuery('svchost')
    expect(useFirewallStore.getState().searchQuery).toBe('svchost')
  })

  it('setRiskFilter updates riskFilter', () => {
    useFirewallStore.getState().setRiskFilter('high')
    expect(useFirewallStore.getState().riskFilter).toBe('high')
  })

  it('setProgramFilter updates programFilter', () => {
    useFirewallStore.getState().setProgramFilter('stale')
    expect(useFirewallStore.getState().programFilter).toBe('stale')
  })

  it('setShowBuiltin updates showBuiltin', () => {
    useFirewallStore.getState().setShowBuiltin(true)
    expect(useFirewallStore.getState().showBuiltin).toBe(true)
  })

  it('toggleRule toggles selected on a rule', () => {
    useFirewallStore.getState().setRules([makeRule('Rule1')])
    useFirewallStore.getState().toggleRule('Rule1')
    expect(useFirewallStore.getState().rules[0]!.selected).toBe(true)
    useFirewallStore.getState().toggleRule('Rule1')
    expect(useFirewallStore.getState().rules[0]!.selected).toBe(false)
  })

  it('selectRecommended selects only stale rules', () => {
    useFirewallStore.getState().setRules([makeRule('Stale', { issues: ['stale'] }), makeRule('Normal')])
    useFirewallStore.getState().selectRecommended()
    const rules = useFirewallStore.getState().rules
    expect(rules[0]!.selected).toBe(true)
    expect(rules[1]!.selected).toBe(false)
  })

  it('selectAll selects all rules', () => {
    useFirewallStore.getState().setRules([makeRule('A'), makeRule('B')])
    useFirewallStore.getState().selectAll()
    expect(useFirewallStore.getState().rules.every((r) => r.selected)).toBe(true)
  })

  it('deselectAll deselects all rules', () => {
    useFirewallStore.getState().setRules([
      { ...makeRule('A'), selected: true },
      { ...makeRule('B'), selected: true },
    ])
    useFirewallStore.getState().deselectAll()
    expect(useFirewallStore.getState().rules.every((r) => !r.selected)).toBe(true)
  })

  it('reset restores initial state', () => {
    useFirewallStore.getState().setRules([makeRule('A')])
    useFirewallStore.getState().setScanning(true)
    useFirewallStore.getState().setSearchQuery('test')
    useFirewallStore.getState().reset()
    const s = useFirewallStore.getState()
    expect(s.rules).toEqual([])
    expect(s.scanning).toBe(false)
    expect(s.searchQuery).toBe('')
    expect(s.riskFilter).toBe('all')
  })
})
