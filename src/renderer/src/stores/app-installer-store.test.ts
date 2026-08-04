import type { AppInstallerApp, AppInstallProgress, AppInstallResult } from '@shared/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppInstallerStore } from './app-installer-store'

const sampleApps: AppInstallerApp[] = [
  {
    id: 'Mozilla.Firefox',
    name: 'Firefox',
    category: 'browser',
    description: 'Browser',
    isInstalled: false,
  },
  {
    id: 'Google.Chrome',
    name: 'Chrome',
    category: 'browser',
    description: 'Browser',
    isInstalled: true,
    installedVersion: '120.0.0.1',
  },
  {
    id: 'Discord.Discord',
    name: 'Discord',
    category: 'communication',
    isInstalled: false,
  },
]

const sampleProgress: AppInstallProgress = {
  phase: 'installing',
  current: 1,
  total: 2,
  currentApp: 'Mozilla.Firefox',
  percent: 50,
  status: 'in-progress',
}

const sampleResult: AppInstallResult = {
  succeeded: 1,
  failed: 1,
  errors: [{ appId: 'Discord.Discord', name: 'Discord', reason: 'rejected' }],
}

beforeEach(() => {
  useAppInstallerStore.setState({
    apps: [],
    loading: false,
    installing: false,
    cancelled: false,
    progress: null,
    installResult: null,
    error: null,
    hasLoaded: false,
    wingetAvailable: true,
    searchQuery: '',
    categoryFilter: 'all',
    showOnlySelected: false,
    selectedIds: new Set<string>(),
  })
})

