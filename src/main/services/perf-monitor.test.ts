import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('systeminformation', () => ({
  cpu: vi.fn(),
  osInfo: vi.fn(),
  mem: vi.fn(),
  currentLoad: vi.fn(),
  disksIO: vi.fn(),
  networkStats: vi.fn(),
  processes: vi.fn(),
  time: vi.fn(() => ({ uptime: 123456 })),
  diskLayout: vi.fn(),
}))

vi.mock('./exec-utf8', () => ({
  execFileAsync: vi.fn(),
  psUtf8: (s: string) => s,
}))

import { IPC } from '@shared/channels'
import * as si from 'systeminformation'
import { execFileAsync } from './exec-utf8'
import { PerfMonitorService } from './perf-monitor'

const mockedCpu = vi.mocked(si.cpu)
const mockedOsInfo = vi.mocked(si.osInfo)
const mockedMem = vi.mocked(si.mem)
const mockedCurrentLoad = vi.mocked(si.currentLoad)
const mockedDisksIO = vi.mocked(si.disksIO)
const mockedNetworkStats = vi.mocked(si.networkStats)
const mockedProcesses = vi.mocked(si.processes)
const mockedDiskLayout = vi.mocked(si.diskLayout)
const mockedExecFileAsync = vi.mocked(execFileAsync)

function createMockSender() {
  return { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) }
}

