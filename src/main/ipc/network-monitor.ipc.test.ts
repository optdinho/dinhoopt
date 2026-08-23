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
import {
  clearConnectionsCache,
  getActiveConnections,
  isSuspicious,
  parseNetstatOutput,
  parseTasklistOutput,
  registerNetworkMonitorIpc,
} from './network-monitor.ipc'

const baseConn = {
  localAddress: '0.0.0.0',
  localPort: 1,
  remoteAddress: '8.8.8.8',
  remotePort: 53,
  state: 'Established',
  pid: 1,
  processName: 'chrome.exe',
}

function netstatLine(local: string, remote: string, state: string, pid: number | string, proto = 'TCP'): string {
  const statePart = state ? ` ${state.padEnd(16)}` : ''
  return `  ${proto.padEnd(6)}${local.padEnd(23)}${remote.padEnd(23)}${statePart} ${pid}`
}

const NETSTAT_HEADER =
  '\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID'

function tasklistRow(name: string, pid: number | string, mem = '12,345 K'): string {
  return `"${name}","${pid}","Console","1","${mem}"`
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
  clearConnectionsCache()
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

describe('parseNetstatOutput', () => {
  it('parses TCP rows and skips header/garbage lines', () => {
    const stdout = `${NETSTAT_HEADER}\n${netstatLine('0.0.0.0:135', '0.0.0.0:0', 'LISTENING', 1234)}\n${netstatLine(
      '192.168.0.5:49676',
      '1.2.3.4:443',
      'ESTABLISHED',
      999,
    )}\n`
    const rows = parseNetstatOutput(stdout)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      localAddress: '0.0.0.0',
      localPort: 135,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 1234,
    })
    expect(rows[1]!.remoteAddress).toBe('1.2.3.4')
    expect(rows[1]!.remotePort).toBe(443)
    expect(rows[1]!.pid).toBe(999)
  })

  it('filters out UDP rows', () => {
    const stdout = `${netstatLine('0.0.0.0:5353', '*:*', '', 888, 'UDP')}\n${netstatLine(
      '127.0.0.1:1900',
      '0.0.0.0:0',
      '',
      777,
      'UDP',
    )}`
    expect(parseNetstatOutput(stdout)).toEqual([])
  })

  it('parses bracketed IPv6 addresses', () => {
    const rows = parseNetstatOutput(netstatLine('[::1]:445', '[::]:0', 'LISTENING', 111))
    expect(rows[0]!.localAddress).toBe('::1')
    expect(rows[0]!.localPort).toBe(445)
    expect(rows[0]!.remoteAddress).toBe('::')
    expect(rows[0]!.remotePort).toBe(0)
  })

  it('parses stateless TCP rows (no State column)', () => {
    const rows = parseNetstatOutput(netstatLine('10.0.0.2:5000', '20.0.0.1:80', '', 42))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('')
    expect(rows[0]!.localPort).toBe(5000)
    expect(rows[0]!.pid).toBe(42)
  })

  it('skips malformed lines with non-numeric pids', () => {
    const stdout = `${netstatLine('1.1.1.1:80', '2.2.2.2:443', 'TIME_WAIT', 'not-a-pid')}\ngarbage line here\n`
    expect(parseNetstatOutput(stdout)).toEqual([])
  })
})

describe('parseTasklistOutput', () => {
  it('builds a pid-to-name map from CSV rows', () => {
    const map = parseTasklistOutput(`${tasklistRow('chrome.exe', 123)}\n${tasklistRow('svchost.exe', 456)}\n`)
    expect(map.get(123)).toBe('chrome.exe')
    expect(map.get(456)).toBe('svchost.exe')
    expect(map.size).toBe(2)
  })

  it('preserves commas inside memory usage cells', () => {
    const map = parseTasklistOutput(tasklistRow('bigapp.exe', 789, '1,234,567 K'))
    expect(map.get(789)).toBe('bigapp.exe')
  })

  it('skips malformed CSV lines', () => {
    const map = parseTasklistOutput(`"only-one-cell",\n"x","not-a-number","y"\n\n`)
    expect(map.size).toBe(0)
  })
})

