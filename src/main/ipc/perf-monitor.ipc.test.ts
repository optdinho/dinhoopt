import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  // biome-ignore lint/complexity/useArrowFunction: called with `new`
  perfMonitorService: vi.fn(function () {
    return mocks.mockService
  }),
  mockService: {
    getSystemInfo: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    getProcessName: vi.fn(),
    killProcess: vi.fn(),
    getDiskHealth: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
  BrowserWindow: vi.fn(),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../services/perf-monitor', () => ({
  PerfMonitorService: mocks.perfMonitorService,
}))

import { registerPerfMonitorIpc } from './perf-monitor.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerPerfMonitorIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset CPU sampling between tests
    vi.resetModules()
  })

  it('registers 6 IPC handlers + extra registered handlers', () => {
    registerPerfMonitorIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0]!)
    expect(channels).toContain('perf:quick-stats')
    expect(channels).toContain('perf:system-info')
    expect(channels).toContain('perf:start')
    expect(channels).toContain('perf:stop')
    expect(channels).toContain('perf:kill')
    expect(channels).toContain('perf:disk-health')
  })

  describe('PERF_QUICK_STATS handler', () => {
    it('returns CPU and memory stats', () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:quick-stats')
      const result = handler() as {
        cpuPercent: number
        memUsedBytes: number
        memTotalBytes: number
        memPercent: number
      }
      expect(result).toHaveProperty('cpuPercent')
      expect(result).toHaveProperty('memUsedBytes')
      expect(result).toHaveProperty('memTotalBytes')
      expect(result).toHaveProperty('memPercent')
      expect(typeof result.cpuPercent).toBe('number')
      expect(typeof result.memPercent).toBe('number')
    })
  })

  describe('PERF_GET_SYSTEM_INFO handler', () => {
    it('returns system info from service', () => {
      const mockInfo = { os: 'Windows', cpu: 'Intel', cores: 8 }
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn().mockReturnValue(mockInfo),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:system-info')
      const result = handler()
      expect(result).toEqual(mockInfo)
    })
  })

  describe('PERF_START_MONITORING handler', () => {
    it('starts monitoring on the sender', () => {
      const mockStart = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: mockStart,
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
        }
      })
      const sender = { id: 1 }
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      registerPerfMonitorIpc(() => ({ id: 1, on: vi.fn(), webContents: { isDestroyed: () => false } }) as any)
      const handler = getHandler('perf:start')
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      handler({ sender } as any)
      expect(mockStart).toHaveBeenCalledWith(sender)
    })
  })

  describe('PERF_STOP_MONITORING handler', () => {
    it('stops monitoring', () => {
      const mockStop = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: mockStop,
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:stop')
      handler()
      expect(mockStop).toHaveBeenCalledOnce()
    })
  })

  describe('PERF_KILL_PROCESS handler', () => {
    it('rejects invalid PID types', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, -1) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
    })

    it('rejects PID 0', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 0) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid process ID')
    })

    it('rejects PID 4', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 4) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
    })

    it('rejects own PID', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, process.pid) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
    })

    it('blocks protected process names', async () => {
      const mockGetProcessName = vi.fn().mockResolvedValue('csrss.exe')
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: mockGetProcessName,
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 123) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
      expect(result.error).toContain('protected system process')
    })

    it('kills process and returns success', async () => {
      const mockKill = vi.fn().mockResolvedValue({ success: true })
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn().mockResolvedValue('notepad.exe'),
          killProcess: mockKill,
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 456) as { success: boolean })
      expect(mockKill).toHaveBeenCalledWith(456)
      expect(result.success).toBe(true)
    })

    it('returns failure when kill fails', async () => {
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn().mockResolvedValue('notepad.exe'),
          killProcess: vi.fn().mockResolvedValue({ success: false, error: 'Access denied' }),
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 789) as { success: boolean })
      expect(result.success).toBe(false)
    })
  })

  describe('PERF_DISK_HEALTH handler', () => {
    it('returns disk health from service', () => {
      const mockHealth = [{ drive: 'C:', status: 'OK' }]
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn().mockReturnValue(mockHealth),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:disk-health')
      const result = handler() as typeof mockHealth
      expect(result).toEqual(mockHealth)
    })
  })
})