describe('PerfMonitorService', () => {
  let service: PerfMonitorService
  // biome-ignore lint/suspicious/noExplicitAny: test
  let mockSender: any
  let origPlatform: string

  beforeEach(() => {
    vi.clearAllMocks()
    origPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    service = new PerfMonitorService()
    mockSender = createMockSender()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
  })

  describe('getSystemInfo', () => {
    it('returns system info from si.cpu, si.osInfo, and si.mem', async () => {
      mockedCpu.mockResolvedValue({
        manufacturer: 'Intel',
        brand: 'Core i7-10700K',
        physicalCores: 8,
        cores: 16,
      })
      mockedOsInfo.mockResolvedValue({
        distro: 'Windows',
        release: '10.0.19045',
        hostname: 'DESKTOP-ABC',
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      const info = await service.getSystemInfo()

      expect(info).toEqual({
        cpuModel: 'Intel Core i7-10700K',
        cpuCores: 8,
        cpuThreads: 16,
        totalMemBytes: 17179869184,
        osVersion: 'Windows 10.0.19045',
        hostname: 'DESKTOP-ABC',
      })
    })

    it('caches the result and does not call si functions again', async () => {
      mockedCpu.mockResolvedValue({
        manufacturer: 'AMD',
        brand: 'Ryzen 9 7950X',
        physicalCores: 16,
        cores: 32,
      })
      mockedOsInfo.mockResolvedValue({
        distro: 'Ubuntu',
        release: '24.04',
        hostname: 'devbox',
      })
      mockedMem.mockResolvedValue({ total: 34359738368 })

      const first = await service.getSystemInfo()
      const second = await service.getSystemInfo()

      expect(mockedCpu).toHaveBeenCalledTimes(1)
      expect(first).toBe(second)
      expect(second.cpuModel).toBe('AMD Ryzen 9 7950X')
    })
  })

  describe('startMonitoring', () => {
    it('collects initial snapshot and process list immediately', async () => {
      mockedCurrentLoad.mockResolvedValue({
        currentLoad: 45.2,
        cpus: [{ load: 40.1 }, { load: 50.3 }],
      })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 1024, wIO_sec: 2048 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 50000, tx_sec: 30000 }])
      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [
          { pid: 4, name: 'System', cpu: 0, memRss: 8192, user: 'SYSTEM', started: '' },
          { pid: 100, name: 'chrome.exe', cpu: 15, memRss: 300000000, user: 'user', started: '09:00' },
        ],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender)

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(
          IPC.PERF_SNAPSHOT,
          expect.objectContaining({
            cpu: expect.objectContaining({ overall: 45.2 }),
          }),
        )
      })

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.objectContaining({ totalCount: 2 }))
      })
    })

    it('updates sender without throwing when already running', async () => {
      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender)
      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalled()
      })

      const newSender = createMockSender()
      await expect(service.startMonitoring(newSender)).resolves.toBeUndefined()
    })

    it('correlates startup items with process list', async () => {
      const getStartupItems = vi.fn().mockResolvedValue([
        {
          id: 'steam',
          name: 'Steam',
          displayName: 'Steam Client',
          command: 'C:\\Program Files\\Steam\\steam.exe',
          location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          source: 'registry-hklm',
          enabled: true,
          publisher: 'Valve',
          impact: 'medium',
        },
      ])

      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [
          { pid: 100, name: 'steam.exe', cpu: 5, memRss: 150000000, user: 'user', started: '09:00' },
          { pid: 200, name: 'notepad.exe', cpu: 1, memRss: 10000000, user: 'user', started: '09:05' },
        ],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender, getStartupItems)

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
      })

      const processListCall = mockSender.send.mock.calls.find(([ch]: unknown[]) => ch === IPC.PERF_PROCESS_LIST) as [
        string,
        { processes: Array<{ name: string; isStartupItem: boolean }> },
      ]

      const steam = processListCall[1].processes.find((p) => p.name === 'steam.exe')
      expect(steam?.isStartupItem).toBe(true)

      const notepad = processListCall[1].processes.find((p) => p.name === 'notepad.exe')
      expect(notepad?.isStartupItem).toBeFalsy()
    })

    it('does not fail when getStartupItems callback throws', async () => {
      const getStartupItems = vi.fn().mockRejectedValue(new Error('access denied'))

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await expect(service.startMonitoring(mockSender, getStartupItems)).resolves.toBeUndefined()

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_SNAPSHOT, expect.any(Object))
      })
    })
  })

  describe('stopMonitoring', () => {
    it('can be called when not running (no-op)', () => {
      expect(() => service.stopMonitoring()).not.toThrow()
    })

    it('stops sending data after stop', async () => {
      vi.useFakeTimers()

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      expect(mockSender.send).toHaveBeenCalled()
      mockSender.send.mockClear()

      service.stopMonitoring()
      await vi.advanceTimersByTimeAsync(30000)

      expect(mockSender.send).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('getProcessName', () => {
    it('returns the process name for a valid PID', async () => {
      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [
          { pid: 100, name: 'chrome.exe', cpu: 10, memRss: 200000000, user: 'user', started: '09:00' },
          { pid: 200, name: 'notepad.exe', cpu: 1, memRss: 8000000, user: 'user', started: '09:05' },
        ],
      })

      const name = await service.getProcessName(100)
      expect(name).toBe('chrome.exe')
    })

    it('returns null for an unknown PID', async () => {
      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'chrome.exe', cpu: 10, memRss: 200000000, user: 'user', started: '' }],
      })

      const name = await service.getProcessName(999)
      expect(name).toBeNull()
    })

    it('returns null when si.processes() fails', async () => {
      mockedProcesses.mockRejectedValue(new Error('permission denied'))

      const name = await service.getProcessName(100)
      expect(name).toBeNull()
    })
  })

  describe('killProcess', () => {
    let killSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      killSpy = vi.spyOn(process, 'kill')
    })

    it('succeeds via process.kill', async () => {
      killSpy.mockImplementation(() => undefined)

      const result = await service.killProcess(1234)

      expect(result).toEqual({ success: true })
      expect(killSpy).toHaveBeenCalledWith(1234)
    })

    it('falls back to execFileAsync on Windows when process.kill fails', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockResolvedValue(undefined)

      const result = await service.killProcess(1234)

      expect(result).toEqual({ success: true })
      expect(mockedExecFileAsync).toHaveBeenCalledWith('taskkill', ['/F', '/PID', '1234'])
    })

    it('falls back to execFileAsync on non-Windows when process.kill fails', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      killSpy.mockImplementation(() => {
        throw new Error('ESRCH')
      })
      mockedExecFileAsync.mockResolvedValue(undefined)

      const result = await service.killProcess(1234)

      expect(result).toEqual({ success: true })
      expect(mockedExecFileAsync).toHaveBeenCalledWith('kill', ['-9', '1234'])
    })

    it('returns requiresAdmin error on access denied', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockRejectedValue(new Error('Access denied'))

      const result = await service.killProcess(1234)

      expect(result.success).toBe(false)
      expect(result.requiresAdmin).toBe(true)
      expect(result.error).toContain('Acesso negado')
    })

    it('returns generic error on other fallback failures', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockRejectedValue(new Error('Unknown error'))

      const result = await service.killProcess(1234)

      expect(result.success).toBe(false)
      expect(result.requiresAdmin).toBe(false)
      expect(result.error).toContain('Failed to end process')
    })

    it('handles non-Error throw from fallback', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockRejectedValue('string error')

      const result = await service.killProcess(1234)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to end process')
    })
  })

  describe('getDiskHealth', () => {
    it('returns disk health info from si.diskLayout and powershell reliability', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Samsung SSD 970 EVO',
          type: 'SSD',
          interfaceType: 'NVMe',
          size: 512110190592,
          smartStatus: 'Ok',
          temperature: 35,
        },
        {
          device: '\\\\.\\PHYSICALDRIVE1',
          name: 'WD HDD 2TB',
          type: 'HD',
          interfaceType: 'SATA',
          size: 2000398934016,
          smartStatus: 'Caution',
          temperature: 42,
        },
      ])
      mockedExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify([
          {
            DeviceId: 0,
            Temperature: 35,
            PowerOnHours: 12345,
            ReadErrorsTotal: 0,
            WriteErrorsTotal: 0,
            Wear: 5,
          },
        ]),
      })

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(2)

      expect(result[0]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\PHYSICALDRIVE0',
          model: 'Samsung SSD 970 EVO',
          type: 'NVMe',
          sizeBytes: 512110190592,
          healthStatus: 'Healthy',
          temperature: 35,
          powerOnHours: 12345,
          remainingLife: 95,
          readErrors: 0,
          writeErrors: 0,
        }),
      )

      expect(result[1]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\PHYSICALDRIVE1',
          type: 'HDD',
          healthStatus: 'Caution',
          temperature: 42,
          powerOnHours: null,
          remainingLife: null,
        }),
      )
    })

    it('maps unknown smartStatus and interfaceType correctly', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Mystery Drive',
          type: 'Unknown',
          interfaceType: 'USB',
          size: 64023257088,
          smartStatus: 'Unknown',
          temperature: null,
        },
      ])
      mockedExecFileAsync.mockResolvedValue({ stdout: '[]' })

      const result = await service.getDiskHealth()

      expect(result[0].type).toBe('Unknown')
      expect(result[0].healthStatus).toBe('Unknown')
    })

    it('returns empty array when si.diskLayout fails', async () => {
      mockedDiskLayout.mockRejectedValue(new Error('no disk info'))

      const result = await service.getDiskHealth()

      expect(result).toEqual([])
    })

    it('handles missing reliability data gracefully', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Generic SSD',
          type: 'SSD',
          interfaceType: 'SATA',
          size: 256060514304,
          smartStatus: 'Bad',
          temperature: null,
        },
      ])
      mockedExecFileAsync.mockRejectedValue(new Error('access denied'))

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({
          healthStatus: 'Bad',
          temperature: null,
          powerOnHours: null,
          remainingLife: null,
          readErrors: null,
          writeErrors: null,
        }),
      )
    })

    it('handles single-object PowerShell output (not array)', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Samsung SSD 970 EVO',
          type: 'SSD',
          interfaceType: 'NVMe',
          size: 512110190592,
          smartStatus: 'Ok',
          temperature: 35,
        },
      ])
      mockedExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          DeviceId: 0,
          Temperature: 35,
          PowerOnHours: 12345,
          ReadErrorsTotal: 0,
          WriteErrorsTotal: 0,
          Wear: 5,
        }),
      })

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\PHYSICALDRIVE0',
          temperature: 35,
          powerOnHours: 12345,
          remainingLife: 95,
        }),
      )
    })

    it('handles device path with no digits', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\C:',
          name: 'Local Disk',
          type: 'SSD',
          interfaceType: 'SATA',
          size: 512110190592,
          smartStatus: 'Ok',
          temperature: 35,
        },
      ])
      mockedExecFileAsync.mockResolvedValue({ stdout: '[]' })

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\C:',
          temperature: 35,
          powerOnHours: null,
          remainingLife: null,
        }),
      )
    })
  })

  describe('cached network stats', () => {
    it('uses cached network stats within the 5s window', async () => {
      vi.useFakeTimers()

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 20, cpus: [{ load: 20 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 512, wIO_sec: 1024 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 100000, tx_sec: 50000 }])
      mockedMem.mockResolvedValue({ total: 17179869184 })
      mockedProcesses.mockResolvedValue({ all: 1, running: 1, blocked: 0, sleeping: 0, list: [] })

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      expect(mockedNetworkStats).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)

      expect(mockedNetworkStats).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })
  })

  describe('startMonitoring (startup item edge cases)', () => {
    it('handles startup item command without .exe path', async () => {
      const getStartupItems = vi.fn().mockResolvedValue([
        {
          id: 'custom',
          name: 'Custom Launcher',
          displayName: 'Custom Launcher',
          command: 'rundll32.exe shell32.dll,Control_RunDLL',
          location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          source: 'registry-hklm',
          enabled: true,
          publisher: '',
          impact: 'medium',
        },
      ])

      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'rundll32.exe', cpu: 2, memRss: 5000000, user: 'user', started: '09:00' }],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })
      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])

      await service.startMonitoring(mockSender, getStartupItems)

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
      })

      const processListCall = mockSender.send.mock.calls.find(([ch]: unknown[]) => ch === IPC.PERF_PROCESS_LIST) as [
        string,
        { processes: Array<{ name: string; isStartupItem: boolean }> },
      ]

      const rundll32 = processListCall[1].processes.find((p) => p.name === 'rundll32.exe')
      // Command 'rundll32.exe shell32.dll,Control_RunDLL' matches regex → rundll32.exe should be found
      expect(rundll32?.isStartupItem).toBe(true)
    })

    it('handles startup item command with no exe match at all', async () => {
      const getStartupItems = vi.fn().mockResolvedValue([
        {
          id: 'nopath',
          name: 'No Path',
          displayName: 'No Path',
          command: '/usr/bin/env python',
          location: '',
          source: 'registry',
          enabled: true,
          publisher: '',
          impact: 'low',
        },
      ])

      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 50, name: 'python.exe', cpu: 5, memRss: 10000000, user: 'user', started: '09:00' }],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })
      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])

      await service.startMonitoring(mockSender, getStartupItems)

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
      })

      const processListCall = mockSender.send.mock.calls.find(([ch]: unknown[]) => ch === IPC.PERF_PROCESS_LIST) as [
        string,
        { processes: Array<{ name: string; isStartupItem: boolean }> },
      ]

      const python = processListCall[1].processes.find((p) => p.name === 'python.exe')
      // '/usr/bin/env python' has no .exe match → startupExeMap won't have it
      expect(python?.isStartupItem).toBe(false)
    })
  })

  describe('collectSnapshot re-entrant guard and error handling', () => {
    it('does not collect when snapshotRunning is true', async () => {
      vi.useFakeTimers()

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 20, cpus: [{ load: 20 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 512, wIO_sec: 1024 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 100000, tx_sec: 50000 }])
      mockedMem.mockResolvedValue({ total: 17179869184 })
      mockedProcesses.mockResolvedValue({ all: 1, running: 1, blocked: 0, sleeping: 0, list: [] })

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      // First call completed, snapshotRunning = false now
      expect(mockedCurrentLoad).toHaveBeenCalledTimes(1)
      mockSender.send.mockClear()

      // Make si.currentLoad slow to trigger re-entrant scenario
      let resolveCurrentLoad: (v: unknown) => void
      mockedCurrentLoad.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCurrentLoad = resolve
          }),
      )

      // Trigger another interval
      await vi.advanceTimersByTimeAsync(1000)
      // snapshotRunning = true now (inside collectSnapshot)

      // Try triggering again (should be blocked by re-entrant guard)
      await vi.advanceTimersByTimeAsync(1000)

      // Only one send should occur (or none if the first promise didn't resolve)
      expect(mockedCurrentLoad).toHaveBeenCalledTimes(2)

      // Resolve the hanging promise
      resolveCurrentLoad!({ currentLoad: 30, cpus: [{ load: 30 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])

      await vi.advanceTimersByTimeAsync(100)

      vi.useRealTimers()
    })

    it('handles si.currentLoad throwing an error', async () => {
      mockedCurrentLoad.mockRejectedValue(new Error('Load failed'))
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({ all: 1, running: 1, blocked: 0, sleeping: 0, list: [] })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      // Call startMonitoring to set up sender
      await service.startMonitoring(mockSender)

      // After the initial snapshot, we need to trigger another one
      // The first collectSnapshot already ran (caught error)
      await vi.waitFor(() => {
        expect(mockedCurrentLoad).toHaveBeenCalled()
      })

      // Should not throw — error is caught silently
      expect(mockSender.send).not.toHaveBeenCalledWith(IPC.PERF_SNAPSHOT, expect.any(Object))
    })

    it('handles sender destroyed after snapshot capture', async () => {
      mockSender = createMockSender()
      mockSender.isDestroyed.mockReturnValue(true)

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 50, cpus: [{ load: 50 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({ all: 1, running: 1, blocked: 0, sleeping: 0, list: [] })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      // startMonitoring will call collectSnapshot immediately
      // Since sender.isDestroyed() returns true, the first check stops monitoring
      await service.startMonitoring(mockSender)

      // The sender is destroyed, so no IPC sends should happen
      // and stopMonitoring will be called (fastTimer = null)
      expect(mockSender.send).not.toHaveBeenCalled()
    })
  })

  describe('collectProcesses re-entrant guard and error handling', () => {
    it('does not collect when processesRunning is true', async () => {
      vi.useFakeTimers()

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])

      let resolveProcesses: (v: unknown) => void
      mockedProcesses.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveProcesses = resolve
          }),
      )

      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      // First collectProcesses is running (processesRunning = true)
      // Trigger another interval cycle
      await vi.advanceTimersByTimeAsync(10000)

      // The re-entrant guard should prevent a second call
      expect(mockedProcesses).toHaveBeenCalledTimes(1)

      // Resolve the hanging promise
      resolveProcesses!({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'test.exe', cpu: 10, memRss: 10000000, user: 'user', started: '' }],
      })
      await vi.advanceTimersByTimeAsync(100)

      vi.useRealTimers()
    })

    it('handles si.processes throwing an error', async () => {
      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockRejectedValue(new Error('Process list failed'))
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await expect(service.startMonitoring(mockSender)).resolves.toBeUndefined()

      // Error is caught silently — no process list sent
      expect(mockSender.send).not.toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
    })

    it('handles sender destroyed during process collection', async () => {
      mockSender.isDestroyed.mockReturnValue(true)

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'test.exe', cpu: 10, memRss: 10000000, user: 'user', started: '' }],
      })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender)

      // Since sender is destroyed at the isDestroyed check inside collectProcesses,
      // the _slowTimer check runs first, but since it's the first call,
      // mockSender.isDestroyed() was already returning true before startMonitoring
      // So both collectSnapshot and collectProcesses stop monitoring immediately
      expect(mockSender.send).not.toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
    })
  })

  describe('stopMonitoring with slowTimer cleanup', () => {
    it('cleans up both fast and slow timers', async () => {
      vi.useFakeTimers()

      mockedCurrentLoad.mockResolvedValue({ currentLoad: 10, cpus: [{ load: 10 }] })
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 })
      mockedNetworkStats.mockResolvedValue([{ rx_sec: 0, tx_sec: 0 }])
      mockedProcesses.mockResolvedValue({ all: 1, running: 1, blocked: 0, sleeping: 0, list: [] })
      mockedMem.mockResolvedValue({ total: 17179869184 })

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      expect(mockSender.send).toHaveBeenCalled()
      mockSender.send.mockClear()

      service.stopMonitoring()
      await vi.advanceTimersByTimeAsync(30000)

      // After stop, no more sends
      expect(mockSender.send).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })
})
