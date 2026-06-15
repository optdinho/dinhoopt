import { beforeEach, describe, expect, it } from 'vitest'
import { useLargeFileStore } from './large-file-store'

function makeFile(path: string, size = 1024) {
  const name = path.split('/').pop() ?? ''
  return { path, name, size, lastModified: Date.now(), extension: name.includes('.') ? name.split('.').pop()! : '' }
}

describe('large-file-store', () => {
  beforeEach(() => {
    useLargeFileStore.setState({
      directory: null,
      minFileSize: 104_857_600,
      maxDepth: 20,
      excludePatterns: ['node_modules', '.git', '$Recycle.Bin'],
      status: 'idle',
      progress: null,
      result: null,
      selectedPaths: new Set(),
      deleteMode: 'recycle',
      deleteResult: null,
    })
  })

  it('starts with default values', () => {
    const s = useLargeFileStore.getState()
    expect(s.directory).toBeNull()
    expect(s.minFileSize).toBe(104_857_600)
    expect(s.maxDepth).toBe(20)
    expect(s.excludePatterns).toEqual(['node_modules', '.git', '$Recycle.Bin'])
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
    expect(s.selectedPaths).toEqual(new Set())
    expect(s.deleteMode).toBe('recycle')
    expect(s.deleteResult).toBeNull()
  })

  it('setDirectory updates directory', () => {
    useLargeFileStore.getState().setDirectory('C:\\Files')
    expect(useLargeFileStore.getState().directory).toBe('C:\\Files')
  })

  it('setMinFileSize updates minFileSize', () => {
    useLargeFileStore.getState().setMinFileSize(50_000_000)
    expect(useLargeFileStore.getState().minFileSize).toBe(50_000_000)
  })

  it('setMaxDepth updates maxDepth', () => {
    useLargeFileStore.getState().setMaxDepth(5)
    expect(useLargeFileStore.getState().maxDepth).toBe(5)
  })

  it('setExcludePatterns updates excludePatterns', () => {
    useLargeFileStore.getState().setExcludePatterns(['.git'])
    expect(useLargeFileStore.getState().excludePatterns).toEqual(['.git'])
  })

  it('setStatus updates status', () => {
    useLargeFileStore.getState().setStatus('scanning')
    expect(useLargeFileStore.getState().status).toBe('scanning')
  })

  it('setProgress updates progress', () => {
    const p = { currentPath: 'C:\\', filesScanned: 50, largeFilesFound: 3, progress: 0.4 }
    useLargeFileStore.getState().setProgress(p)
    expect(useLargeFileStore.getState().progress).toEqual(p)
  })

  it('setResult updates result', () => {
    const r = { files: [makeFile('C:\\big.bin')], totalFilesScanned: 100, duration: 500, cancelled: false }
    useLargeFileStore.getState().setResult(r)
    expect(useLargeFileStore.getState().result).toEqual(r)
  })

  it('setDeleteMode updates deleteMode', () => {
    useLargeFileStore.getState().setDeleteMode('permanent')
    expect(useLargeFileStore.getState().deleteMode).toBe('permanent')
  })

  it('setDeleteResult updates deleteResult', () => {
    const dr = { deleted: 3, failed: 0, spaceRecovered: 300_000_000, errors: [] }
    useLargeFileStore.getState().setDeleteResult(dr)
    expect(useLargeFileStore.getState().deleteResult).toEqual(dr)
  })

  it('togglePath adds new path', () => {
    useLargeFileStore.getState().togglePath('C:\\big.bin')
    expect(useLargeFileStore.getState().selectedPaths.has('C:\\big.bin')).toBe(true)
  })

  it('togglePath removes existing path', () => {
    useLargeFileStore.setState({ selectedPaths: new Set(['C:\\big.bin']) })
    useLargeFileStore.getState().togglePath('C:\\big.bin')
    expect(useLargeFileStore.getState().selectedPaths.has('C:\\big.bin')).toBe(false)
  })

  it('selectAll selects all file paths from result', () => {
    const files = [makeFile('C:\\a.bin'), makeFile('C:\\b.bin')]
    useLargeFileStore.getState().setResult({ files, totalFilesScanned: 2, duration: 100, cancelled: false })
    useLargeFileStore.getState().selectAll()
    expect(useLargeFileStore.getState().selectedPaths.size).toBe(2)
  })

  it('selectAll does nothing when result is null', () => {
    useLargeFileStore.getState().selectAll()
    expect(useLargeFileStore.getState().selectedPaths.size).toBe(0)
  })

  it('deselectAll clears selected paths', () => {
    useLargeFileStore.setState({ selectedPaths: new Set(['C:\\a.bin']) })
    useLargeFileStore.getState().deselectAll()
    expect(useLargeFileStore.getState().selectedPaths.size).toBe(0)
  })

  it('removeDeletedFiles removes files and updates selection', () => {
    const files = [makeFile('C:\\keep.bin'), makeFile('C:\\del.bin')]
    useLargeFileStore.getState().setResult({ files, totalFilesScanned: 2, duration: 100, cancelled: false })
    useLargeFileStore.setState({ selectedPaths: new Set(['C:\\keep.bin', 'C:\\del.bin']) })
    useLargeFileStore.getState().removeDeletedFiles(new Set(['C:\\del.bin']))
    const state = useLargeFileStore.getState()
    expect(state.result!.files).toHaveLength(1)
    expect(state.result!.files[0]!.path).toBe('C:\\keep.bin')
    expect(state.selectedPaths.has('C:\\del.bin')).toBe(false)
    expect(state.selectedPaths.has('C:\\keep.bin')).toBe(true)
  })

  it('removeDeletedFiles does nothing when result is null', () => {
    useLargeFileStore.getState().removeDeletedFiles(new Set(['C:\\x']))
    expect(useLargeFileStore.getState().result).toBeNull()
  })

  it('reset restores initial state', () => {
    useLargeFileStore.getState().setDirectory('C:\\')
    useLargeFileStore.getState().setStatus('complete')
    useLargeFileStore.getState().togglePath('C:\\x.bin')
    useLargeFileStore.getState().reset()
    const s = useLargeFileStore.getState()
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
    expect(s.selectedPaths.size).toBe(0)
    expect(s.deleteResult).toBeNull()
  })
})
