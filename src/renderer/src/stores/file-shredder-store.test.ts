import { beforeEach, describe, expect, it } from 'vitest'
import { useFileShredderStore } from './file-shredder-store'

function makeEntry(path: string, size = 1024, isDirectory = false) {
  return { path, name: path.split('/').pop() ?? '', size, isDirectory }
}

describe('file-shredder-store', () => {
  beforeEach(() => {
    useFileShredderStore.setState({
      entries: [],
      status: 'idle',
      progress: null,
      result: null,
    })
  })

  it('starts with default values', () => {
    const s = useFileShredderStore.getState()
    expect(s.entries).toEqual([])
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
  })

  it('addEntries adds unique entries', () => {
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt'), makeEntry('C:\\b.txt')])
    expect(useFileShredderStore.getState().entries).toHaveLength(2)
  })

  it('addEntries does not add duplicates by path', () => {
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt')])
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt'), makeEntry('C:\\b.txt')])
    expect(useFileShredderStore.getState().entries).toHaveLength(2)
  })

  it('addEntries with empty array does nothing', () => {
    useFileShredderStore.getState().addEntries([])
    expect(useFileShredderStore.getState().entries).toEqual([])
  })

  it('removeEntry removes entry by path', () => {
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt'), makeEntry('C:\\b.txt')])
    useFileShredderStore.getState().removeEntry('C:\\a.txt')
    expect(useFileShredderStore.getState().entries).toHaveLength(1)
    expect(useFileShredderStore.getState().entries[0]!.path).toBe('C:\\b.txt')
  })

  it('removeEntry does nothing for non-existent path', () => {
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt')])
    useFileShredderStore.getState().removeEntry('C:\\nope.txt')
    expect(useFileShredderStore.getState().entries).toHaveLength(1)
  })

  it('clearEntries removes all entries', () => {
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt'), makeEntry('C:\\b.txt')])
    useFileShredderStore.getState().clearEntries()
    expect(useFileShredderStore.getState().entries).toEqual([])
  })

  it('setStatus updates status', () => {
    useFileShredderStore.getState().setStatus('shredding')
    expect(useFileShredderStore.getState().status).toBe('shredding')
  })

  it('setProgress updates progress', () => {
    const p = {
      currentPath: 'C:\\a.txt',
      filesShredded: 1,
      totalFiles: 5,
      bytesShredded: 1024,
      totalBytes: 5120,
      progress: 0.2,
    }
    useFileShredderStore.getState().setProgress(p)
    expect(useFileShredderStore.getState().progress).toEqual(p)
  })

  it('setProgress with null clears progress', () => {
    useFileShredderStore.getState().setProgress({
      currentPath: 'C:\\a.txt',
      filesShredded: 1,
      totalFiles: 5,
      bytesShredded: 1024,
      totalBytes: 5120,
      progress: 0.2,
    })
    useFileShredderStore.getState().setProgress(null)
    expect(useFileShredderStore.getState().progress).toBeNull()
  })

  it('setResult updates result', () => {
    const r = { shredded: 3, failed: 0, bytesShredded: 3072, duration: 2000, errors: [], cancelled: false }
    useFileShredderStore.getState().setResult(r)
    expect(useFileShredderStore.getState().result).toEqual(r)
  })

  it('setResult with null clears result', () => {
    useFileShredderStore
      .getState()
      .setResult({ shredded: 3, failed: 0, bytesShredded: 3072, duration: 2000, errors: [], cancelled: false })
    useFileShredderStore.getState().setResult(null)
    expect(useFileShredderStore.getState().result).toBeNull()
  })

  it('reset restores initial state', () => {
    useFileShredderStore.getState().addEntries([makeEntry('C:\\a.txt')])
    useFileShredderStore.getState().setStatus('shredding')
    useFileShredderStore.getState().reset()
    const s = useFileShredderStore.getState()
    expect(s.entries).toEqual([])
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
  })
})
