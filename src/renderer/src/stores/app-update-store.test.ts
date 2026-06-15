import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppUpdateStore } from './app-update-store'

beforeEach(() => {
  vi.stubGlobal('window', {
    dinho: {
      updaterGetStatus: vi.fn(),
      onUpdaterStatus: vi.fn(() => vi.fn()),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useAppUpdateStore.setState({ status: { state: 'idle' } })
})

describe('app-update-store', () => {
  it('starts with idle status', () => {
    expect(useAppUpdateStore.getState().status).toEqual({ state: 'idle' })
  })

  it('setStatus updates status', () => {
    const status = { state: 'downloading' as const, progress: 50 }
    useAppUpdateStore.getState().setStatus(status)
    expect(useAppUpdateStore.getState().status).toEqual(status)
  })

  it('setStatus sets error state', () => {
    const status = { state: 'error' as const, error: 'network failed' }
    useAppUpdateStore.getState().setStatus(status)
    expect(useAppUpdateStore.getState().status).toEqual(status)
  })

  it('init fetches current status and listens for updates', async () => {
    const mockStatus = { state: 'available' as const, version: '2.0.0' }
    vi.mocked(window.dinho.updaterGetStatus).mockResolvedValue(mockStatus)
    const unsub = vi.fn()
    vi.mocked(window.dinho.onUpdaterStatus).mockReturnValue(unsub)
    const cleanup = useAppUpdateStore.getState().init()
    await new Promise((r) => setTimeout(r, 0))
    expect(window.dinho.updaterGetStatus).toHaveBeenCalled()
    expect(window.dinho.onUpdaterStatus).toHaveBeenCalled()
    expect(useAppUpdateStore.getState().status).toEqual(mockStatus)
    cleanup()
    expect(unsub).toHaveBeenCalled()
  })

  it('init handles missing window.dinho gracefully', () => {
    vi.stubGlobal('window', { dinho: undefined })
    expect(() => useAppUpdateStore.getState().init()).not.toThrow()
  })

  it('init handles missing updaterGetStatus gracefully', () => {
    vi.stubGlobal('window', { dinho: {} })
    expect(() => useAppUpdateStore.getState().init()).not.toThrow()
  })
})
