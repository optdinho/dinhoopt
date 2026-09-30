import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSocket = {
  on: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
}
const mockCreateSocket = vi.fn(() => mockSocket)

vi.mock('node:dgram', () => ({
  createSocket: (...args: unknown[]) => mockCreateSocket(...(args as [])),
}))

const { benchmarkResolvers, buildDnsQuery, isValidDnsServer, queryResolverMs, rankResults } = await import(
  './dns-benchmark'
)

type Handler = (arg?: unknown) => void

function emit(event: string, arg?: unknown): void {
  const calls = mockSocket.on.mock.calls.filter((c) => c[0] === event)
  for (const call of calls) (call[1] as Handler)(arg)
}

function latestSentQuery(): Buffer {
  return mockSocket.send.mock.calls.at(-1)?.[0] as Buffer
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSocket.on.mockImplementation(() => undefined)
  mockSocket.send.mockImplementation(() => undefined)
  mockSocket.close.mockImplementation(() => undefined)
})

describe('isValidDnsServer', () => {
  it.each(['1.1.1.1', '8.8.8.8', '9.9.9.9', '208.67.222.222'])('accepts %s', (ip) => {
    expect(isValidDnsServer(ip)).toBe(true)
  })

  it.each(['', 'not-an-ip', '1.1.1', '1.1.1.1.1', '999.1.1.1', '1.1.1.1; rm -rf', '1.1.1.1/24', ' 1.1.1.1 '])(
    'rejects %s',
    (ip) => {
      expect(isValidDnsServer(ip)).toBe(false)
    },
  )
})

describe('buildDnsQuery', () => {
  it('builds a standard recursive A query', () => {
    const buf = buildDnsQuery('example.com', 0x1234)
    expect(buf.readUInt16BE(0)).toBe(0x1234)
    expect(buf.readUInt16BE(2)).toBe(0x0100)
    expect(buf.readUInt16BE(4)).toBe(1)
    expect(buf.readUInt16BE(6)).toBe(0)
  })

  it('encodes the domain as length-prefixed labels', () => {
    const buf = buildDnsQuery('example.com', 1)
    expect(buf.readUInt8(12)).toBe(7)
    expect(buf.subarray(13, 20).toString()).toBe('example')
    expect(buf.readUInt8(20)).toBe(3)
    expect(buf.subarray(21, 24).toString()).toBe('com')
    expect(buf.readUInt8(24)).toBe(0)
  })

  it('asks for A records in the IN class', () => {
    const buf = buildDnsQuery('example.com', 1)
    expect(buf.readUInt16BE(buf.length - 4)).toBe(1)
    expect(buf.readUInt16BE(buf.length - 2)).toBe(1)
  })

  it('rejects an empty domain', () => {
    expect(() => buildDnsQuery('', 1)).toThrow()
  })

  it('rejects a label longer than 63 bytes', () => {
    expect(() => buildDnsQuery(`${'a'.repeat(64)}.com`, 1)).toThrow()
  })

  it('rejects a non-hostname character', () => {
    expect(() => buildDnsQuery('exa mple.com', 1)).toThrow()
  })
})

