import type { StopedStatusResult } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStopedStore } from './stoped-store'

const statusResult: StopedStatusResult = {
  services: [
    { id: 'PcaSvc', name: 'PcaSvc', running: true, startType: 'Automatic', found: true },
    { id: 'DPS', name: 'DPS', running: false, startType: 'Disabled', found: true },
    { id: 'DiagTrack', name: 'DiagTrack', running: true, startType: 'Automatic', found: true },
    { id: 'SysMain', name: 'SysMain', running: true, startType: 'Automatic', found: true },
    { id: 'EventLog', name: 'EventLog', running: true, startType: 'Automatic', found: true },
    { id: 'ADPSvc', name: 'ADPSvc', running: true, startType: 'Automatic', found: true },
    { id: 'UmRdpService', name: 'UmRdpService', running: false, startType: 'Manual', found: false },
  ],
  runningCount: 5,
  stoppedCount: 1,
  missingCount: 1,
}

const mocks = vi.hoisted(() => ({
  stopedServicesStatus: vi.fn(),
  stopedServicesSet: vi.fn(),
  stopedServicesSetAll: vi.fn(),
}))

beforeEach(() => {
  vi.stubGlobal('window', { dinho: mocks })
  useStopedStore.setState({
    services: [],
    runningCount: 0,
    stoppedCount: 0,
    missingCount: 0,
    loading: false,
    changing: false,
    error: null,
    lastResult: null,
    loaded: false,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stoped-store', () => {
  it('starts empty and idle', () => {
    const s = useStopedStore.getState()
    expect(s.services).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.changing).toBe(false)
    expect(s.error).toBeNull()
    expect(s.lastResult).toBeNull()
    expect(s.loaded).toBe(false)
  })

  it('load populates services and counts', async () => {
    mocks.stopedServicesStatus.mockResolvedValue(statusResult)
    await useStopedStore.getState().load()
    const s = useStopedStore.getState()
    expect(s.services).toHaveLength(7)
    expect(s.runningCount).toBe(5)
    expect(s.stoppedCount).toBe(1)
    expect(s.missingCount).toBe(1)
    expect(s.loading).toBe(false)
    expect(s.loaded).toBe(true)
  })

  it('load sets loading while in flight', async () => {
    let resolve: (v: StopedStatusResult) => void = () => {}
    mocks.stopedServicesStatus.mockReturnValue(
      new Promise<StopedStatusResult>((r) => {
        resolve = r
      }),
    )
    const promise = useStopedStore.getState().load()
    expect(useStopedStore.getState().loading).toBe(true)
    resolve(statusResult)
    await promise
    expect(useStopedStore.getState().loading).toBe(false)
  })

  it('load records an error message when the IPC call rejects', async () => {
    mocks.stopedServicesStatus.mockRejectedValue(new Error('ipc down'))
    await useStopedStore.getState().load()
    expect(useStopedStore.getState().error).toBe('ipc down')
    expect(useStopedStore.getState().loading).toBe(false)
  })

  it('load clears a previous error on the next attempt', async () => {
    useStopedStore.setState({ error: 'stale' })
    mocks.stopedServicesStatus.mockResolvedValue(statusResult)
    await useStopedStore.getState().load()
    expect(useStopedStore.getState().error).toBeNull()
  })

  it('setService calls the IPC with the id and flag, then refreshes status', async () => {
    mocks.stopedServicesSet.mockResolvedValue({
      success: true,
      changed: ['DPS'],
      failed: [],
      rebootRequired: true,
    })
    mocks.stopedServicesStatus.mockResolvedValue(statusResult)
    const result = await useStopedStore.getState().setService('DPS', true)
    expect(mocks.stopedServicesSet).toHaveBeenCalledWith('DPS', true)
    expect(mocks.stopedServicesStatus).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(useStopedStore.getState().lastResult?.rebootRequired).toBe(true)
  })

  it('setService clears changing even on failure', async () => {
    mocks.stopedServicesSet.mockResolvedValue({
      success: false,
      error: 'Access is denied',
      changed: [],
      failed: [{ id: 'DPS', error: 'Access is denied' }],
      rebootRequired: false,
    })
    mocks.stopedServicesStatus.mockResolvedValue(statusResult)
    const result = await useStopedStore.getState().setService('DPS', false)
    expect(result.success).toBe(false)
    expect(useStopedStore.getState().changing).toBe(false)
  })

  it('setService converts a thrown IPC error into a failed result', async () => {
    mocks.stopedServicesSet.mockRejectedValue(new Error('pipe closed'))
    const result = await useStopedStore.getState().setService('PcaSvc', true)
    expect(result).toEqual({
      success: false,
      error: 'pipe closed',
      changed: [],
      failed: [],
      rebootRequired: false,
    })
    expect(useStopedStore.getState().error).toBe('pipe closed')
    expect(useStopedStore.getState().changing).toBe(false)
  })

  it('setAll calls the bulk IPC with true', async () => {
    mocks.stopedServicesSetAll.mockResolvedValue({
      success: true,
      changed: ['PcaSvc', 'DPS', 'DiagTrack', 'SysMain', 'EventLog', 'ADPSvc', 'UmRdpService'],
      failed: [],
      rebootRequired: true,
    })
    mocks.stopedServicesStatus.mockResolvedValue(statusResult)
    const result = await useStopedStore.getState().setAll(true)
    expect(mocks.stopedServicesSetAll).toHaveBeenCalledWith(true)
    expect(result.changed).toHaveLength(7)
  })

  it('setAll calls the bulk IPC with false', async () => {
    mocks.stopedServicesSetAll.mockResolvedValue({
      success: true,
      changed: ['PcaSvc'],
      failed: [],
      rebootRequired: true,
    })
    mocks.stopedServicesStatus.mockResolvedValue(statusResult)
    await useStopedStore.getState().setAll(false)
    expect(mocks.stopedServicesSetAll).toHaveBeenCalledWith(false)
  })

  it('setAll converts a thrown IPC error into a failed result', async () => {
    mocks.stopedServicesSetAll.mockRejectedValue(new Error('nope'))
    const result = await useStopedStore.getState().setAll(true)
    expect(result.success).toBe(false)
    expect(result.error).toBe('nope')
    expect(useStopedStore.getState().changing).toBe(false)
  })

  it('clearError and clearLastResult reset their fields', async () => {
    useStopedStore.setState({
      error: 'x',
      lastResult: { success: true, changed: ['DPS'], failed: [], rebootRequired: true },
    })
    useStopedStore.getState().clearError()
    useStopedStore.getState().clearLastResult()
    expect(useStopedStore.getState().error).toBeNull()
    expect(useStopedStore.getState().lastResult).toBeNull()
  })
})
