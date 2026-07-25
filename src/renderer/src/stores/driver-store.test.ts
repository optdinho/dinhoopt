import type { DriverPackage, DriverUpdate } from '@shared/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockKudu } from '../../../test-utils'
import { useDriverStore } from './driver-store'

function makePackage(id: string, isCurrent: boolean, selected = false): DriverPackage {
  return {
    id,
    publishedName: `${id}.inf`,
    originalName: `${id}.inf`,
    provider: 'Test',
    className: 'Display',
    version: '1.0.0',
    date: '2025-01-01',
    signer: 'Test Corp',
    folderPath: `C:\\drivers\\${id}`,
    size: 1024,
    isCurrent,
    selected,
  }
}

function makeUpdate(id: string, selected = false): DriverUpdate {
  return {
    id,
    updateId: `update-${id}`,
    deviceName: `Device ${id}`,
    deviceId: `dev-${id}`,
    className: 'Display',
    currentVersion: '1.0',
    currentDate: '2025-01-01',
    availableVersion: '2.0',
    availableDate: '2025-06-01',
    provider: 'Test',
    updateTitle: `Update ${id}`,
    downloadSize: '10 MB',
    selected,
  }
}

describe('driver-store', () => {
  beforeEach(() => {
    useDriverStore.getState().reset()
  })

  describe('cleanup', () => {
    it('togglePackage only toggles stale drivers (not current)', () => {
      useDriverStore.getState().setPackages([makePackage('stale', false), makePackage('current', true)])
      useDriverStore.getState().togglePackage('stale')
      useDriverStore.getState().togglePackage('current')
      const pkgs = useDriverStore.getState().packages
      expect(pkgs.find((p) => p.id === 'stale')!.selected).toBe(true)
      expect(pkgs.find((p) => p.id === 'current')!.selected).toBe(false) // protected
    })

    it('selectAllStale selects only non-current packages', () => {
      useDriverStore
        .getState()
        .setPackages([makePackage('stale1', false), makePackage('stale2', false), makePackage('current', true)])
      useDriverStore.getState().selectAllStale()
      const pkgs = useDriverStore.getState().packages
      expect(pkgs.filter((p) => p.selected)).toHaveLength(2)
      expect(pkgs.find((p) => p.id === 'current')!.selected).toBe(false)
    })

    it('deselectAllStale deselects stale packages', () => {
      useDriverStore.getState().setPackages([makePackage('stale', false, true), makePackage('current', true, true)])
      useDriverStore.getState().deselectAllStale()
      const pkgs = useDriverStore.getState().packages
      expect(pkgs.find((p) => p.id === 'stale')!.selected).toBe(false)
      expect(pkgs.find((p) => p.id === 'current')!.selected).toBe(true) // untouched
    })
  })

  describe('state setters', () => {
    it('setScanning updates scanning flag', () => {
      useDriverStore.getState().setScanning(true)
      expect(useDriverStore.getState().scanning).toBe(true)
      useDriverStore.getState().setScanning(false)
      expect(useDriverStore.getState().scanning).toBe(false)
    })

    it('setScanProgress stores progress', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const progress = { current: 5, total: 10, currentDriver: 'test.inf' } as any
      useDriverStore.getState().setScanProgress(progress)
      expect(useDriverStore.getState().scanProgress).toEqual(progress)
      useDriverStore.getState().setScanProgress(null)
      expect(useDriverStore.getState().scanProgress).toBeNull()
    })

    it('setCleaning updates cleaning flag', () => {
      useDriverStore.getState().setCleaning(true)
      expect(useDriverStore.getState().cleaning).toBe(true)
    })

    it('setCleanResult stores clean result', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const result = { cleaned: 3, failed: 0, errors: [] } as any
      useDriverStore.getState().setCleanResult(result)
      expect(useDriverStore.getState().cleanResult).toEqual(result)
    })

    it('setError stores error message', () => {
      useDriverStore.getState().setError('something went wrong')
      expect(useDriverStore.getState().error).toBe('something went wrong')
      useDriverStore.getState().setError(null)
      expect(useDriverStore.getState().error).toBeNull()
    })

    it('setTotalStaleSize stores size', () => {
      useDriverStore.getState().setTotalStaleSize(1048576)
      expect(useDriverStore.getState().totalStaleSize).toBe(1048576)
    })

    it('setUpdateScanning updates update scanning flag', () => {
      useDriverStore.getState().setUpdateScanning(true)
      expect(useDriverStore.getState().updateScanning).toBe(true)
    })

    it('setUpdateProgress stores update progress', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const progress = { current: 1, total: 3, currentUpdate: 'Driver X' } as any
      useDriverStore.getState().setUpdateProgress(progress)
      expect(useDriverStore.getState().updateProgress).toEqual(progress)
    })

    it('setInstalling updates installing flag', () => {
      useDriverStore.getState().setInstalling(true)
      expect(useDriverStore.getState().installing).toBe(true)
    })

    it('setInstallResult stores install result', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const result = { installed: 2, failed: 0, errors: [] } as any
      useDriverStore.getState().setInstallResult(result)
      expect(useDriverStore.getState().installResult).toEqual(result)
    })

    it('setUpdateError stores update error', () => {
      useDriverStore.getState().setUpdateError('network error')
      expect(useDriverStore.getState().updateError).toBe('network error')
    })

    it('setApplying updates applying flag', () => {
      useDriverStore.getState().setApplying(true)
      expect(useDriverStore.getState().applying).toBe(true)
    })

    it('setHasScanned updates hasScanned flag', () => {
      useDriverStore.getState().setHasScanned(true)
      expect(useDriverStore.getState().hasScanned).toBe(true)
    })
  })

  describe('updates', () => {
    it('toggleUpdate toggles selection', () => {
      useDriverStore.getState().setUpdates([makeUpdate('a'), makeUpdate('b')])
      useDriverStore.getState().toggleUpdate('a')
      const updates = useDriverStore.getState().updates
      expect(updates.find((u) => u.id === 'a')!.selected).toBe(true)
      expect(updates.find((u) => u.id === 'b')!.selected).toBe(false)
    })

    it('selectAllUpdates selects all', () => {
      useDriverStore.getState().setUpdates([makeUpdate('a'), makeUpdate('b')])
      useDriverStore.getState().selectAllUpdates()
      expect(useDriverStore.getState().updates.every((u) => u.selected)).toBe(true)
    })

    it('deselectAllUpdates deselects all', () => {
      useDriverStore.getState().setUpdates([makeUpdate('a', true), makeUpdate('b', true)])
      useDriverStore.getState().deselectAllUpdates()
      expect(useDriverStore.getState().updates.every((u) => !u.selected)).toBe(true)
    })
  })

  it('reset clears all state', () => {
    useDriverStore.getState().setPackages([makePackage('a', false)])
    useDriverStore.getState().setUpdates([makeUpdate('b')])
    useDriverStore.getState().setScanning(true)
    useDriverStore.getState().reset()
    const state = useDriverStore.getState()
    expect(state.packages).toEqual([])
    expect(state.updates).toEqual([])
    expect(state.scanning).toBe(false)
  })

  describe('async actions', () => {
    it('scan calls kudu.driverScan and stores packages', async () => {
      const kudu = mockKudu()
      kudu.driverScan!.mockResolvedValue({
        packages: [{ id: 'a', publishedName: 'a.inf', isCurrent: false, size: 1024 }],
        totalStaleSize: 1024,
      })
      const store = useDriverStore.getState()

      await store.scan()

      expect(kudu.onDriverProgress).toHaveBeenCalled()
      expect(kudu.driverScan).toHaveBeenCalled()
      expect(useDriverStore.getState().scanning).toBe(false)
      expect(useDriverStore.getState().hasScanned).toBe(true)
      expect(useDriverStore.getState().totalStaleSize).toBe(1024)
    })

    it('scan progress callback updates scanProgress state', async () => {
      const kudu = mockKudu()
      kudu.driverScan!.mockResolvedValue({ packages: [], totalStaleSize: 0 })
      const store = useDriverStore.getState()

      await store.scan()

      const progressCb = kudu.onDriverProgress!.mock.calls[0]![0]
      progressCb({ current: 5, total: 10, currentDriver: 'test.inf' })
      expect(useDriverStore.getState().scanProgress).toEqual({ current: 5, total: 10, currentDriver: 'test.inf' })
    })

    it('scan sets scanning false on error', async () => {
      const kudu = mockKudu()
      kudu.driverScan!.mockRejectedValue(new Error('fail'))
      const store = useDriverStore.getState()

      await store.scan()

      expect(useDriverStore.getState().scanning).toBe(false)
    })

    it('clean skips when no selected stale packages', async () => {
      const kudu = mockKudu()
      const store = useDriverStore.getState()
      store.setPackages([makePackage('a', false, false)]) // selected = false

      await store.clean()

      expect(kudu.driverClean!).not.toHaveBeenCalled()
    })

    it('clean calls kudu.driverClean with selected names', async () => {
      const kudu = mockKudu()
      kudu.driverClean!.mockResolvedValue({ cleaned: 2, failed: 0 })
      kudu.driverScan!.mockResolvedValue({ packages: [], totalSize: 0 })
      const store = useDriverStore.getState()
      store.setPackages([makePackage('a', false, true), makePackage('b', false, false), makePackage('c', false, true)])

      await store.clean()

      expect(kudu.driverClean!).toHaveBeenCalledWith(['a.inf', 'c.inf'])
      expect(useDriverStore.getState().cleaning).toBe(false)
    })

    it('clean sets cleaning false on error', async () => {
      const kudu = mockKudu()
      kudu.driverClean!.mockRejectedValue(new Error('fail'))
      const store = useDriverStore.getState()
      store.setPackages([makePackage('a', false, true)])

      await store.clean()

      expect(useDriverStore.getState().cleaning).toBe(false)
    })

    it('updateScan calls kudu.driverUpdateScan', async () => {
      const kudu = mockKudu()
      kudu.driverUpdateScan!.mockResolvedValue({
        updates: [{ id: 'u1', updateId: 'u1', currentVersion: '1.0', availableVersion: '2.0' }],
      })
      const store = useDriverStore.getState()

      await store.updateScan()

      expect(kudu.onDriverUpdateProgress!).toHaveBeenCalled()
      expect(kudu.driverUpdateScan!).toHaveBeenCalled()
      expect(useDriverStore.getState().updateScanning).toBe(false)
    })

    it('updateScan progress callback updates updateProgress state', async () => {
      const kudu = mockKudu()
      kudu.driverUpdateScan!.mockResolvedValue({ updates: [] })
      const store = useDriverStore.getState()

      await store.updateScan()

      const progressCb = kudu.onDriverUpdateProgress!.mock.calls[0]![0]
      progressCb({ current: 3, total: 8, currentUpdate: 'driver-x' })
      expect(useDriverStore.getState().updateProgress).toEqual({ current: 3, total: 8, currentUpdate: 'driver-x' })
    })

    it('updateScan sets updateScanning false on error', async () => {
      const kudu = mockKudu()
      kudu.driverUpdateScan!.mockRejectedValue(new Error('fail'))
      const store = useDriverStore.getState()

      await store.updateScan()

      expect(useDriverStore.getState().updateScanning).toBe(false)
    })

    it('updateInstall skips when no selected updates', async () => {
      const kudu = mockKudu()
      const store = useDriverStore.getState()
      store.setUpdates([makeUpdate('a', false)])

      await store.updateInstall()

      expect(kudu.driverUpdateInstall!).not.toHaveBeenCalled()
    })

    it('updateInstall calls kudu.driverUpdateInstall', async () => {
      const kudu = mockKudu()
      kudu.driverUpdateInstall!.mockResolvedValue({ installed: 1, failed: 0 })
      kudu.driverUpdateScan!.mockResolvedValue({ updates: [] })
      const store = useDriverStore.getState()
      store.setUpdates([makeUpdate('a', true), makeUpdate('b', false)])

      await store.updateInstall()

      expect(kudu.driverUpdateInstall!).toHaveBeenCalledWith(['update-a'])
      expect(useDriverStore.getState().installing).toBe(false)
    })

    it('updateInstall sets installing false on error', async () => {
      const kudu = mockKudu()
      kudu.driverUpdateInstall!.mockRejectedValue(new Error('fail'))
      const store = useDriverStore.getState()
      store.setUpdates([makeUpdate('a', true)])

      await store.updateInstall()

      expect(useDriverStore.getState().installing).toBe(false)
    })
  })
})