describe('queryResolverMs', () => {
  it('resolves with the round-trip time on a matching response', async () => {
    const promise = queryResolverMs('1.1.1.1', 'example.com', 500)
    const query = latestSentQuery()
    const response = Buffer.from(query)
    response.writeUInt16BE(0x8000, 2)
    emit('message', response)
    await expect(promise).resolves.toBeGreaterThanOrEqual(0)
    expect(mockSocket.close).toHaveBeenCalled()
  })

  it('ignores a response whose transaction id does not match', async () => {
    const promise = queryResolverMs('1.1.1.1', 'example.com', 500)
    const response = Buffer.from(latestSentQuery())
    response.writeUInt16BE(0xbeef, 0)
    response.writeUInt16BE(0x8000, 2)
    emit('message', response)
    const good = Buffer.from(latestSentQuery())
    good.writeUInt16BE(0x8000, 2)
    emit('message', good)
    await expect(promise).resolves.toBeGreaterThanOrEqual(0)
  })

  it('ignores a packet that is not a response', async () => {
    const promise = queryResolverMs('1.1.1.1', 'example.com', 500)
    const notAResponse = Buffer.from(latestSentQuery())
    notAResponse.writeUInt16BE(0x0000, 2)
    emit('message', notAResponse)
    const good = Buffer.from(latestSentQuery())
    good.writeUInt16BE(0x8000, 2)
    emit('message', good)
    await expect(promise).resolves.toBeGreaterThanOrEqual(0)
  })

  it('rejects on timeout and closes the socket', async () => {
    vi.useFakeTimers()
    const settled = expect(queryResolverMs('1.1.1.1', 'example.com', 2000)).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(2001)
    await settled
    expect(mockSocket.close).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('rejects an invalid server without opening a socket', async () => {
    await expect(queryResolverMs('nope', 'example.com', 500)).rejects.toThrow()
    expect(mockCreateSocket).not.toHaveBeenCalled()
  })

  it('rejects when send fails', async () => {
    mockSocket.send.mockImplementation(() => {
      throw new Error('boom')
    })
    await expect(queryResolverMs('1.1.1.1', 'example.com', 500)).rejects.toThrow()
  })

  it('rejects when the socket errors', async () => {
    const promise = queryResolverMs('1.1.1.1', 'example.com', 500)
    emit('error', new Error('ECONNREFUSED'))
    await expect(promise).rejects.toThrow()
  })
})

describe('benchmarkResolvers', () => {
  it('averages several samples per resolver', async () => {
    mockSocket.send.mockImplementation(() => {
      queueMicrotask(() => {
        const response = Buffer.from(latestSentQuery())
        response.writeUInt16BE(0x8000, 2)
        emit('message', response)
      })
    })
    const results = await benchmarkResolvers(['1.1.1.1'], { samples: 3 })
    expect(results).toHaveLength(1)
    expect(results[0]!.ok).toBe(true)
    expect(results[0]!.samples).toBe(3)
    expect(results[0]!.avgMs).toBeGreaterThanOrEqual(0)
  })

  it('marks a silent resolver as failed without throwing', async () => {
    vi.useFakeTimers()
    const promise = benchmarkResolvers(['9.9.9.9'], { samples: 1, timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(5000)
    const results = await promise
    expect(results[0]!.ok).toBe(false)
    expect(results[0]!.avgMs).toBeNull()
    expect(results[0]!.error).toBeTruthy()
    vi.useRealTimers()
  })

  it('skips invalid servers instead of probing them', async () => {
    const results = await benchmarkResolvers(['bogus'], { samples: 1 })
    expect(results).toEqual([])
    expect(mockCreateSocket).not.toHaveBeenCalled()
  })

  it('returns one result per valid server', async () => {
    mockSocket.send.mockImplementation(() => {
      queueMicrotask(() => {
        const response = Buffer.from(latestSentQuery())
        response.writeUInt16BE(0x8000, 2)
        emit('message', response)
      })
    })
    const results = await benchmarkResolvers(['1.1.1.1', '8.8.8.8', '9.9.9.9'], { samples: 1 })
    expect(results.map((r) => r.server)).toEqual(['1.1.1.1', '8.8.8.8', '9.9.9.9'])
  })
})

describe('rankResults', () => {
  it('sorts successful results by ascending average', () => {
    const ranked = rankResults([
      { server: 'a', ok: true, avgMs: 40, bestMs: 30, samples: 3 },
      { server: 'b', ok: true, avgMs: 12, bestMs: 9, samples: 3 },
      { server: 'c', ok: true, avgMs: 25, bestMs: 20, samples: 3 },
    ])
    expect(ranked.map((r) => r.server)).toEqual(['b', 'c', 'a'])
  })

  it('keeps failed resolvers at the end in their original order', () => {
    const ranked = rankResults([
      { server: 'fail1', ok: false, avgMs: null, bestMs: null, samples: 0, error: 'timeout' },
      { server: 'ok', ok: true, avgMs: 50, bestMs: 40, samples: 2 },
      { server: 'fail2', ok: false, avgMs: null, bestMs: null, samples: 0, error: 'timeout' },
    ])
    expect(ranked.map((r) => r.server)).toEqual(['ok', 'fail1', 'fail2'])
  })

  it('does not mutate the input', () => {
    const input = [
      { server: 'a', ok: true, avgMs: 10, bestMs: 5, samples: 1 },
      { server: 'b', ok: true, avgMs: 2, bestMs: 1, samples: 1 },
    ]
    rankResults(input)
    expect(input.map((r) => r.server)).toEqual(['a', 'b'])
  })
})
