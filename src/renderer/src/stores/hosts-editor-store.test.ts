import { beforeEach, describe, expect, it } from 'vitest'
import { useHostsEditorStore } from './hosts-editor-store'

function makeEntry(
  overrides: Partial<{ id: string; ip: string; hostname: string; comment: string; enabled: boolean }> = {},
) {
  return {
    id: overrides.id ?? '1',
    ip: overrides.ip ?? '127.0.0.1',
    hostname: overrides.hostname ?? 'localhost',
    comment: overrides.comment ?? '',
    enabled: overrides.enabled ?? true,
  }
}

describe('hosts-editor-store', () => {
  beforeEach(() => {
    useHostsEditorStore.setState({
      entries: [],
      headerComment: '',
      originalEntries: [],
      originalHeaderComment: '',
      status: 'idle',
      error: null,
      readResult: null,
      writeResult: null,
      flushResult: null,
    })
  })

  it('starts with default values', () => {
    const s = useHostsEditorStore.getState()
    expect(s.entries).toEqual([])
    expect(s.headerComment).toBe('')
    expect(s.originalEntries).toEqual([])
    expect(s.originalHeaderComment).toBe('')
    expect(s.status).toBe('idle')
    expect(s.error).toBeNull()
    expect(s.readResult).toBeNull()
    expect(s.writeResult).toBeNull()
    expect(s.flushResult).toBeNull()
  })

  it('setEntries replaces entries', () => {
    const entries = [makeEntry()]
    useHostsEditorStore.getState().setEntries(entries)
    expect(useHostsEditorStore.getState().entries).toEqual(entries)
  })

  it('setHeaderComment updates header comment', () => {
    useHostsEditorStore.getState().setHeaderComment('# My hosts')
    expect(useHostsEditorStore.getState().headerComment).toBe('# My hosts')
  })

  it('setStatus updates status', () => {
    useHostsEditorStore.getState().setStatus('reading')
    expect(useHostsEditorStore.getState().status).toBe('reading')
  })

  it('setError updates error', () => {
    useHostsEditorStore.getState().setError('permission denied')
    expect(useHostsEditorStore.getState().error).toBe('permission denied')
  })

  it('setError with null clears error', () => {
    useHostsEditorStore.getState().setError('err')
    useHostsEditorStore.getState().setError(null)
    expect(useHostsEditorStore.getState().error).toBeNull()
  })

  it('setReadResult updates readResult', () => {
    const r = { headerComment: '# comment', entries: [makeEntry()] }
    useHostsEditorStore.getState().setReadResult(r)
    expect(useHostsEditorStore.getState().readResult).toEqual(r)
  })

  it('setWriteResult updates writeResult', () => {
    useHostsEditorStore.getState().setWriteResult({ success: true })
    expect(useHostsEditorStore.getState().writeResult).toEqual({ success: true })
  })

  it('setFlushResult updates flushResult', () => {
    useHostsEditorStore.getState().setFlushResult({ success: false, error: 'failed' })
    expect(useHostsEditorStore.getState().flushResult).toEqual({ success: false, error: 'failed' })
  })

  it('setOriginal stores original entries and header comment', () => {
    useHostsEditorStore.getState().setOriginal([makeEntry({ id: 'orig' })], '# original')
    expect(useHostsEditorStore.getState().originalEntries).toEqual([makeEntry({ id: 'orig' })])
    expect(useHostsEditorStore.getState().originalHeaderComment).toBe('# original')
  })

  it('revert restores entries and header from originals', () => {
    useHostsEditorStore.getState().setOriginal([makeEntry({ id: '1', hostname: 'original.local' })], '# orig')
    useHostsEditorStore.getState().setEntries([makeEntry({ id: '2', hostname: 'modified.local' })])
    useHostsEditorStore.getState().setHeaderComment('# modified')
    useHostsEditorStore.getState().revert()
    const s = useHostsEditorStore.getState()
    expect(s.entries[0]!.hostname).toBe('original.local')
    expect(s.headerComment).toBe('# orig')
  })

  it('toggleEntry toggles enabled state', () => {
    useHostsEditorStore.getState().setEntries([makeEntry({ id: '1', enabled: true })])
    useHostsEditorStore.getState().toggleEntry('1')
    expect(useHostsEditorStore.getState().entries[0]!.enabled).toBe(false)
    useHostsEditorStore.getState().toggleEntry('1')
    expect(useHostsEditorStore.getState().entries[0]!.enabled).toBe(true)
  })

  it('updateEntry updates specific fields', () => {
    useHostsEditorStore.getState().setEntries([makeEntry({ id: '1', ip: '0.0.0.0' })])
    useHostsEditorStore.getState().updateEntry('1', { ip: '192.168.1.1', comment: 'updated' })
    const entry = useHostsEditorStore.getState().entries[0]!
    expect(entry.ip).toBe('192.168.1.1')
    expect(entry.comment).toBe('updated')
    expect(entry.hostname).toBe('localhost')
  })

  it('addEntry appends a new blank entry', () => {
    useHostsEditorStore.getState().addEntry()
    const entries = useHostsEditorStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]!.ip).toBe('')
    expect(entries[0]!.hostname).toBe('')
    expect(entries[0]!.comment).toBe('')
    expect(entries[0]!.enabled).toBe(true)
    expect(entries[0]!.id).toBeTruthy()
  })

  it('setBulkEntries adds unique entries by hostname', () => {
    useHostsEditorStore.getState().setEntries([makeEntry({ id: '1', hostname: 'existing.local' })])
    useHostsEditorStore
      .getState()
      .setBulkEntries([
        makeEntry({ id: 'new1', hostname: 'existing.local' }),
        makeEntry({ id: 'new2', hostname: 'new.local' }),
      ])
    const hostnames = useHostsEditorStore.getState().entries.map((e) => e.hostname)
    expect(hostnames).toContain('existing.local')
    expect(hostnames).toContain('new.local')
    expect(hostnames).toHaveLength(2)
  })

  it('setBulkEntries does nothing when all are duplicates', () => {
    useHostsEditorStore.getState().setEntries([makeEntry({ id: '1', hostname: 'only.local' })])
    useHostsEditorStore.getState().setBulkEntries([makeEntry({ id: '2', hostname: 'only.local' })])
    expect(useHostsEditorStore.getState().entries).toHaveLength(1)
  })

  it('removeEntry removes entry by id', () => {
    useHostsEditorStore.getState().setEntries([makeEntry({ id: '1' }), makeEntry({ id: '2' })])
    useHostsEditorStore.getState().removeEntry('1')
    expect(useHostsEditorStore.getState().entries).toHaveLength(1)
    expect(useHostsEditorStore.getState().entries[0]!.id).toBe('2')
  })

  it('reset restores initial state', () => {
    useHostsEditorStore.getState().setEntries([makeEntry()])
    useHostsEditorStore.getState().setStatus('writing')
    useHostsEditorStore.getState().reset()
    const s = useHostsEditorStore.getState()
    expect(s.entries).toEqual([])
    expect(s.headerComment).toBe('')
    expect(s.status).toBe('idle')
    expect(s.error).toBeNull()
    expect(s.readResult).toBeNull()
    expect(s.writeResult).toBeNull()
    expect(s.flushResult).toBeNull()
  })
})
