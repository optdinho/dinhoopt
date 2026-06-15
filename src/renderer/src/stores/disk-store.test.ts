import { beforeEach, describe, expect, it } from 'vitest'
import { useDiskStore } from './disk-store'

function makeDrive(letter: string): import('@shared/types').DriveInfo {
  return {
    letter,
    label: `Drive ${letter}`,
    totalSize: 256_000_000_000,
    freeSpace: 128_000_000_000,
    usedSpace: 128_000_000_000,
  }
}

function makeNode(path: string) {
  return { name: path.split('\\').pop() ?? path, path, size: 1024, isDirectory: true, children: [] }
}

describe('disk-store', () => {
  beforeEach(() => {
    useDiskStore.setState({
      drives: [],
      selectedDrive: 'C',
      data: null,
      analyzing: false,
      breadcrumb: [],
      error: null,
      fileTypes: [],
      fileTypesLoading: false,
      repairRunning: false,
      repairProgress: null,
      sfcResult: null,
      dismResult: null,
      chkdskResult: null,
    })
  })

  it('starts with default state', () => {
    const s = useDiskStore.getState()
    expect(s.drives).toEqual([])
    expect(s.selectedDrive).toBe('C')
    expect(s.data).toBeNull()
    expect(s.analyzing).toBe(false)
    expect(s.breadcrumb).toEqual([])
    expect(s.error).toBeNull()
    expect(s.fileTypes).toEqual([])
    expect(s.repairRunning).toBe(false)
  })

  it('setDrives replaces drives', () => {
    const drives = [makeDrive('C'), makeDrive('D')]
    useDiskStore.getState().setDrives(drives)
    expect(useDiskStore.getState().drives).toEqual(drives)
  })

  it('setSelectedDrive updates selectedDrive', () => {
    useDiskStore.getState().setSelectedDrive('D')
    expect(useDiskStore.getState().selectedDrive).toBe('D')
  })

  it('setData updates data', () => {
    const data = makeNode('C:\\')
    useDiskStore.getState().setData(data)
    expect(useDiskStore.getState().data).toEqual(data)
  })

  it('setAnalyzing updates analyzing', () => {
    useDiskStore.getState().setAnalyzing(true)
    expect(useDiskStore.getState().analyzing).toBe(true)
  })

  it('setBreadcrumb replaces breadcrumb', () => {
    useDiskStore.getState().setBreadcrumb([makeNode('C:\\Windows')])
    expect(useDiskStore.getState().breadcrumb).toHaveLength(1)
  })

  it('pushBreadcrumb appends node', () => {
    useDiskStore.getState().pushBreadcrumb(makeNode('C:\\Windows'))
    useDiskStore.getState().pushBreadcrumb(makeNode('C:\\Windows\\System32'))
    expect(useDiskStore.getState().breadcrumb).toHaveLength(2)
  })

  it('sliceBreadcrumb truncates to index', () => {
    useDiskStore
      .getState()
      .setBreadcrumb([makeNode('C:\\'), makeNode('C:\\Windows'), makeNode('C:\\Windows\\System32')])
    useDiskStore.getState().sliceBreadcrumb(1)
    expect(useDiskStore.getState().breadcrumb).toHaveLength(2)
    expect(useDiskStore.getState().breadcrumb[1]!.name).toBe('Windows')
  })

  it('setError updates error', () => {
    useDiskStore.getState().setError('access denied')
    expect(useDiskStore.getState().error).toBe('access denied')
  })

  it('setFileTypes updates fileTypes', () => {
    const types: import('@shared/types').FileTypeInfo[] = [{ extension: '.exe', totalSize: 50_000_000, fileCount: 10 }]
    useDiskStore.getState().setFileTypes(types)
    expect(useDiskStore.getState().fileTypes).toEqual(types)
  })

  it('setFileTypesLoading updates loading', () => {
    useDiskStore.getState().setFileTypesLoading(true)
    expect(useDiskStore.getState().fileTypesLoading).toBe(true)
  })

  it('setRepairRunning updates repairRunning', () => {
    useDiskStore.getState().setRepairRunning(true)
    expect(useDiskStore.getState().repairRunning).toBe(true)
  })

  it('setRepairProgress updates repairProgress', () => {
    const p: import('@shared/types').DiskRepairProgress = {
      tool: 'sfc',
      phase: 'running',
      percent: 50,
      message: 'Scanning...',
    }
    useDiskStore.getState().setRepairProgress(p)
    expect(useDiskStore.getState().repairProgress).toEqual(p)
  })

  it('setSfcResult updates sfcResult', () => {
    useDiskStore.getState().setSfcResult({
      tool: 'sfc',
      success: true,
      exitCode: 0,
      summary: 'ok',
      log: '',
      requiresReboot: false,
      needsAdmin: false,
    })
    expect(useDiskStore.getState().sfcResult).toEqual({
      tool: 'sfc',
      success: true,
      exitCode: 0,
      summary: 'ok',
      log: '',
      requiresReboot: false,
      needsAdmin: false,
    })
  })

  it('setDismResult updates dismResult', () => {
    useDiskStore.getState().setDismResult({
      tool: 'dism',
      success: false,
      exitCode: 1,
      summary: 'failed',
      log: 'corrupt',
      requiresReboot: false,
      needsAdmin: true,
    })
    expect(useDiskStore.getState().dismResult).toEqual({
      tool: 'dism',
      success: false,
      exitCode: 1,
      summary: 'failed',
      log: 'corrupt',
      requiresReboot: false,
      needsAdmin: true,
    })
  })

  it('setChkdskResult updates chkdskResult', () => {
    useDiskStore.getState().setChkdskResult({
      tool: 'chkdsk',
      success: true,
      exitCode: 0,
      summary: 'no errors',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    })
    expect(useDiskStore.getState().chkdskResult).toEqual({
      tool: 'chkdsk',
      success: true,
      exitCode: 0,
      summary: 'no errors',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    })
  })

  it('reset restores initial state except drives and selectedDrive', () => {
    useDiskStore.getState().pushBreadcrumb(makeNode('C:\\Windows'))
    useDiskStore.getState().setAnalyzing(true)
    useDiskStore.getState().setRepairRunning(true)
    useDiskStore.getState().reset()
    const s = useDiskStore.getState()
    expect(s.data).toBeNull()
    expect(s.analyzing).toBe(false)
    expect(s.breadcrumb).toEqual([])
    expect(s.error).toBeNull()
    expect(s.repairRunning).toBe(false)
    expect(s.repairProgress).toBeNull()
    expect(s.sfcResult).toBeNull()
  })
})