describe('app-installer-store', () => {
  it('starts with default state', () => {
    const s = useAppInstallerStore.getState()
    expect(s.apps).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.installing).toBe(false)
    expect(s.cancelled).toBe(false)
    expect(s.progress).toBeNull()
    expect(s.installResult).toBeNull()
    expect(s.error).toBeNull()
    expect(s.hasLoaded).toBe(false)
    expect(s.wingetAvailable).toBe(true)
    expect(s.searchQuery).toBe('')
    expect(s.categoryFilter).toBe('all')
    expect(s.showOnlySelected).toBe(false)
    expect(s.selectedIds).toEqual(new Set<string>())
  })

  it('setApps replaces the app list', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    expect(useAppInstallerStore.getState().apps).toEqual(sampleApps)
  })

  it('setLoading updates loading flag', () => {
    useAppInstallerStore.getState().setLoading(true)
    expect(useAppInstallerStore.getState().loading).toBe(true)
  })

  it('setInstalling updates installing flag', () => {
    useAppInstallerStore.getState().setInstalling(true)
    expect(useAppInstallerStore.getState().installing).toBe(true)
  })

  it('setProgress updates progress', () => {
    useAppInstallerStore.getState().setProgress(sampleProgress)
    expect(useAppInstallerStore.getState().progress).toEqual(sampleProgress)
  })

  it('setProgress accepts null', () => {
    useAppInstallerStore.getState().setProgress(sampleProgress)
    useAppInstallerStore.getState().setProgress(null)
    expect(useAppInstallerStore.getState().progress).toBeNull()
  })

  it('setInstallResult updates install result', () => {
    useAppInstallerStore.getState().setInstallResult(sampleResult)
    expect(useAppInstallerStore.getState().installResult).toEqual(sampleResult)
  })

  it('setError updates error', () => {
    useAppInstallerStore.getState().setError('boom')
    expect(useAppInstallerStore.getState().error).toBe('boom')
  })

  it('setHasLoaded updates hasLoaded', () => {
    useAppInstallerStore.getState().setHasLoaded(true)
    expect(useAppInstallerStore.getState().hasLoaded).toBe(true)
  })

  it('setWingetAvailable updates wingetAvailable', () => {
    useAppInstallerStore.getState().setWingetAvailable(false)
    expect(useAppInstallerStore.getState().wingetAvailable).toBe(false)
  })

  it('setSearchQuery updates search query', () => {
    useAppInstallerStore.getState().setSearchQuery('firefox')
    expect(useAppInstallerStore.getState().searchQuery).toBe('firefox')
  })

  it('setCategoryFilter updates category filter', () => {
    useAppInstallerStore.getState().setCategoryFilter('browser')
    expect(useAppInstallerStore.getState().categoryFilter).toBe('browser')
  })

  it('setShowOnlySelected toggles showOnlySelected', () => {
    useAppInstallerStore.getState().setShowOnlySelected(true)
    expect(useAppInstallerStore.getState().showOnlySelected).toBe(true)
    useAppInstallerStore.getState().setShowOnlySelected(false)
    expect(useAppInstallerStore.getState().showOnlySelected).toBe(false)
  })

  it('toggleSelected adds a new id', () => {
    useAppInstallerStore.getState().toggleSelected('Mozilla.Firefox')
    expect(useAppInstallerStore.getState().selectedIds.has('Mozilla.Firefox')).toBe(true)
  })

  it('toggleSelected removes an existing id without mutating previous set', () => {
    useAppInstallerStore.getState().toggleSelected('Mozilla.Firefox')
    useAppInstallerStore.getState().toggleSelected('Mozilla.Firefox')
    expect(useAppInstallerStore.getState().selectedIds.has('Mozilla.Firefox')).toBe(false)
  })

  it('toggleSelected keeps other selections intact', () => {
    useAppInstallerStore.getState().toggleSelected('Mozilla.Firefox')
    useAppInstallerStore.getState().toggleSelected('Discord.Discord')
    useAppInstallerStore.getState().toggleSelected('Mozilla.Firefox')
    const ids = useAppInstallerStore.getState().selectedIds
    expect(ids.has('Discord.Discord')).toBe(true)
    expect(ids.size).toBe(1)
  })

  it('selectCategory selects all matching apps for a category', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().selectCategory('browser')
    const ids = useAppInstallerStore.getState().selectedIds
    expect(ids.has('Mozilla.Firefox')).toBe(true)
    expect(ids.has('Google.Chrome')).toBe(true)
    expect(ids.has('Discord.Discord')).toBe(false)
  })

  it('selectCategory with not-installed selects only uninstalled apps', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().selectCategory('not-installed')
    const ids = useAppInstallerStore.getState().selectedIds
    expect(ids.has('Mozilla.Firefox')).toBe(true)
    expect(ids.has('Discord.Discord')).toBe(true)
    expect(ids.has('Google.Chrome')).toBe(false)
  })

  it('selectCategory with installed selects only installed apps', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().selectCategory('installed')
    const ids = useAppInstallerStore.getState().selectedIds
    expect(ids.has('Google.Chrome')).toBe(true)
    expect(ids.has('Mozilla.Firefox')).toBe(false)
  })

  it('selectCategory with all selects every app', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().selectCategory('all')
    expect(useAppInstallerStore.getState().selectedIds.size).toBe(3)
  })

  it('selectCategory does not deselect apps outside the target filter', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().toggleSelected('Discord.Discord')
    useAppInstallerStore.getState().selectCategory('browser')
    expect(useAppInstallerStore.getState().selectedIds.has('Discord.Discord')).toBe(true)
  })

  it('deselectAll clears the selection', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().selectCategory('all')
    useAppInstallerStore.getState().deselectAll()
    expect(useAppInstallerStore.getState().selectedIds.size).toBe(0)
  })

  it('reset restores default state', () => {
    useAppInstallerStore.getState().setApps(sampleApps)
    useAppInstallerStore.getState().setLoading(true)
    useAppInstallerStore.getState().setInstalling(true)
    useAppInstallerStore.getState().setProgress(sampleProgress)
    useAppInstallerStore.getState().setInstallResult(sampleResult)
    useAppInstallerStore.getState().setError('boom')
    useAppInstallerStore.getState().setHasLoaded(true)
    useAppInstallerStore.getState().setWingetAvailable(false)
    useAppInstallerStore.getState().setSearchQuery('x')
    useAppInstallerStore.getState().setCategoryFilter('gaming')
    useAppInstallerStore.getState().setShowOnlySelected(true)
    useAppInstallerStore.getState().toggleSelected('Mozilla.Firefox')
    useAppInstallerStore.getState().reset()
    const s = useAppInstallerStore.getState()
    expect(s.apps).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.installing).toBe(false)
    expect(s.cancelled).toBe(false)
    expect(s.progress).toBeNull()
    expect(s.installResult).toBeNull()
    expect(s.error).toBeNull()
    expect(s.hasLoaded).toBe(false)
    expect(s.wingetAvailable).toBe(true)
    expect(s.searchQuery).toBe('')
    expect(s.categoryFilter).toBe('all')
    expect(s.showOnlySelected).toBe(false)
    expect(s.selectedIds).toEqual(new Set<string>())
  })
})
