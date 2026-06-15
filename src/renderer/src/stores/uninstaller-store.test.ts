import type { InstalledProgram, StartupSafetyRating } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNUSED_THRESHOLD_DAYS, useUninstallerStore } from './uninstaller-store'

function makeProgram(overrides: Partial<InstalledProgram> = {}): InstalledProgram {
  return {
    id: 'prog-1',
    displayName: 'Test Program',
    publisher: 'Test Publisher',
    displayVersion: '1.0.0',
    installDate: '2024-01-01',
    estimatedSize: 50000000,
    installLocation: 'C:\\Program Files\\Test',
    uninstallString: 'C:\\Program Files\\Test\\uninstall.exe',
    quietUninstallString: '',
    displayIcon: '',
    registryKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Test',
    isSystemComponent: false,
    isWindowsInstaller: false,
    lastUsed: Date.now(),
    ...overrides,
  }
}

describe('uninstaller-store', () => {
  beforeEach(() => {
    useUninstallerStore.getState().reset()
  })

  it('starts with default values', () => {
    const s = useUninstallerStore.getState()
    expect(s.programs).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.uninstalling).toBe(false)
    expect(s.progress).toBeNull()
    expect(s.uninstallResult).toBeNull()
    expect(s.error).toBeNull()
    expect(s.hasLoaded).toBe(false)
    expect(s.searchQuery).toBe('')
    expect(s.sortField).toBe('displayName')
    expect(s.sortDirection).toBe('asc')
    expect(s.filterMode).toBe('all')
    expect(s.selectedIds).toEqual(new Set())
    expect(s.safetyRatings).toEqual({})
    expect(s.safetyLoading).toBe(false)
    expect(s.expandedItemId).toBeNull()
  })

  it('setPrograms replaces programs and clears selection', () => {
    const programs = [makeProgram({ id: '1' }), makeProgram({ id: '2' })]
    useUninstallerStore.getState().setPrograms(programs)
    const s = useUninstallerStore.getState()
    expect(s.programs).toHaveLength(2)
    expect(s.programs[0]!.id).toBe('1')
    expect(s.selectedIds).toEqual(new Set())
  })

  it('setLoading updates loading', () => {
    useUninstallerStore.getState().setLoading(true)
    expect(useUninstallerStore.getState().loading).toBe(true)
  })

  it('setUninstalling updates uninstalling', () => {
    useUninstallerStore.getState().setUninstalling(true)
    expect(useUninstallerStore.getState().uninstalling).toBe(true)
  })

  it('setProgress updates progress', () => {
    const progress = { phase: 'uninstalling' as const, currentProgram: 'Test', progress: 50, detail: 'Removing...' }
    useUninstallerStore.getState().setProgress(progress)
    expect(useUninstallerStore.getState().progress).toEqual(progress)
  })

  it('setProgress with null clears progress', () => {
    useUninstallerStore.getState().setProgress(null)
    expect(useUninstallerStore.getState().progress).toBeNull()
  })

  it('setUninstallResult updates result', () => {
    const result = {
      success: true,
      programName: 'Test',
      exitCode: 0,
      leftoversFound: 0,
      leftoversCleaned: 0,
      leftoversSize: 0,
    }
    useUninstallerStore.getState().setUninstallResult(result)
    expect(useUninstallerStore.getState().uninstallResult).toEqual(result)
  })

  it('setError updates error', () => {
    useUninstallerStore.getState().setError('Something went wrong')
    expect(useUninstallerStore.getState().error).toBe('Something went wrong')
  })

  it('setHasLoaded updates hasLoaded', () => {
    useUninstallerStore.getState().setHasLoaded(true)
    expect(useUninstallerStore.getState().hasLoaded).toBe(true)
  })

  it('setSearchQuery updates searchQuery', () => {
    useUninstallerStore.getState().setSearchQuery('test')
    expect(useUninstallerStore.getState().searchQuery).toBe('test')
  })

  it('setSortField updates sortField', () => {
    useUninstallerStore.getState().setSortField('publisher')
    expect(useUninstallerStore.getState().sortField).toBe('publisher')
  })

  it('setSortDirection updates sortDirection', () => {
    useUninstallerStore.getState().setSortDirection('desc')
    expect(useUninstallerStore.getState().sortDirection).toBe('desc')
  })

  it('setFilterMode updates filterMode', () => {
    useUninstallerStore.getState().setFilterMode('unused')
    expect(useUninstallerStore.getState().filterMode).toBe('unused')
  })

  it('removeProgram removes by id and cleans selection', () => {
    useUninstallerStore.getState().setPrograms([makeProgram({ id: '1' }), makeProgram({ id: '2' })])
    useUninstallerStore.getState().toggleSelected('1')
    useUninstallerStore.getState().removeProgram('1')
    const s = useUninstallerStore.getState()
    expect(s.programs).toHaveLength(1)
    expect(s.programs[0]!.id).toBe('2')
    expect(s.selectedIds.has('1')).toBe(false)
  })

  it('toggleSelected adds and removes from selection', () => {
    useUninstallerStore.getState().setPrograms([makeProgram({ id: '1' })])
    useUninstallerStore.getState().toggleSelected('1')
    expect(useUninstallerStore.getState().selectedIds.has('1')).toBe(true)
    useUninstallerStore.getState().toggleSelected('1')
    expect(useUninstallerStore.getState().selectedIds.has('1')).toBe(false)
  })

  it('selectAll sets selectedIds', () => {
    useUninstallerStore.getState().selectAll(['1', '2', '3'])
    expect(useUninstallerStore.getState().selectedIds).toEqual(new Set(['1', '2', '3']))
  })

  it('clearSelected empties selection', () => {
    useUninstallerStore.getState().selectAll(['1', '2'])
    useUninstallerStore.getState().clearSelected()
    expect(useUninstallerStore.getState().selectedIds).toEqual(new Set())
  })

  it('setSafetyRatings converts array to record', () => {
    const ratings: StartupSafetyRating[] = [
      { name: 'TestApp', safetyScore: 80, description: 'Safe', analyzedAt: new Date().toISOString() },
    ]
    useUninstallerStore.getState().setSafetyRatings(ratings)
    expect(useUninstallerStore.getState().safetyRatings.TestApp).toEqual(ratings[0])
  })

  it('setSafetyLoading updates safetyLoading', () => {
    useUninstallerStore.getState().setSafetyLoading(true)
    expect(useUninstallerStore.getState().safetyLoading).toBe(true)
  })

  it('setExpandedItemId updates expandedItemId', () => {
    useUninstallerStore.getState().setExpandedItemId('prog-1')
    expect(useUninstallerStore.getState().expandedItemId).toBe('prog-1')
  })

  it('fetchSafetyRatings calls API and stores ratings', async () => {
    const ratings: StartupSafetyRating[] = [
      { name: 'TestApp', safetyScore: 80, description: 'Safe', analyzedAt: new Date().toISOString() },
    ]
    vi.stubGlobal('window', {
      dinho: {
        programSafetyFetch: vi.fn().mockResolvedValue({ ratings }),
      },
    })
    await useUninstallerStore.getState().fetchSafetyRatings()
    expect(useUninstallerStore.getState().safetyRatings.TestApp).toEqual(ratings[0])
    expect(useUninstallerStore.getState().safetyLoading).toBe(false)
    vi.restoreAllMocks()
  })

  it('fetchSafetyRatings handles API failure gracefully', async () => {
    vi.stubGlobal('window', {
      dinho: {
        programSafetyFetch: vi.fn().mockRejectedValue(new Error('fail')),
      },
    })
    await useUninstallerStore.getState().fetchSafetyRatings()
    expect(useUninstallerStore.getState().safetyLoading).toBe(false)
    expect(useUninstallerStore.getState().safetyRatings).toEqual({})
    vi.restoreAllMocks()
  })

  it('reset restores initial state', () => {
    useUninstallerStore.getState().setPrograms([makeProgram({ id: '1' })])
    useUninstallerStore.getState().setLoading(true)
    useUninstallerStore.getState().setError('error')
    useUninstallerStore.getState().reset()
    const s = useUninstallerStore.getState()
    expect(s.programs).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
    expect(s.hasLoaded).toBe(false)
    expect(s.selectedIds).toEqual(new Set())
  })

  it('UNUSED_THRESHOLD_DAYS is 90', () => {
    expect(UNUSED_THRESHOLD_DAYS).toBe(90)
  })
})
