import { beforeEach, describe, expect, it } from 'vitest'
import { useEmptyFolderStore } from './empty-folder-store'

function makeFolder(path: string, name?: string, depth = 1) {
  return { path, name: name ?? path.split('/').pop() ?? '', depth }
}

describe('empty-folder-store', () => {
  beforeEach(() => {
    useEmptyFolderStore.setState({
      directory: null,
      maxDepth: 20,
      excludePatterns: [
        'node_modules',
        '$Recycle.Bin',
        'System Volume Information',
        'Chrome',
        'Firefox',
        'Edge',
        'BraveSoftware',
        'Opera',
        'Vivaldi',
        'Cache',
        'Code Cache',
        'GPUCache',
        'ShaderCache',
        'GrShaderCache',
        'DawnCache',
        'CacheStorage',
        'Service Worker',
        'IndexedDB',
        'Crashpad',
        'BrowserMetrics',
        'Safe Browsing',
      ],
      status: 'idle',
      progress: null,
      result: null,
      selectedPaths: new Set(),
      deleteMode: 'recycle',
      deleteResult: null,
    })
  })

  it('starts with default values', () => {
    const s = useEmptyFolderStore.getState()
    expect(s.directory).toBeNull()
    expect(s.maxDepth).toBe(20)
    expect(s.excludePatterns).toContain('node_modules')
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
    expect(s.selectedPaths).toEqual(new Set())
    expect(s.deleteMode).toBe('recycle')
    expect(s.deleteResult).toBeNull()
  })

  it('setDirectory updates directory', () => {
    useEmptyFolderStore.getState().setDirectory('C:\\Temp')
    expect(useEmptyFolderStore.getState().directory).toBe('C:\\Temp')
  })

  it('setMaxDepth updates maxDepth', () => {
    useEmptyFolderStore.getState().setMaxDepth(10)
    expect(useEmptyFolderStore.getState().maxDepth).toBe(10)
  })

  it('setExcludePatterns updates excludePatterns', () => {
    useEmptyFolderStore.getState().setExcludePatterns(['.git', '.svn'])
    expect(useEmptyFolderStore.getState().excludePatterns).toEqual(['.git', '.svn'])
  })

  it('setStatus updates status', () => {
    useEmptyFolderStore.getState().setStatus('scanning')
    expect(useEmptyFolderStore.getState().status).toBe('scanning')
  })

  it('setProgress updates progress', () => {
    const progress = { currentPath: 'C:\\', foldersScanned: 10, emptyFound: 2, progress: 0.5 }
    useEmptyFolderStore.getState().setProgress(progress)
    expect(useEmptyFolderStore.getState().progress).toEqual(progress)
  })

  it('setResult updates result', () => {
    const result = { folders: [makeFolder('C:\\empty1')], totalFoldersScanned: 10, duration: 100, cancelled: false }
    useEmptyFolderStore.getState().setResult(result)
    expect(useEmptyFolderStore.getState().result).toEqual(result)
  })

  it('setDeleteMode updates deleteMode', () => {
    useEmptyFolderStore.getState().setDeleteMode('permanent')
    expect(useEmptyFolderStore.getState().deleteMode).toBe('permanent')
  })

  it('setDeleteResult updates deleteResult', () => {
    const deleteResult = { deleted: 5, failed: 1, errors: [{ path: 'C:\\err', reason: 'access denied' }] }
    useEmptyFolderStore.getState().setDeleteResult(deleteResult)
    expect(useEmptyFolderStore.getState().deleteResult).toEqual(deleteResult)
  })

  it('togglePath adds path that was not selected', () => {
    useEmptyFolderStore.getState().togglePath('C:\\folder1')
    expect(useEmptyFolderStore.getState().selectedPaths.has('C:\\folder1')).toBe(true)
  })

  it('togglePath removes path that was already selected', () => {
    useEmptyFolderStore.setState({ selectedPaths: new Set(['C:\\folder1']) })
    useEmptyFolderStore.getState().togglePath('C:\\folder1')
    expect(useEmptyFolderStore.getState().selectedPaths.has('C:\\folder1')).toBe(false)
  })

  it('selectAll selects all folder paths from result', () => {
    const folders = [makeFolder('C:\\a'), makeFolder('C:\\b'), makeFolder('C:\\c')]
    useEmptyFolderStore.getState().setResult({ folders, totalFoldersScanned: 3, duration: 50, cancelled: false })
    useEmptyFolderStore.getState().selectAll()
    expect(useEmptyFolderStore.getState().selectedPaths.size).toBe(3)
  })

  it('selectAll does nothing when result is null', () => {
    useEmptyFolderStore.getState().selectAll()
    expect(useEmptyFolderStore.getState().selectedPaths.size).toBe(0)
  })

  it('deselectAll clears all selected paths', () => {
    useEmptyFolderStore.setState({ selectedPaths: new Set(['C:\\a', 'C:\\b']) })
    useEmptyFolderStore.getState().deselectAll()
    expect(useEmptyFolderStore.getState().selectedPaths.size).toBe(0)
  })

  it('removeDeletedFolders removes folders and updates selectedPaths', () => {
    const folders = [makeFolder('C:\\keep'), makeFolder('C:\\delete')]
    useEmptyFolderStore.getState().setResult({ folders, totalFoldersScanned: 2, duration: 50, cancelled: false })
    useEmptyFolderStore.setState({ selectedPaths: new Set(['C:\\keep', 'C:\\delete']) })
    useEmptyFolderStore.getState().removeDeletedFolders(new Set(['C:\\delete']))
    const state = useEmptyFolderStore.getState()
    expect(state.result!.folders).toHaveLength(1)
    expect(state.result!.folders[0]!.path).toBe('C:\\keep')
    expect(state.selectedPaths.has('C:\\delete')).toBe(false)
    expect(state.selectedPaths.has('C:\\keep')).toBe(true)
  })

  it('removeDeletedFolders does nothing when result is null', () => {
    useEmptyFolderStore.getState().removeDeletedFolders(new Set(['C:\\x']))
    expect(useEmptyFolderStore.getState().result).toBeNull()
  })

  it('reset restores initial state', () => {
    useEmptyFolderStore.getState().setDirectory('C:\\')
    useEmptyFolderStore.getState().setStatus('complete')
    useEmptyFolderStore.getState().togglePath('C:\\x')
    useEmptyFolderStore.getState().reset()
    const s = useEmptyFolderStore.getState()
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
    expect(s.selectedPaths.size).toBe(0)
    expect(s.deleteResult).toBeNull()
  })
})
