import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { severityOrder, useUpdaterStore } from './updater-store'

function makeApp(id: string, overrides: Partial<{ name: string; selected: boolean; severity: string }> = {}) {
  return {
    id,
    name: overrides.name ?? `App ${id}`,
    currentVersion: '1.0',
    availableVersion: '2.0',
    source: 'winget',
    severity: overrides.severity ?? 'minor',
    selected: overrides.selected ?? false,
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    dinho: {
      settingsSet: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useUpdaterStore.setState({
    apps: [],
    ignoredApps: [],
    ignoredIds: new Set(),
    loading: false,
    updating: false,
    progress: null,
    updateResult: null,
    error: null,
    hasChecked: false,
    packageManagerAvailable: true,
    packageManagerName: null,
    searchQuery: '',
    sortField: 'name',
    sortDirection: 'asc',
    severityFilter: 'all',
  })
})

describe('updater-store', () => {
  it('starts with default state', () => {
    const s = useUpdaterStore.getState()
    expect(s.apps).toEqual([])
    expect(s.ignoredApps).toEqual([])
    expect(s.ignoredIds.size).toBe(0)
    expect(s.loading).toBe(false)
    expect(s.hasChecked).toBe(false)
    expect(s.sortField).toBe('name')
    expect(s.severityFilter).toBe('all')
  })

  it('setApps filters out ignored ids', () => {
    useUpdaterStore.setState({ ignoredIds: new Set(['1']) })
    useUpdaterStore.getState().setApps([makeApp('1'), makeApp('2')])
    expect(useUpdaterStore.getState().apps).toHaveLength(1)
    expect(useUpdaterStore.getState().apps[0]!.id).toBe('2')
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(1)
    expect(useUpdaterStore.getState().ignoredApps[0]!.id).toBe('1')
  })

  it('setApps with no ignored ids includes all', () => {
    useUpdaterStore.getState().setApps([makeApp('1'), makeApp('2')])
    expect(useUpdaterStore.getState().apps).toHaveLength(2)
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(0)
  })

  it('setLoading updates loading', () => {
    useUpdaterStore.getState().setLoading(true)
    expect(useUpdaterStore.getState().loading).toBe(true)
  })

  it('setUpdating updates updating', () => {
    useUpdaterStore.getState().setUpdating(true)
    expect(useUpdaterStore.getState().updating).toBe(true)
  })

  it('setProgress updates progress', () => {
    const p = { current: 1, total: 3, currentApp: 'App1' }
    useUpdaterStore.getState().setProgress(p)
    expect(useUpdaterStore.getState().progress).toEqual(p)
  })

  it('setUpdateResult updates updateResult', () => {
    const r = { updated: 2, failed: 0, errors: [] }
    useUpdaterStore.getState().setUpdateResult(r)
    expect(useUpdaterStore.getState().updateResult).toEqual(r)
  })

  it('setError updates error', () => {
    useUpdaterStore.getState().setError('winget not found')
    expect(useUpdaterStore.getState().error).toBe('winget not found')
  })

  it('setHasChecked updates hasChecked', () => {
    useUpdaterStore.getState().setHasChecked(true)
    expect(useUpdaterStore.getState().hasChecked).toBe(true)
  })

  it('setSearchQuery updates searchQuery', () => {
    useUpdaterStore.getState().setSearchQuery('firefox')
    expect(useUpdaterStore.getState().searchQuery).toBe('firefox')
  })

  it('setSortField resets sortDirection to asc for severity', () => {
    useUpdaterStore.getState().setSortDirection('desc')
    useUpdaterStore.getState().setSortField('severity')
    expect(useUpdaterStore.getState().sortField).toBe('severity')
    expect(useUpdaterStore.getState().sortDirection).toBe('asc')
  })

  it('setSortField keeps sortDirection for non-severity fields', () => {
    useUpdaterStore.getState().setSortDirection('desc')
    useUpdaterStore.getState().setSortField('name')
    expect(useUpdaterStore.getState().sortDirection).toBe('desc')
  })

  it('setSeverityFilter updates severityFilter', () => {
    useUpdaterStore.getState().setSeverityFilter('major')
    expect(useUpdaterStore.getState().severityFilter).toBe('major')
  })

  it('toggleAppSelected toggles selected on app', () => {
    useUpdaterStore.getState().setApps([makeApp('1')])
    useUpdaterStore.getState().toggleAppSelected('1')
    expect(useUpdaterStore.getState().apps[0]!.selected).toBe(true)
    useUpdaterStore.getState().toggleAppSelected('1')
    expect(useUpdaterStore.getState().apps[0]!.selected).toBe(false)
  })

  it('toggleAppSelected preserves non-target apps', () => {
    useUpdaterStore.getState().setApps([makeApp('1'), makeApp('2')])
    useUpdaterStore.getState().toggleAppSelected('1')
    expect(useUpdaterStore.getState().apps[0]!.selected).toBe(true)
    expect(useUpdaterStore.getState().apps[1]!.selected).toBe(false)
  })

  it('selectAll selects all apps', () => {
    useUpdaterStore.getState().setApps([makeApp('1'), makeApp('2')])
    useUpdaterStore.getState().selectAll()
    expect(useUpdaterStore.getState().apps.every((a) => a.selected)).toBe(true)
  })

  it('deselectAll deselects all apps', () => {
    useUpdaterStore.setState({ apps: [makeApp('1'), makeApp('2')] })
    for (const a of useUpdaterStore.getState().apps) {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      ;(a as any).selected = true
    }
    useUpdaterStore.getState().deselectAll()
    expect(useUpdaterStore.getState().apps.every((a) => !a.selected)).toBe(true)
  })

  it('removeApps removes apps by ids', () => {
    useUpdaterStore.getState().setApps([makeApp('1'), makeApp('2')])
    useUpdaterStore.getState().removeApps(['1'])
    expect(useUpdaterStore.getState().apps).toHaveLength(1)
  })

  it('loadIgnoredIds rebuilds apps and ignoredApps lists', () => {
    useUpdaterStore.setState({ apps: [makeApp('1'), makeApp('2')] })
    useUpdaterStore.getState().loadIgnoredIds(['1'])
    expect(useUpdaterStore.getState().ignoredIds.has('1')).toBe(true)
    expect(useUpdaterStore.getState().apps).toHaveLength(1)
    expect(useUpdaterStore.getState().apps[0]!.id).toBe('2')
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(1)
    expect(useUpdaterStore.getState().ignoredApps[0]!.id).toBe('1')
  })

  it('ignoreApp moves app to ignored list and persists', () => {
    useUpdaterStore.getState().setApps([makeApp('1'), makeApp('2')])
    useUpdaterStore.getState().ignoreApp('1')
    expect(useUpdaterStore.getState().ignoredIds.has('1')).toBe(true)
    expect(useUpdaterStore.getState().apps).toHaveLength(1)
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(1)
    expect(window.dinho.settingsSet).toHaveBeenCalledWith({ ignoredSoftwareUpdates: ['1'] })
  })

  it('ignoreApp does nothing when app not found', () => {
    useUpdaterStore.getState().setApps([makeApp('1')])
    useUpdaterStore.getState().ignoreApp('nonexistent')
    expect(useUpdaterStore.getState().ignoredIds.has('nonexistent')).toBe(true)
    expect(useUpdaterStore.getState().apps).toHaveLength(1)
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(0)
  })

  it('unignoreApp moves app back from ignored list', () => {
    useUpdaterStore.setState({ apps: [makeApp('2')], ignoredApps: [makeApp('1')], ignoredIds: new Set(['1']) })
    useUpdaterStore.getState().unignoreApp('1')
    expect(useUpdaterStore.getState().ignoredIds.has('1')).toBe(false)
    expect(useUpdaterStore.getState().apps).toHaveLength(2)
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(0)
  })

  it('unignoreApp does nothing when app not in ignored list', () => {
    useUpdaterStore.setState({ apps: [], ignoredApps: [makeApp('1')], ignoredIds: new Set(['1']) })
    useUpdaterStore.getState().unignoreApp('nonexistent')
    expect(useUpdaterStore.getState().ignoredIds.has('nonexistent')).toBe(false)
    expect(useUpdaterStore.getState().apps).toHaveLength(0)
    expect(useUpdaterStore.getState().ignoredApps).toHaveLength(1)
  })

  it('reset restores initial state', () => {
    useUpdaterStore.setState({ apps: [makeApp('1')], hasChecked: true, loading: true })
    useUpdaterStore.getState().reset()
    const s = useUpdaterStore.getState()
    expect(s.apps).toEqual([])
    expect(s.hasChecked).toBe(false)
    expect(s.loading).toBe(false)
  })
})

describe('severityOrder', () => {
  it('orders major before minor', () => {
    expect(severityOrder.major).toBeLessThan(severityOrder.minor)
  })

  it('orders minor before patch', () => {
    expect(severityOrder.minor).toBeLessThan(severityOrder.patch)
  })

  it('orders patch before unknown', () => {
    expect(severityOrder.patch).toBeLessThan(severityOrder.unknown)
  })
})
