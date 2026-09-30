import { createSocket } from 'node:dgram'
import type { DnsBenchmarkResult } from '@shared/types'

const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_SAMPLES = 3
const DNS_PORT = 53
const MAX_LABEL_LENGTH = 63

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const IPV6_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i
const HOSTNAME_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

function isIpv4(value: string): boolean {
  return IPV4_RE.test(value)
}

function isIpv6(value: string): boolean {
  return value.includes(':') && IPV6_RE.test(value)
}

export function isValidDnsServer(value: string): boolean {
  if (typeof value !== 'string') return false
  return isIpv4(value) || isIpv6(value)
}

export function buildDnsQuery(domain: string, id: number): Buffer {
  if (typeof domain !== 'string' || domain.length === 0) {
    throw new Error('dns-benchmark: empty domain')
  }
  const labels = domain.split('.')
  const name = Buffer.alloc(labels.reduce((sum, l) => sum + 1 + l.length, 1))
  let offset = 0
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH || !HOSTNAME_LABEL_RE.test(label)) {
      throw new Error(`dns-benchmark: invalid label "${label}"`)
    }
    name.writeUInt8(label.length, offset)
    offset += 1
    name.write(label, offset, label.length, 'ascii')
    offset += label.length
  }
  name.writeUInt8(0, offset)

  const header = Buffer.alloc(12)
  header.writeUInt16BE(id & 0xffff, 0)
  header.writeUInt16BE(0x0100, 2)
  header.writeUInt16BE(1, 4)

  const question = Buffer.alloc(4)
  question.writeUInt16BE(1, 0)
  question.writeUInt16BE(1, 2)

  return Buffer.concat([header, name, question])
}

export function queryResolverMs(server: string, domain: string, timeoutMs: number): Promise<number> {
  if (!isValidDnsServer(server)) {
    return Promise.reject(new Error(`dns-benchmark: invalid server "${server}"`))
  }

  return new Promise<number>((resolve, reject) => {
    const socket = createSocket(isIpv6(server) ? 'udp6' : 'udp4')
    const id = Math.floor(Math.random() * 0xffff)
    const startedAt = process.hrtime.bigint()
    let timer: NodeJS.Timeout

    const settle = (fn: () => void): void => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      fn()
    }

    timer = setTimeout(() => {
      settle(() => reject(new Error(`dns-benchmark: timeout after ${timeoutMs}ms (${server})`)))
    }, timeoutMs)

    socket.on('message', (msg: Buffer) => {
      if (msg.length < 12) return
      if (msg.readUInt16BE(0) !== id) return
      if ((msg.readUInt16BE(2) & 0x8000) === 0) return
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      settle(() => resolve(elapsedMs))
    })

    socket.on('error', (err: Error) => {
      settle(() => reject(err))
    })

    try {
      const query = buildDnsQuery(domain, id)
      socket.send(query, DNS_PORT, server, (err) => {
        if (err) settle(() => reject(err))
      })
    } catch (err) {
      settle(() => reject(err))
    }
  })
}

export interface BenchmarkOptions {
  samples?: number
  timeoutMs?: number
  domain?: string
}

export async function benchmarkResolvers(
  servers: string[],
  opts: BenchmarkOptions = {},
): Promise<DnsBenchmarkResult[]> {
  const samples = Math.max(1, opts.samples ?? DEFAULT_SAMPLES)
  const timeoutMs = Math.max(100, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const domain = opts.domain ?? 'www.microsoft.com'
  const targets = servers.filter(isValidDnsServer)

  return Promise.all(
    targets.map(async (server): Promise<DnsBenchmarkResult> => {
      const times: number[] = []
      for (let i = 0; i < samples; i++) {
        try {
          times.push(await queryResolverMs(server, domain, timeoutMs))
        } catch (err) {
          if (times.length === 0) {
            return {
              server,
              ok: false,
              avgMs: null,
              bestMs: null,
              samples: 0,
              error: err instanceof Error ? err.message : String(err),
            }
          }
          break
        }
      }
      if (times.length === 0) {
        return { server, ok: false, avgMs: null, bestMs: null, samples: 0, error: 'no response' }
      }
      const total = times.reduce((sum, t) => sum + t, 0)
      return {
        server,
        ok: true,
        avgMs: total / times.length,
        bestMs: Math.min(...times),
        samples: times.length,
      }
    }),
  )
}

export function rankResults(results: DnsBenchmarkResult[]): DnsBenchmarkResult[] {
  return [...results].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1
    if (!a.ok || !b.ok) return 0
    return (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity)
  })
}
