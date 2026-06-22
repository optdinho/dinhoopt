import { beforeEach, describe, expect, it } from 'vitest'
import { useContextMenuStore } from './context-menu-store'

function makeEntry(
  id: string,
  overrides: Partial<{ selected: boolean; protected: boolean; status: import('@shared/types').ContextMenuStatus }> = {},
) {
  return {
    id,
    kind: 'verb' as const,
    keyPath: `HKCR\\${id}`,
    name: `Menu ${id}`,
    displayName: `Menu ${id}`,
    scope: 'AllFiles' as const,
    hive: 'HKCR' as const,
    clsid: null,
    dllPath: null,
    command: null,
    source: 'Windows' as const,
    status: overrides.status ?? 'enabled',
    protected: overrides.protected ?? false,
    requiresAdmin: false,
    selected: overrides.selected ?? false,
  }
}

describe('context-menu-store', () => {
  beforeEach(() => {
    useContextMenuStore.setState({
      entries: [],
      scanning: false,
      scanned: false,
      applying: false,
      applyProgress: null,
      applyResult: null,
      showErrors: false,
      error: null,
      filters: { search: '', scope: 'all', source: 'all', status: 'all' },
      expandedGroups: new Set(),
    })
  })

  it('starts with default state', () => {
    const s = useContextMenuStore.getState()
    expect(s.entries).toEqual([])
    expect(s.scanning).toBe(false)
    expect(s.scanned).toBe(false)
    expect(s.applying).toBe(false)
    expect(s.applyProgress).toBeNull()
    expect(s.applyResult).toBeNull()
    expect(s.showErrors).toBe(false)
    expect(s.error).toBeNull()
    expect(s.filters).toEqual({ search: '', scope: 'all', source: 'all', status: 'all' })
    expect(s.expandedGroups.size).toBe(0)
  })

  it('setEntries updates entries', () => {
    const entries = [makeEntry('1'), makeEntry('2')]
    useContextMenuStore.getState().setEntries(entries)
    expect(useContextMenuStore.getState().entries).toEqual(entries)
  })

  it('setScanning updates scanning', () => {
    useContextMenuStore.getState().setScanning(true)
    expect(useContextMenuStore.getState().scanning).toBe(true)
  })

  it('setScanned updates scanned', () => {
    useContextMenuStore.getState().setScanned(true)
    expect(useContextMenuStore.getState().scanned).toBe(true)
  })

  it('setApplying updates applying', () => {
    useContextMenuStore.getState().setApplying(true)
    expect(useContextMenuStore.getState().applying).toBe(true)
  })

  it('setApplyProgress updates applyProgress', () => {
    const p = { current: 1, total: 5, currentLabel: 'test' }
    useContextMenuStore.getState().setApplyProgress(p)
    expect(useContextMenuStore.getState().applyProgress).toEqual(p)
  })

  it('setApplyResult updates applyResult', () => {
    const r = { succeeded: 3, failed: 1, errors: [], updates: [{ entryId: '1', status: 'disabled' as const }] }
    useContextMenuStore.getState().setApplyResult(r)
    expect(useContextMenuStore.getState().applyResult).toEqual(r)
  })

  it('setShowErrors toggles showErrors', () => {
    useContextMenuStore.getState().setShowErrors(true)
    expect(useContextMenuStore.getState().showErrors).toBe(true)
  })

  it('setError updates error', () => {
    useContextMenuStore.getState().setError('error msg')
    expect(useContextMenuStore.getState().error).toBe('error msg')
  })

  it('setFilter updates a single filter key', () => {
    useContextMenuStore.getState().setFilter('scope', 'AllFiles')
    expect(useContextMenuStore.getState().filters.scope).toBe('AllFiles')
    expect(useContextMenuStore.getState().filters.search).toBe('')
  })

  it('toggleGroup adds and removes group keys', () => {
    useContextMenuStore.getState().toggleGroup('group1')
    expect(useContextMenuStore.getState().expandedGroups.has('group1')).toBe(true)
    useContextMenuStore.getState().toggleGroup('group1')
    expect(useContextMenuStore.getState().expandedGroups.has('group1')).toBe(false)
  })

  it('toggleEntry toggles selected on an entry', () => {
    useContextMenuStore.getState().setEntries([makeEntry('1')])
    useContextMenuStore.getState().toggleEntry('1')
    expect(useContextMenuStore.getState().entries[0]!.selected).toBe(true)
    useContextMenuStore.getState().toggleEntry('1')
    expect(useContextMenuStore.getState().entries[0]!.selected).toBe(false)
  })

  it('toggleEntry preserves non-matching entries', () => {
    useContextMenuStore.getState().setEntries([makeEntry('1'), makeEntry('2')])
    useContextMenuStore.getState().toggleEntry('1')
    expect(useContextMenuStore.getState().entries.find((e) => e.id === '2')!.selected).toBe(false)
  })

  it('toggleAllVisible selects visible unprotected entries', () => {
    useContextMenuStore.getState().setEntries([makeEntry('1'), { ...makeEntry('2'), protected: true }])
    useContextMenuStore.getState().toggleAllVisible(['1', '2'], true)
    const entries = useContextMenuStore.getState().entries
    expect(entries.find((e) => e.id === '1')!.selected).toBe(true)
    expect(entries.find((e) => e.id === '2')!.selected).toBe(false)
  })

  it('toggleAllVisible deselects visible unprotected entries', () => {
    useContextMenuStore.getState().setEntries([
      { ...makeEntry('1'), selected: true },
      { ...makeEntry('2'), protected: true, selected: true },
    ])
    useContextMenuStore.getState().toggleAllVisible(['1', '2'], false)
    const entries = useContextMenuStore.getState().entries
    expect(entries.find((e) => e.id === '1')!.selected).toBe(false)
    expect(entries.find((e) => e.id === '2')!.selected).toBe(true)
  })

  it('toggleAllVisible ignores entries not in visibleIds', () => {
    useContextMenuStore.getState().setEntries([
      { ...makeEntry('1'), selected: false },
      { ...makeEntry('hidden'), selected: false },
    ])
    useContextMenuStore.getState().toggleAllVisible(['1'], true)
    const entries = useContextMenuStore.getState().entries
    expect(entries.find((e) => e.id === '1')!.selected).toBe(true)
    expect(entries.find((e) => e.id === 'hidden')!.selected).toBe(false)
  })

  it('applyUpdates updates entry status and clears selected', () => {
    useContextMenuStore.getState().setEntries([
      { ...makeEntry('1'), selected: true },
      { ...makeEntry('2'), selected: true },
    ])
    useContextMenuStore.getState().applyUpdates([
      { entryId: '1', status: 'disabled' },
      { entryId: '2', status: 'enabled' },
    ])
    const entries = useContextMenuStore.getState().entries
    expect(entries.find((e) => e.id === '1')!.status).toBe('disabled')
    expect(entries.find((e) => e.id === '1')!.selected).toBe(false)
    expect(entries.find((e) => e.id === '2')!.status).toBe('enabled')
  })

  it('applyUpdates preserves entries not in updates', () => {
    useContextMenuStore.getState().setEntries([
      { ...makeEntry('1'), selected: true },
      { ...makeEntry('2'), selected: true },
    ])
    useContextMenuStore.getState().applyUpdates([{ entryId: '1', status: 'disabled' }])
    const entries = useContextMenuStore.getState().entries
    expect(entries.find((e) => e.id === '1')!.status).toBe('disabled')
    expect(entries.find((e) => e.id === '2')!.selected).toBe(true)
    expect(entries.find((e) => e.id === '2')!.status).toBe('enabled')
  })

  it('removeEntries removes entries by ids', () => {
    useContextMenuStore.getState().setEntries([makeEntry('1'), makeEntry('2')])
    useContextMenuStore.getState().removeEntries(['1'])
    expect(useContextMenuStore.getState().entries).toHaveLength(1)
    expect(useContextMenuStore.getState().entries[0]!.id).toBe('2')
  })

  it('reset restores initial state', () => {
    useContextMenuStore.getState().setEntries([makeEntry('1')])
    useContextMenuStore.getState().setScanning(true)
    useContextMenuStore.getState().setApplying(true)
    useContextMenuStore.getState().toggleGroup('g1')
    useContextMenuStore.getState().reset()
    const s = useContextMenuStore.getState()
    expect(s.entries).toEqual([])
    expect(s.scanning).toBe(false)
    expect(s.applying).toBe(false)
    expect(s.filters).toEqual({ search: '', scope: 'all', source: 'all', status: 'all' })
    expect(s.expandedGroups.size).toBe(0)
  })
})
