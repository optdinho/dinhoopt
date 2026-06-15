import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }))

vi.mock('./elevation', () => ({ isAdmin: vi.fn() }))
vi.mock('./exec-utf8', () => ({ psUtf8: (s: string) => s }))

import { isAdmin } from './elevation'
import { getMemoryInfo, getMemoryProcesses, optimizeMemory } from './memory-optimizer'

const mockedIsAdmin = vi.mocked(isAdmin)

function mockPsSuccess(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
      cb(null, stdout, '')
    },
  )
}

// Mock systeminformation
vi.mock('systeminformation', () => ({
  default: {
    mem: vi.fn(),
    processes: vi.fn(),
  },
  mem: vi.fn(),
  processes: vi.fn(),
}))

import * as si from 'systeminformation'
const mockedMem = vi.mocked(si.mem)
const mockedProcesses = vi.mocked(si.processes)

describe('getMemoryInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns formatted memory info', async () => {
    mockedMem.mockResolvedValue({
      total: 17179869184,
      free: 4294967296,
      used: 12884901888,
      active: 12000000000,
      available: 5000000000,
      buffers: 500000000,
      cached: 1000000000,
      slab: 0,
      buffcache: 1500000000,
      swaptotal: 0,
      swapused: 0,
      swapfree: 0,
      reclaimable: 0,
      writeback: null,
      dirty: null,
    })

    const result = await getMemoryInfo()
    expect(result.totalBytes).toBe(17179869184)
    expect(result.availableBytes).toBe(5000000000)
    expect(result.usedPercent).toBeGreaterThan(0)
    expect(result.cachedBytes).toBe(1000000000)
  })
})

describe('getMemoryProcesses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns top processes sorted by memory', async () => {
    mockedProcesses.mockResolvedValue({
      all: 3,
      running: 3,
      blocked: 0,
      sleeping: 0,
      unknown: 0,
      list: [
        {
          pid: 1,
          name: 'chrome.exe',
          memRss: 500000000,
          cpu: 5,
          mem: 0.5,
          state: 'running',
          started: '2026-01-01',
          parentPid: 0,
          command: 'chrome',
          // biome-ignore lint/suspicious/noExplicitAny: test mock
        } as any,
        {
          pid: 2,
          name: 'node.exe',
          memRss: 200000000,
          cpu: 2,
          mem: 0.2,
          state: 'running',
          started: '2026-01-01',
          parentPid: 0,
          command: 'node',
          // biome-ignore lint/suspicious/noExplicitAny: test mock
        } as any,
        {
          pid: 3,
          name: 'code.exe',
          memRss: 300000000,
          cpu: 3,
          mem: 0.3,
          state: 'running',
          started: '2026-01-01',
          parentPid: 0,
          command: 'code',
          // biome-ignore lint/suspicious/noExplicitAny: test mock
        } as any,
      ],
    })

    const result = await getMemoryProcesses(10)
    expect(result).toHaveLength(3)
    expect(result[0]!.name).toBe('chrome.exe')
    expect(result[0]!.workingSetBytes).toBe(500000000)
    expect(result[1]!.name).toBe('code.exe')
    expect(result[2]!.name).toBe('node.exe')
  })

  it('returns empty array when no processes', async () => {
    mockedProcesses.mockResolvedValue({
      all: 0,
      running: 0,
      blocked: 0,
      sleeping: 0,
      unknown: 0,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      list: [] as any,
    })

    const result = await getMemoryProcesses()
    expect(result).toEqual([])
  })
})

describe('optimizeMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function captureScripts(): string[] {
    return mockExecFile.mock.calls.map((call: unknown[]) => (call[1] as string[])[3] ?? '')
  }

  it('returns 2 steps (gc + workingset)', async () => {
    mockedIsAdmin.mockReturnValue(false)
    mockedMem.mockResolvedValue({
      total: 17179869184,
      free: 4294967296,
      used: 12884901888,
      active: 12000000000,
      available: 5000000000,
      buffers: 0,
      cached: 0,
      slab: 0,
      buffcache: 0,
      swaptotal: 0,
      swapused: 0,
      swapfree: 0,
      reclaimable: 0,
      writeback: null,
      dirty: null,
    })
    mockPsSuccess('')
    const result = await optimizeMemory()
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]!.name).toBe('gc')
    expect(result.steps[0]!.success).toBe(true)
    expect(result.steps[1]!.name).toBe('workingset')
    expect(result.steps[1]!.success).toBe(true)
  })

  it('calls progress callback twice', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockedMem.mockResolvedValue({
      total: 17179869184,
      free: 4294967296,
      used: 12884901888,
      active: 12000000000,
      available: 5000000000,
      buffers: 0,
      cached: 0,
      slab: 0,
      buffcache: 0,
      swaptotal: 0,
      swapused: 0,
      swapfree: 0,
      reclaimable: 0,
      writeback: null,
      dirty: null,
    })
    mockPsSuccess('done')
    const onProgress = vi.fn()
    await optimizeMemory(onProgress)
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      step: 1,
      totalSteps: 2,
      label: 'gc',
      detail: 'Collecting .NET garbage...',
    })
  })

  it('step 1 uses .NET GC', async () => {
    mockedIsAdmin.mockReturnValue(false)
    mockedMem.mockResolvedValue({
      total: 1,
      free: 0,
      used: 1,
      active: 1,
      available: 0,
      buffers: 0,
      cached: 0,
      slab: 0,
      buffcache: 0,
      swaptotal: 0,
      swapused: 0,
      swapfree: 0,
      reclaimable: 0,
      writeback: null,
      dirty: null,
    })
    mockPsSuccess('')
    await optimizeMemory()
    const scripts = captureScripts()
    expect(scripts[0]).toContain('[System.GC]::Collect()')
  })

  it('step 2 uses kernel32 SetProcessWorkingSetSize via Add-Type', async () => {
    mockedIsAdmin.mockReturnValue(false)
    mockedMem.mockResolvedValue({
      total: 1,
      free: 0,
      used: 1,
      active: 1,
      available: 0,
      buffers: 0,
      cached: 0,
      slab: 0,
      buffcache: 0,
      swaptotal: 0,
      swapused: 0,
      swapfree: 0,
      reclaimable: 0,
      writeback: null,
      dirty: null,
    })
    mockPsSuccess('')
    await optimizeMemory()
    const scripts = captureScripts()
    expect(scripts[1]).toContain('SetProcessWorkingSetSize')
    expect(scripts[1]).toContain('kernel32.dll')
    expect(scripts[1]).toContain('Add-Type -TypeDefinition')
  })
})