describe('getActiveConnections', () => {
  it('resolves System / System Idle for pids 4 and 0 alongside real process names', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: `${NETSTAT_HEADER}\n${netstatLine('0.0.0.0:445', '0.0.0.0:0', 'LISTENING', 4)}\n${netstatLine(
          '0.0.0.0:0',
          '0.0.0.0:0',
          'LISTENING',
          0,
        )}\n${netstatLine('192.168.0.5:49676', '1.2.3.4:443', 'ESTABLISHED', 999)}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `${tasklistRow('chrome.exe', 999)}\n`, stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(3)
    expect(conns[0]!.processName).toBe('System')
    expect(conns[1]!.processName).toBe('System Idle')
    expect(conns[2]!.processName).toBe('chrome.exe')
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(execFileAsyncMock.mock.calls[0]![0]).toBe('netstat.exe')
    expect(execFileAsyncMock.mock.calls[1]![0]).toBe('tasklist.exe')
  })

  it('resolves a repeated real pid with a single tasklist call', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: `${netstatLine('10.0.0.1:1000', '8.8.8.8:53', 'ESTABLISHED', 123)}\n${netstatLine(
          '10.0.0.1:1001',
          '8.8.4.4:53',
          'ESTABLISHED',
          123,
        )}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `${tasklistRow('foo.exe', 123)}\n`, stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(2)
    expect(conns[0]!.processName).toBe('foo.exe')
    expect(conns[1]!.processName).toBe('foo.exe')
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('skips malformed netstat lines', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: `${NETSTAT_HEADER}\nnot-a-real-line\n${netstatLine('1.1.1.1:80', '2.2.2.2:443', 'TIME_WAIT', 'x')}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const conns = await getActiveConnections()
    expect(conns).toEqual([])
  })

  it('returns Unknown names when tasklist fails but still returns connections', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: netstatLine('10.0.0.1:1000', '9.9.9.9:443', 'ESTABLISHED', 55), stderr: '' })
      .mockRejectedValueOnce(new Error('tasklist crashed'))
    const conns = await getActiveConnections()
    expect(conns).toHaveLength(1)
    expect(conns[0]!.processName).toBe('Unknown')
  })

  it('returns an empty array and logs an error when netstat fails', async () => {
    execFileAsyncMock.mockRejectedValueOnce(new Error('netstat crashed'))
    const conns = await getActiveConnections()
    expect(conns).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledWith(
      'network-monitor',
      expect.stringContaining('Failed to get connections'),
    )
  })

  it('caches results within the TTL and refetches after clearConnectionsCache', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: netstatLine('10.0.0.1:1000', '9.9.9.9:443', 'ESTABLISHED', 55), stderr: '' })
      .mockResolvedValueOnce({ stdout: `${tasklistRow('a.exe', 55)}\n`, stderr: '' })
    const first = await getActiveConnections()
    const second = await getActiveConnections()
    expect(second).toBe(first)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)

    clearConnectionsCache()
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: netstatLine('10.0.0.2:2000', '9.9.9.9:443', 'ESTABLISHED', 66), stderr: '' })
      .mockResolvedValueOnce({ stdout: `${tasklistRow('b.exe', 66)}\n`, stderr: '' })
    const third = await getActiveConnections()
    expect(third).not.toBe(first)
    expect(third[0]!.processName).toBe('b.exe')
    expect(execFileAsyncMock).toHaveBeenCalledTimes(4)
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
        stdout: `${netstatLine('0.0.0.0:443', '0.0.0.0:0', 'LISTENING', 4)}\n${netstatLine(
          '10.0.0.1:5000',
          '8.8.8.8:4444',
          'ESTABLISHED',
          0,
        )}\n${netstatLine('10.0.0.1:5001', '1.2.3.4:80', 'ESTABLISHED', 2)}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `${tasklistRow('pid2.exe', 2)}\n`, stderr: '' })
    const res = (await getHandler(IPC.NETWORK_GET_CONNECTIONS)()) as {
      connections: unknown[]
      suspicious: Array<{ remotePort: number }>
    }
    expect(res.connections).toHaveLength(3)
    expect(res.suspicious).toHaveLength(1)
    expect(res.suspicious[0]!.remotePort).toBe(4444)
    expect(mockLogger.info).toHaveBeenCalledWith('network-monitor', 'Found 3 connections, 1 suspicious')
  })

  it('flags connections with unknown process names as suspicious', async () => {
    registerNetworkMonitorIpc(() => null)
    execFileAsyncMock
      .mockResolvedValueOnce({
        stdout: `${netstatLine('10.0.0.1:1000', '9.9.9.9:443', 'ESTABLISHED', 777)}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `${tasklistRow('other.exe', 111)}\n`, stderr: '' })
    const res = (await getHandler(IPC.NETWORK_GET_CONNECTIONS)()) as {
      connections: Array<{ processName: string }>
      suspicious: unknown[]
    }
    expect(res.connections).toHaveLength(1)
    expect(res.connections[0]!.processName).toBe('Unknown')
    expect(res.suspicious).toHaveLength(1)
  })
})
