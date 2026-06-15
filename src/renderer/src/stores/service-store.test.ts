import type { ServiceSafety, ServiceStartType, ServiceStatus, WindowsService } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useServiceStore } from './service-store'

function mockKudu() {
  const mock = {
    serviceScan: vi.fn(),
    serviceApply: vi.fn(),
    onServiceProgress: vi.fn(() => vi.fn()),
  }
  if (typeof window === 'undefined') {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ;(globalThis as any).window = {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  ;(window as any).dinho = mock
  return mock
}

function makeService(
  name: string,
  safety: ServiceSafety = 'safe',
  startType: ServiceStartType = 'Automatic',
  status: ServiceStatus = 'Running',
  selected = false,
): WindowsService {
  return {
    name,
    displayName: `${name} Display`,
    description: `Description for ${name}`,
    status,
    startType,
    safety,
    category: 'misc',
    isMicrosoft: true,
    dependsOn: [],
    dependents: [],
    selected,
    originalStartType: startType,
  }
}

describe('service-store', () => {
  beforeEach(() => {
    useServiceStore.getState().reset()
  })

  describe('toggleService', () => {
    it('toggles a safe service', () => {
      useServiceStore.getState().setServices([makeService('DiagTrack', 'safe')])
      useServiceStore.getState().toggleService('DiagTrack')
      expect(useServiceStore.getState().services[0]!.selected).toBe(true)
    })

    it('toggles a caution service', () => {
      useServiceStore.getState().setServices([makeService('WSearch', 'caution')])
      useServiceStore.getState().toggleService('WSearch')
      expect(useServiceStore.getState().services[0]!.selected).toBe(true)
    })

    it('does NOT toggle an unsafe service', () => {
      useServiceStore.getState().setServices([makeService('RpcSs', 'unsafe')])
      useServiceStore.getState().toggleService('RpcSs')
      expect(useServiceStore.getState().services[0]!.selected).toBe(false)
    })
  })

  describe('selectRecommended', () => {
    it('selects only safe, non-disabled services', () => {
      useServiceStore
        .getState()
        .setServices([
          makeService('DiagTrack', 'safe', 'Automatic'),
          makeService('Fax', 'safe', 'Disabled'),
          makeService('WSearch', 'caution', 'Automatic'),
          makeService('RpcSs', 'unsafe', 'Automatic'),
        ])
      useServiceStore.getState().selectRecommended()
      const services = useServiceStore.getState().services
      expect(services[0]!.selected).toBe(true) // safe + not disabled
      expect(services[1]!.selected).toBe(false) // safe but already disabled
      expect(services[2]!.selected).toBe(false) // caution
      expect(services[3]!.selected).toBe(false) // unsafe
    })
  })

  describe('deselectAll', () => {
    it('deselects all services', () => {
      useServiceStore
        .getState()
        .setServices([
          makeService('a', 'safe', 'Automatic', 'Running', true),
          makeService('b', 'caution', 'Manual', 'Stopped', true),
        ])
      useServiceStore.getState().deselectAll()
      expect(useServiceStore.getState().services.every((s) => !s.selected)).toBe(true)
    })
  })

  describe('state setters', () => {
    it('setApplying updates applying flag', () => {
      useServiceStore.getState().setApplying(true)
      expect(useServiceStore.getState().applying).toBe(true)
    })

    it('setScanProgress stores progress', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const progress = { current: 5, total: 20, currentService: 'DiagTrack' } as any
      useServiceStore.getState().setScanProgress(progress)
      expect(useServiceStore.getState().scanProgress).toEqual(progress)
    })

    it('setApplyResult stores apply result', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const result = { applied: 3, failed: 1, errors: [{ service: 'X', reason: 'access' }] } as any
      useServiceStore.getState().setApplyResult(result)
      expect(useServiceStore.getState().applyResult).toEqual(result)
    })

    it('setError stores error and clears on null', () => {
      useServiceStore.getState().setError('error occurred')
      expect(useServiceStore.getState().error).toBe('error occurred')
      useServiceStore.getState().setError(null)
      expect(useServiceStore.getState().error).toBeNull()
    })

    it('setHasScanned updates hasScanned flag', () => {
      useServiceStore.getState().setHasScanned(true)
      expect(useServiceStore.getState().hasScanned).toBe(true)
    })
  })

  describe('filters', () => {
    it('sets search query', () => {
      useServiceStore.getState().setSearchQuery('xbox')
      expect(useServiceStore.getState().searchQuery).toBe('xbox')
    })

    it('sets safety filter', () => {
      useServiceStore.getState().setSafetyFilter('safe')
      expect(useServiceStore.getState().safetyFilter).toBe('safe')
    })

    it('sets category filter', () => {
      useServiceStore.getState().setCategoryFilter('telemetry')
      expect(useServiceStore.getState().categoryFilter).toBe('telemetry')
    })

    it('sets status filter', () => {
      useServiceStore.getState().setStatusFilter('running')
      expect(useServiceStore.getState().statusFilter).toBe('running')
    })
  })

  it('reset clears all state', () => {
    useServiceStore.getState().setServices([makeService('a')])
    useServiceStore.getState().setScanning(true)
    useServiceStore.getState().setSearchQuery('test')
    useServiceStore.getState().setSafetyFilter('safe')
    useServiceStore.getState().reset()
    const state = useServiceStore.getState()
    expect(state.services).toEqual([])
    expect(state.scanning).toBe(false)
    expect(state.searchQuery).toBe('')
    expect(state.safetyFilter).toBe('all')
    expect(state.hasScanned).toBe(false)
  })

  describe('async actions', () => {
    it('scan calls kudu.serviceScan and stores services', async () => {
      const kudu = mockKudu()
      kudu.serviceScan.mockResolvedValue({
        services: [{ name: 'DiagTrack', displayName: 'Diagnostic Track' }],
      })
      const store = useServiceStore.getState()

      await store.scan()

      expect(kudu.onServiceProgress).toHaveBeenCalled()
      expect(kudu.serviceScan).toHaveBeenCalled()
      expect(useServiceStore.getState().scanning).toBe(false)
      expect(useServiceStore.getState().hasScanned).toBe(true)
      expect(useServiceStore.getState().services).toHaveLength(1)
    })

    it('scan sets scanning false on error', async () => {
      const kudu = mockKudu()
      kudu.serviceScan.mockRejectedValue(new Error('fail'))
      const store = useServiceStore.getState()

      await store.scan()

      expect(useServiceStore.getState().scanning).toBe(false)
    })

    it('apply skips when no changes', async () => {
      const kudu = mockKudu()
      const store = useServiceStore.getState()
      store.setServices([makeService('DiagTrack', 'safe', 'Automatic', 'Running', true)])

      await store.apply()

      expect(kudu.serviceApply).not.toHaveBeenCalled()
    })

    it('apply calls kudu.serviceApply with changes', async () => {
      const kudu = mockKudu()
      kudu.serviceApply.mockResolvedValue({ applied: 1, failed: 0 })
      kudu.serviceScan.mockResolvedValue({ services: [] })
      useServiceStore.getState().setServices([makeService('DiagTrack', 'safe', 'Automatic', 'Running', true)])
      const svc = useServiceStore.getState().services[0]!
      useServiceStore.getState().setServices([{ ...svc, startType: 'Disabled' }])

      await useServiceStore.getState().apply()

      expect(kudu.serviceApply).toHaveBeenCalledWith([{ name: 'DiagTrack', targetStartType: 'Disabled' }])
      expect(useServiceStore.getState().applying).toBe(false)
    })

    it('apply sets applying false on error', async () => {
      const kudu = mockKudu()
      kudu.serviceApply.mockRejectedValue(new Error('fail'))
      useServiceStore.getState().setServices([makeService('DiagTrack', 'safe', 'Automatic', 'Running', true)])
      const svc = useServiceStore.getState().services[0]!
      useServiceStore.getState().setServices([{ ...svc, startType: 'Disabled' }])

      await useServiceStore.getState().apply()

      expect(useServiceStore.getState().applying).toBe(false)
    })
  })
})
