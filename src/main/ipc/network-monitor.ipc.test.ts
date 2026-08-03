import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock external dependencies ──────────────────────────────────────

const { execFileAsyncMock, mockHandlers, mockLogger } = vi.hoisted(() => {
  const execFileAsyncMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockLogger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }
  return { execFileAsyncMock, mockHandlers, mockLogger }
})

vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock,
  }),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
      return handler
    }),
  },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mockLogger,
}))

import { IPC } from '@shared/channels'
import { getActiveConnections, isSuspicious, registerNetworkMonitorIpc } from './network-monitor.ipc'

const baseConn = {
  localAddress: '0.0.0.0',
  localPort: 1,
  remoteAddress: '8.8.8.8',
  remotePort: 53,
  state: 'Established',
  pid: 1,
  processName: 'chrome.exe',
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    LocalAddress: '0.0.0.0',
    LocalPort: 135,
    RemoteAddress: '8.8.8.8',
    RemotePort: 443,
    OwningProcess: 1,
    State: 'Established',
    ...overrides,
  }
}

let getHandler: (channel: string) => (...args: unknown[]) => unknown

beforeAll(async () => {
  const mod = await import('./network-monitor.ipc')
  getHandler = (channel: string) => {
    const h = mockHandlers.get(channel)
    if (!h) throw new Error(`Handler not registered for ${channel}`)
    return h
  }
  void mod
})

beforeEach(() => {
  mockHandlers.clear()
  execFileAsyncMock.mockReset()
  execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  mockLogger.info.mockReset()
  mockLogger.warning.mockReset()
  mockLogger.error.mockReset()
  mockLogger.success.mockReset()
})

describe('isSuspicious', () => {
  it('returns false for loopback / unspecified / empty remote addresses', () => {
    expect(isSuspicious({ ...baseConn, remoteAddress: '0.0.0.0' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '::' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '127.0.0.1' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '::1' })).toBe(false)
  })

  it('returns true for known suspicious ports', () => {
    expect(isSuspicious({ ...baseConn, remotePort: 4444 })).toBe(true)
    expect(isSuspicious({ ...baseConn, remotePort: 8080 })).toBe(true)
    expect(isSuspicious({ ...baseConn, remotePort: 31337 })).toBe(true)
    expect(isSuspicious({ ...baseConn, remotePort: 9051 })).toBe(true)
    expect(isSuspicious({ ...baseConn, remotePort: 12345 })).toBe(true)
  })

  it('returns false for private IPv4 ranges and 0.x addresses', () => {
    expect(isSuspicious({ ...baseConn, remoteAddress: '0.1.2.3' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '10.1.2.3' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '127.0.0.2' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '192.168.1.1' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: '172.16.0.1' })).toBe(false)
  })

  it('returns true for multicast IPv4 addresses', () => {
    expect(isSuspicious({ ...baseConn, remoteAddress: '224.0.0.1' })).toBe(true)
    expect(isSuspicious({ ...baseConn, remoteAddress: '239.255.255.250' })).toBe(true)
  })

  it('returns true when processName is empty or Unknown', () => {
    expect(isSuspicious({ ...baseConn, processName: '' })).toBe(true)
    expect(isSuspicious({ ...baseConn, processName: 'Unknown' })).toBe(true)
  })

  it('returns false for a normal external connection', () => {
    expect(isSuspicious(baseConn)).toBe(false)
  })

  it('treats non-IPv4 remote addresses via the processName fallback', () => {
    expect(isSuspicious({ ...baseConn, remoteAddress: 'fe80::1', processName: 'svchost.exe' })).toBe(false)
    expect(isSuspicious({ ...baseConn, remoteAddress: 'fe80::1', processName: 'Unknown' })).toBe(true)
  })
})

