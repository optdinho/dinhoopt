// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockRefCurrent: unknown

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: (initialValue: unknown) => {
      if (mockRefCurrent !== undefined) {
        const result = { current: mockRefCurrent }
        mockRefCurrent = undefined
        return result
      }
      return actual.useRef(initialValue)
    },
  }
})

const mockUpdaterStore = {
  hasChecked: false,
  loading: false,
  setLoading: vi.fn(),
  setApps: vi.fn(),
  setPackageManagerAvailable: vi.fn(),
  setPackageManagerName: vi.fn(),
  setHasChecked: vi.fn(),
  loadIgnoredIds: vi.fn(),
  getState: vi.fn(),
}

const mockDriverStore = {
  hasScanned: false,
  updateScanning: false,
  setUpdateScanning: vi.fn(),
  setUpdates: vi.fn(),
  setUpdateProgress: vi.fn(),
  getState: vi.fn(),
}

mockUpdaterStore.getState.mockReturnValue(mockUpdaterStore)
mockDriverStore.getState.mockReturnValue(mockDriverStore)

vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: { getState: () => mockUpdaterStore },
}))

vi.mock('@/stores/driver-store', () => ({
  useDriverStore: { getState: () => mockDriverStore },
}))

import { useBackgroundScans } from './useBackgroundScans'

describe('useBackgroundScans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdaterStore.hasChecked = false
    mockUpdaterStore.loading = false
    mockDriverStore.hasScanned = false
    mockDriverStore.updateScanning = false

    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not run scans immediately', () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
      softwareUpdateCheck: vi.fn(),
      driverUpdateScan: vi.fn(),
    } as never

    renderHook(() => useBackgroundScans())

    expect(window.dinho.settingsGet).not.toHaveBeenCalled()
    expect(window.dinho.softwareUpdateCheck).not.toHaveBeenCalled()
    expect(window.dinho.driverUpdateScan).not.toHaveBeenCalled()
  })

  it('runs scans after 8 seconds', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: ['ignored-id'] }),
      softwareUpdateCheck: vi.fn().mockResolvedValue({
        apps: [{ id: 'app1', name: 'App 1' }],
        packageManagerAvailable: true,
        packageManagerName: 'winget',
      }),
      driverUpdateScan: vi.fn().mockResolvedValue({
        updates: [{ updateId: 'drv1', name: 'Driver 1' }],
      }),
    } as never

    renderHook(() => useBackgroundScans())

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.settingsGet).toHaveBeenCalledTimes(1)
    expect(mockUpdaterStore.loadIgnoredIds).toHaveBeenCalledWith(['ignored-id'])
    expect(window.dinho.softwareUpdateCheck).toHaveBeenCalledTimes(1)
    expect(mockUpdaterStore.setApps).toHaveBeenCalled()
    expect(mockUpdaterStore.setPackageManagerAvailable).toHaveBeenCalledWith(true)
    expect(mockUpdaterStore.setPackageManagerName).toHaveBeenCalledWith('winget')
    expect(mockUpdaterStore.setHasChecked).toHaveBeenCalledWith(true)

    expect(window.dinho.driverUpdateScan).toHaveBeenCalledTimes(1)
    expect(mockDriverStore.setUpdates).toHaveBeenCalled()
  })

  it('does not run if already checked', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
      softwareUpdateCheck: vi.fn(),
      driverUpdateScan: vi.fn(),
    } as never

    mockUpdaterStore.hasChecked = true

    renderHook(() => useBackgroundScans())

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.softwareUpdateCheck).not.toHaveBeenCalled()
  })

  it('does not run if store is loading', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
      softwareUpdateCheck: vi.fn(),
      driverUpdateScan: vi.fn(),
    } as never

    mockUpdaterStore.loading = true

    renderHook(() => useBackgroundScans())

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.softwareUpdateCheck).not.toHaveBeenCalled()
  })

  it('does not run if already scanned drivers', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
      softwareUpdateCheck: vi.fn().mockResolvedValue({
        apps: [],
        packageManagerAvailable: false,
        packageManagerName: null,
      }),
      driverUpdateScan: vi.fn(),
    } as never

    mockDriverStore.hasScanned = true

    renderHook(() => useBackgroundScans())

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.driverUpdateScan).not.toHaveBeenCalled()
  })

  it('silently handles errors', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockRejectedValue(new Error('settings error')),
      softwareUpdateCheck: vi.fn().mockRejectedValue(new Error('update error')),
      driverUpdateScan: vi.fn().mockRejectedValue(new Error('driver error')),
    } as never

    expect(() => {
      renderHook(() => useBackgroundScans())
    }).not.toThrow()

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.settingsGet).toHaveBeenCalled()
    expect(window.dinho.softwareUpdateCheck).toHaveBeenCalled()
    expect(window.dinho.driverUpdateScan).toHaveBeenCalled()
  })

  it('only runs once (ran ref guard)', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
      softwareUpdateCheck: vi.fn().mockResolvedValue({
        apps: [],
        packageManagerAvailable: false,
        packageManagerName: null,
      }),
      driverUpdateScan: vi.fn().mockResolvedValue({ updates: [] }),
    } as never

    const { rerender } = renderHook(() => useBackgroundScans())

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.softwareUpdateCheck).toHaveBeenCalledTimes(1)

    rerender()

    expect(window.dinho.softwareUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it('skips scan via ran guard when effect re-runs', async () => {
    vi.spyOn(await import('react'), 'useRef').mockReturnValueOnce({ current: true })

    window.dinho = {
      settingsGet: vi.fn(),
      softwareUpdateCheck: vi.fn(),
      driverUpdateScan: vi.fn(),
    } as never

    renderHook(() => useBackgroundScans())

    await vi.advanceTimersByTimeAsync(8000)

    expect(window.dinho.settingsGet).not.toHaveBeenCalled()
    expect(window.dinho.softwareUpdateCheck).not.toHaveBeenCalled()
    expect(window.dinho.driverUpdateScan).not.toHaveBeenCalled()
  })
})
