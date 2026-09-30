import type { DnsBenchmarkResult, DnsPreset } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { rankDnsPresets } from './dns-ranking'

const PRESETS: DnsPreset[] = [
  { name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' },
  { name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4' },
  { name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112' },
]

function ok(server: string, avgMs: number): DnsBenchmarkResult {
  return { server, ok: true, avgMs, bestMs: avgMs - 1, samples: 3 }
}

function failed(server: string): DnsBenchmarkResult {
  return { server, ok: false, avgMs: null, bestMs: null, samples: 0, error: 'timeout' }
}

describe('rankDnsPresets', () => {
  it('sorts presets by the latency of their primary resolver', () => {
    const ranked = rankDnsPresets(PRESETS, [ok('1.1.1.1', 30), ok('8.8.8.8', 12), ok('9.9.9.9', 45)])
    expect(ranked.map((r) => r.name)).toEqual(['Google', 'Cloudflare', 'Quad9'])
  })

  it('flags only the fastest preset as best', () => {
    const ranked = rankDnsPresets(PRESETS, [ok('1.1.1.1', 30), ok('8.8.8.8', 12), ok('9.9.9.9', 45)])
    expect(ranked.filter((r) => r.isBest).map((r) => r.name)).toEqual(['Google'])
  })

  it('assigns sequential ranks starting at 1', () => {
    const ranked = rankDnsPresets(PRESETS, [ok('1.1.1.1', 30), ok('8.8.8.8', 12), ok('9.9.9.9', 45)])
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('marks a preset as unavailable when its primary did not answer', () => {
    const ranked = rankDnsPresets(PRESETS, [ok('1.1.1.1', 30), failed('8.8.8.8'), ok('9.9.9.9', 45)])
    const google = ranked.find((r) => r.name === 'Google')
    expect(google?.ok).toBe(false)
    expect(google?.avgMs).toBeNull()
  })

  it('pushes unavailable presets to the end', () => {
    const ranked = rankDnsPresets(PRESETS, [failed('1.1.1.1'), ok('8.8.8.8', 12), ok('9.9.9.9', 45)])
    expect(ranked.map((r) => r.name)).toEqual(['Google', 'Quad9', 'Cloudflare'])
  })

  it('keeps the secondary server available as a fallback latency', () => {
    const ranked = rankDnsPresets(PRESETS, [ok('1.1.1.1', 30), failed('1.0.0.1'), ok('8.8.8.8', 12), ok('9.9.9.9', 45)])
    const cloudflare = ranked.find((r) => r.name === 'Cloudflare')
    expect(cloudflare?.secondaryAvgMs).toBeNull()
  })

  it('returns every preset untouched when there is no measurement yet', () => {
    const ranked = rankDnsPresets(PRESETS, [])
    expect(ranked).toHaveLength(3)
    expect(ranked.every((r) => r.avgMs === null && !r.isBest)).toBe(true)
  })

  it('never marks a best option when nothing responded', () => {
    const ranked = rankDnsPresets(
      PRESETS,
      PRESETS.map((p) => failed(p.primary)),
    )
    expect(ranked.some((r) => r.isBest)).toBe(false)
  })

  it('does not mutate the inputs', () => {
    const presets = [...PRESETS]
    const results = [ok('9.9.9.9', 45), ok('8.8.8.8', 12), ok('1.1.1.1', 30)]
    rankDnsPresets(presets, results)
    expect(presets.map((p) => p.name)).toEqual(['Cloudflare', 'Google', 'Quad9'])
    expect(results.map((r) => r.server)).toEqual(['9.9.9.9', '8.8.8.8', '1.1.1.1'])
  })
})