describe('getActiveConnections', () => {
  it('parses an array of rows and resolves process names for pids 0 and 4 without extra calls', async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { ...row({ OwningProcess: 4, State: 'Listen' }) },
        { ...row({ OwningProcess: 0, State: 'Listen', RemoteAddress: '0.0.0.0' }) },
      ]),
      stderr: '',
    })
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(2)
    expect(conns[0]!.processName).toBe('System')
    expect(conns[1]!.processName).toBe('System Idle')
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('wraps a single-object JSON payload into an array and resolves a real pid', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ...row({ OwningProcess: 999, RemoteAddress: '1.2.3.4', RemotePort: 443 }) }),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'chrome.exe\n', stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(1)
    expect(conns[0]!.pid).toBe(999)
    expect(conns[0]!.remoteAddress).toBe('1.2.3.4')
    expect(conns[0]!.processName).toBe('chrome.exe')
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(execFileAsyncMock.mock.calls[1]![0]).toBe('powershell.exe')
  })

  it('caches process names by pid (single Get-Process call for repeated pid)', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { ...row({ OwningProcess: 123 }) },
          { ...row({ OwningProcess: 123, RemotePort: 80 }) },
        ]),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'foo.exe\n', stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(2)
    expect(conns[0]!.processName).toBe('foo.exe')
    expect(conns[1]!.processName).toBe('foo.exe')
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('skips non-object rows and fills empty string fields', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([null, { LocalPort: 1234, OwningProcess: 1, RemotePort: 4444 }, 'garbage', 42]),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'svchost.exe\n', stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(1)
    expect(conns[0]!.localAddress).toBe('')
    expect(conns[0]!.localPort).toBe(1234)
    expect(conns[0]!.remoteAddress).toBe('')
    expect(conns[0]!.processName).toBe('svchost.exe')
  })

  it('returns Unknown when resolving the process name fails', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ ...row({ OwningProcess: 999 }) }]), stderr: '' })
      .mockRejectedValueOnce(new Error('no such process'))
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(1)
    expect(conns[0]!.processName).toBe('Unknown')
  })

  it('returns an empty array and logs an error when the query fails', async () => {
    execFileAsyncMock.mockRejectedValueOnce(new Error('powershell crashed'))
    const conns = await getActiveConnections()
    expect(conns).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledWith(
      'network-monitor',
      expect.stringContaining('Failed to get connections'),
    )
  })

  it('returns an empty array when the JSON payload is invalid', async () => {
    execFileAsyncMock.mockResolvedValueOnce({ stdout: 'not json', stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledWith(
      'network-monitor',
      expect.stringContaining('Failed to get connections'),
    )
  })
})

describe('registerNetworkMonitorIpc', () => {
  it('registers the NETWORK_GET_CONNECTIONS channel', async () => {
    registerNetworkMonitorIpc(() => null)
    expect(mockHandlers.has(IPC.NETWORK_GET_CONNECTIONS)).toBe(true)
  })

  it('returns connections split into suspicious and normal', async () => {
    registerNetworkMonitorIpc(() => null)
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { ...row({ OwningProcess: 4, RemotePort: 443 }) },
          { ...row({ OwningProcess: 0, RemotePort: 4444 }) },
          { ...row({ OwningProcess: 2, RemotePort: 80, RemoteAddress: '1.2.3.4' }) },
        ]),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'pid2.exe\n', stderr: '' })
    const res = await getHandler(IPC.NETWORK_GET_CONNECTIONS)()
    expect(res.connections).toHaveLength(3)
    expect(res.suspicious).toHaveLength(1)
    expect(res.suspicious[0]!.remotePort).toBe(4444)
    expect(mockLogger.info).toHaveBeenCalledWith('network-monitor', 'Found 3 connections, 1 suspicious')
  })

  it('flags connections with unknown process names as suspicious', async () => {
    registerNetworkMonitorIpc(() => null)
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ ...row({ OwningProcess: 777, RemotePort: 443 }) }]),
        stderr: '',
      })
      .mockRejectedValueOnce(new Error('cannot resolve'))
    const res = await getHandler(IPC.NETWORK_GET_CONNECTIONS)()
    expect(res.connections).toHaveLength(1)
    expect(res.connections[0]!.processName).toBe('Unknown')
    expect(res.suspicious).toHaveLength(1)
  })
})
