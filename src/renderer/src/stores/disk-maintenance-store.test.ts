import { beforeEach, describe, expect, it } from 'vitest'
import { applyFilter, isSelectable, useDiskMaintenanceStore } from './disk-maintenance-store'

function makeDrive(
  id: string,
  overrides: Partial<{
    mediaType: import('@shared/types').TrimMediaType
    trimSupport: import('@shared/types').TrimSupport
    isRemovable: boolean
    status: import('@shared/types').TrimStatus
  }> = {},
) {
  return {
    id,
    letter: id.replace(':', ''),
    label: `Drive ${id}`,
    totalSize: 256_000_000_000,
    freeSpace: 128_000_000_000,
    mediaType: overrides.mediaType ?? 'SSD',
    filesystem: 'NTFS',
    isRemovable: overrides.isRemovable ?? false,
    isEncrypted: false,
    trimSupport: overrides.trimSupport ?? 'supported',
    status: overrides.status ?? 'ok',
    statusReason: '',
    lastTrimAt: null,
    estimatedWear: 20,
    temperature: 35,
  }
}

describe('disk-maintenance-store', () => {
  beforeEach(() => {
    useDiskMaintenanceStore.setState({
      drives: [],
      loading: false,
      error: null,
      selected: new Set(),
      filter: 'all',
      runStates: {},
      results: {},
      progress: {},
      batchRunning: false,
    })
  })

  it('starts with default state', () => {
    const s = useDiskMaintenanceStore.getState()
    expect(s.drives).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
    expect(s.selected.size).toBe(0)
    expect(s.filter).toBe('all')
    expect(s.runStates).toEqual({})
    expect(s.results).toEqual({})
    expect(s.progress).toEqual({})
    expect(s.batchRunning).toBe(false)
  })

  it('setDrives replaces drives', () => {
    const drives = [makeDrive('C:'), makeDrive('D:')]
    useDiskMaintenanceStore.getState().setDrives(drives)
    expect(useDiskMaintenanceStore.getState().drives).toEqual(drives)
  })

  it('setLoading updates loading', () => {
    useDiskMaintenanceStore.getState().setLoading(true)
    expect(useDiskMaintenanceStore.getState().loading).toBe(true)
  })

  it('setError updates error', () => {
    useDiskMaintenanceStore.getState().setError('err')
    expect(useDiskMaintenanceStore.getState().error).toBe('err')
  })

  it('setFilter updates filter', () => {
    useDiskMaintenanceStore.getState().setFilter('ssd')
    expect(useDiskMaintenanceStore.getState().filter).toBe('ssd')
  })

  it('toggleSelect adds and removes drive id from selected', () => {
    useDiskMaintenanceStore.getState().toggleSelect('C:')
    expect(useDiskMaintenanceStore.getState().selected.has('C:')).toBe(true)
    useDiskMaintenanceStore.getState().toggleSelect('C:')
    expect(useDiskMaintenanceStore.getState().selected.has('C:')).toBe(false)
  })

  it('setSelected replaces selected set', () => {
    useDiskMaintenanceStore.getState().setSelected(['C:', 'D:'])
    expect(useDiskMaintenanceStore.getState().selected.size).toBe(2)
  })

  it('clearSelection empties selected', () => {
    useDiskMaintenanceStore.getState().setSelected(['C:', 'D:'])
    useDiskMaintenanceStore.getState().clearSelection()
    expect(useDiskMaintenanceStore.getState().selected.size).toBe(0)
  })

  it('setRunState stores state per drive', () => {
    useDiskMaintenanceStore.getState().setRunState('C:', 'running')
    expect(useDiskMaintenanceStore.getState().runStates['C:']).toBe('running')
  })

  it('setResult stores result per drive', () => {
    const r: import('@shared/types').TrimRunResult = {
      driveId: 'C:',
      success: true,
      durationMs: 100,
      exitCode: 0,
      summary: '',
      log: '',
      timestamp: Date.now(),
    }
    useDiskMaintenanceStore.getState().setResult('C:', r)
    expect(useDiskMaintenanceStore.getState().results['C:']).toEqual(r)
  })

  it('setProgress stores progress by driveId', () => {
    const p: import('@shared/types').TrimProgress = {
      driveId: 'C:',
      phase: 'running',
      percent: 50,
      message: 'Trimming...',
    }
    useDiskMaintenanceStore.getState().setProgress(p)
    expect(useDiskMaintenanceStore.getState().progress['C:']).toEqual(p)
  })

  it('clearProgress empties progress', () => {
    useDiskMaintenanceStore
      .getState()
      .setProgress({ driveId: 'C:', phase: 'running', percent: 50, message: 'Trimming...' })
    useDiskMaintenanceStore.getState().clearProgress()
    expect(useDiskMaintenanceStore.getState().progress).toEqual({})
  })

  it('setBatchRunning updates batchRunning', () => {
    useDiskMaintenanceStore.getState().setBatchRunning(true)
    expect(useDiskMaintenanceStore.getState().batchRunning).toBe(true)
  })

  it('reset restores initial state', () => {
    useDiskMaintenanceStore.getState().setDrives([makeDrive('C:')])
    useDiskMaintenanceStore.getState().setLoading(true)
    useDiskMaintenanceStore.getState().toggleSelect('C:')
    useDiskMaintenanceStore.getState().reset()
    const s = useDiskMaintenanceStore.getState()
    expect(s.drives).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.selected.size).toBe(0)
    expect(s.runStates).toEqual({})
    expect(s.results).toEqual({})
    expect(s.progress).toEqual({})
  })
})

describe('isSelectable', () => {
  it('returns false for HDD', () => {
    expect(isSelectable(makeDrive('C:', { mediaType: 'HDD' }))).toBe(false)
  })

  it('returns false for macos-managed trim', () => {
    expect(isSelectable(makeDrive('C:', { trimSupport: 'macos-managed' }))).toBe(false)
  })

  it('returns false for unsupported trim', () => {
    expect(isSelectable(makeDrive('C:', { trimSupport: 'unsupported' }))).toBe(false)
  })

  it('returns false for disabled trim', () => {
    expect(isSelectable(makeDrive('C:', { trimSupport: 'disabled' }))).toBe(false)
  })

  it('returns false for removable drives', () => {
    expect(isSelectable(makeDrive('C:', { isRemovable: true }))).toBe(false)
  })

  it('returns true for supported SSD', () => {
    expect(isSelectable(makeDrive('C:', { mediaType: 'SSD', trimSupport: 'supported' }))).toBe(true)
  })

  it('returns true for NVMe', () => {
    expect(isSelectable(makeDrive('C:', { mediaType: 'NVMe', trimSupport: 'supported' }))).toBe(true)
  })
})

describe('applyFilter', () => {
  const drives = [
    makeDrive('C:', { mediaType: 'SSD', status: 'ok' }),
    makeDrive('D:', { mediaType: 'HDD', status: 'ok' }),
    makeDrive('E:', { mediaType: 'NVMe', status: 'recommended' }),
  ]

  it('returns all drives for all filter', () => {
    expect(applyFilter(drives, 'all')).toHaveLength(3)
  })

  it('returns only SSD/NVMe for ssd filter', () => {
    const result = applyFilter(drives, 'ssd')
    expect(result).toHaveLength(2)
    expect(result.every((d) => d.mediaType === 'SSD' || d.mediaType === 'NVMe')).toBe(true)
  })

  it('returns needs-trim drives', () => {
    const result = applyFilter(drives, 'needs-trim')
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('E:')
  })
})
