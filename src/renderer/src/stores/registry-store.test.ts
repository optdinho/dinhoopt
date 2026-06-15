import type { RegistryEntry } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRegistryStore } from './registry-store'

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'entry-1',
    type: 'broken',
    keyPath: 'HKCR\\.xyz',
    valueName: '',
    issue: 'Broken file association',
    risk: 'low' as const,
    selected: false,
    ...overrides,
  }
}

function mockKudu() {
  const mock = {
    registryScan: vi.fn(),
    registryFix: vi.fn(),
    registryScanCancel: vi.fn(),
    registryFixCancel: vi.fn(),
    registrySetTweakIgnored: vi.fn(() => Promise.resolve()),
    onRegistryFixProgress: vi.fn(() => vi.fn()),
  }
  if (typeof window === 'undefined') {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ;(globalThis as any).window = {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  ;(window as any).dinho = mock
  return mock
}

describe('registry-store', () => {
  beforeEach(() => {
    useRegistryStore.getState().reset()
  })

  it('starts in clean state', () => {
    const state = useRegistryStore.getState()
    expect(state.entries).toEqual([])
    expect(state.scanning).toBe(false)
    expect(state.scanned).toBe(false)
    expect(state.fixing).toBe(false)
    expect(state.fixResult).toBeNull()
    expect(state.error).toBeNull()
  })

  it('setEntries stores entries', () => {
    const entries = [makeEntry({ id: '1' }), makeEntry({ id: '2' })]
    useRegistryStore.getState().setEntries(entries)
    expect(useRegistryStore.getState().entries).toHaveLength(2)
  })

  it('toggleEntry flips selected on specific entry', () => {
    useRegistryStore
      .getState()
      .setEntries([makeEntry({ id: '1', selected: false }), makeEntry({ id: '2', selected: false })])

    useRegistryStore.getState().toggleEntry('1')
    const entries = useRegistryStore.getState().entries
    expect(entries[0]!.selected).toBe(true)
    expect(entries[1]!.selected).toBe(false)
  })

  it('toggleEntry can toggle back off', () => {
    useRegistryStore.getState().setEntries([makeEntry({ id: '1', selected: true })])
    useRegistryStore.getState().toggleEntry('1')
    expect(useRegistryStore.getState().entries[0]!.selected).toBe(false)
  })

  it('toggleCardAll selects all entries of given types when not all selected', () => {
    useRegistryStore
      .getState()
      .setEntries([
        makeEntry({ id: '1', type: 'broken', selected: false }),
        makeEntry({ id: '2', type: 'broken', selected: true }),
        makeEntry({ id: '3', type: 'invalid', selected: false }),
      ])

    useRegistryStore.getState().toggleCardAll(['broken'])

    const entries = useRegistryStore.getState().entries
    expect(entries[0]!.selected).toBe(true) // toggled on
    expect(entries[1]!.selected).toBe(true) // stayed on
    expect(entries[2]!.selected).toBe(false) // different type, unchanged
  })

  it('toggleCardAll deselects all when all are already selected', () => {
    useRegistryStore
      .getState()
      .setEntries([
        makeEntry({ id: '1', type: 'broken', selected: true }),
        makeEntry({ id: '2', type: 'broken', selected: true }),
      ])

    useRegistryStore.getState().toggleCardAll(['broken'])

    const entries = useRegistryStore.getState().entries
    expect(entries[0]!.selected).toBe(false)
    expect(entries[1]!.selected).toBe(false)
  })

  it('toggleCardAll works with multiple types', () => {
    useRegistryStore
      .getState()
      .setEntries([
        makeEntry({ id: '1', type: 'broken', selected: false }),
        makeEntry({ id: '2', type: 'invalid', selected: false }),
        makeEntry({ id: '3', type: 'orphaned', selected: false }),
      ])

    useRegistryStore.getState().toggleCardAll(['broken', 'invalid'])

    const entries = useRegistryStore.getState().entries
    expect(entries[0]!.selected).toBe(true)
    expect(entries[1]!.selected).toBe(true)
    expect(entries[2]!.selected).toBe(false) // orphan_key not in types
  })

  it('toggleCardExpand toggles card expansion', () => {
    useRegistryStore.getState().toggleCardExpand(0)
    expect(useRegistryStore.getState().expandedCards.has(0)).toBe(true)

    useRegistryStore.getState().toggleCardExpand(0)
    expect(useRegistryStore.getState().expandedCards.has(0)).toBe(false)
  })

  it('setFixResult stores fix result', () => {
    const result = { fixed: 5, failed: 1, failures: [{ issue: 'x', reason: 'y' }] }
    useRegistryStore.getState().setFixResult(result)
    expect(useRegistryStore.getState().fixResult).toEqual(result)
  })

  it('setFixProgress tracks fix progress', () => {
    useRegistryStore.getState().setFixProgress({ current: 3, total: 10, currentEntry: 'HKCR\\.xyz' })
    expect(useRegistryStore.getState().fixProgress).toEqual({ current: 3, total: 10, currentEntry: 'HKCR\\.xyz' })
  })

  it('reset clears all state', () => {
    useRegistryStore.getState().setEntries([makeEntry()])
    useRegistryStore.getState().setScanning(true)
    useRegistryStore.getState().setError('err')

    useRegistryStore.getState().reset()

    const state = useRegistryStore.getState()
    expect(state.entries).toEqual([])
    expect(state.scanning).toBe(false)
    expect(state.error).toBeNull()
    expect(state.fixResult).toBeNull()
  })

  it('setFixing updates fixing flag', () => {
    useRegistryStore.getState().setFixing(true)
    expect(useRegistryStore.getState().fixing).toBe(true)
  })

  it('setScanned updates scanned flag', () => {
    useRegistryStore.getState().setScanned(true)
    expect(useRegistryStore.getState().scanned).toBe(true)
  })

  it('setShowFailures updates showFailures flag', () => {
    useRegistryStore.getState().setShowFailures(true)
    expect(useRegistryStore.getState().showFailures).toBe(true)

    useRegistryStore.getState().setShowFailures(false)
    expect(useRegistryStore.getState().showFailures).toBe(false)
  })

  it('toggleEntry does nothing for unknown id', () => {
    useRegistryStore.getState().setEntries([makeEntry({ id: '1' })])
    useRegistryStore.getState().toggleEntry('unknown')
    expect(useRegistryStore.getState().entries[0]!.selected).toBe(false)
  })

  describe('async actions', () => {
    it('scan calls kudu.registryScan and stores entries', async () => {
      const kudu = mockKudu()
      kudu.registryScan.mockResolvedValue([{ id: 'r1', type: 'broken' }])
      const store = useRegistryStore.getState()

      await store.scan()

      expect(kudu.registryScan).toHaveBeenCalled()
      expect(useRegistryStore.getState().scanning).toBe(false)
      expect(useRegistryStore.getState().scanned).toBe(true)
      expect(useRegistryStore.getState().entries).toHaveLength(1)
    })

    it('scan handles non-array result', async () => {
      const kudu = mockKudu()
      kudu.registryScan.mockResolvedValue(null)
      const store = useRegistryStore.getState()

      await store.scan()

      expect(useRegistryStore.getState().entries).toEqual([])
      expect(useRegistryStore.getState().scanned).toBe(true)
    })

    it('scan sets scanning false on error', async () => {
      const kudu = mockKudu()
      kudu.registryScan.mockRejectedValue(new Error('fail'))
      const store = useRegistryStore.getState()

      await store.scan()

      expect(useRegistryStore.getState().scanning).toBe(false)
    })

    it('fix skips when entryIds is empty', async () => {
      const kudu = mockKudu()
      const store = useRegistryStore.getState()

      await store.fix([])

      expect(kudu.registryFix).not.toHaveBeenCalled()
    })

    it('fix calls kudu.registryFix and removes fixed entries', async () => {
      const kudu = mockKudu()
      kudu.registryFix.mockResolvedValue({ fixed: 2, failed: 0, failures: [] })
      const store = useRegistryStore.getState()
      store.setEntries([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })])

      await store.fix(['a'])

      expect(kudu.onRegistryFixProgress).toHaveBeenCalled()
      expect(kudu.registryFix).toHaveBeenCalledWith(['a'])
      expect(useRegistryStore.getState().fixing).toBe(false)
      expect(useRegistryStore.getState().fixResult).toEqual({ fixed: 2, failed: 0, failures: [] })
      expect(useRegistryStore.getState().entries).toHaveLength(1)
    })

    it('fix sets fixing false on error', async () => {
      const kudu = mockKudu()
      kudu.registryFix.mockRejectedValue(new Error('fail'))
      const store = useRegistryStore.getState()
      store.setEntries([makeEntry({ id: 'a' })])

      await store.fix(['a'])

      expect(useRegistryStore.getState().fixing).toBe(false)
    })

    it('cancelScan calls kudu.registryScanCancel and sets scanning false', async () => {
      const kudu = mockKudu()
      kudu.registryScanCancel.mockResolvedValue(undefined)
      const store = useRegistryStore.getState()

      await store.cancelScan()

      expect(kudu.registryScanCancel).toHaveBeenCalled()
      expect(useRegistryStore.getState().scanning).toBe(false)
    })

    it('cancelScan ignores error', async () => {
      const kudu = mockKudu()
      kudu.registryScanCancel.mockRejectedValue(new Error('fail'))
      const store = useRegistryStore.getState()

      await store.cancelScan()

      expect(useRegistryStore.getState().scanning).toBe(false)
    })

    it('cancelFix calls kudu.registryFixCancel and sets fixing false', async () => {
      const kudu = mockKudu()
      kudu.registryFixCancel.mockResolvedValue(undefined)
      const store = useRegistryStore.getState()

      await store.cancelFix()

      expect(kudu.registryFixCancel).toHaveBeenCalled()
      expect(useRegistryStore.getState().fixing).toBe(false)
      expect(useRegistryStore.getState().fixProgress).toBeNull()
    })

    it('cancelFix ignores error', async () => {
      const kudu = mockKudu()
      kudu.registryFixCancel.mockRejectedValue(new Error('fail'))
      const store = useRegistryStore.getState()

      await store.cancelFix()

      expect(useRegistryStore.getState().fixing).toBe(false)
    })
  })
})
