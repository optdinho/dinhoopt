import type { DnsBenchmarkResult, DnsPreset } from '@shared/types'

export interface DnsPresetRanking extends DnsPreset {
  avgMs: number | null
  bestMs: number | null
  secondaryAvgMs: number | null
  ok: boolean
  rank: number
  isBest: boolean
}

function byServer(results: DnsBenchmarkResult[]): Map<string, DnsBenchmarkResult> {
  return new Map(results.map((r) => [r.server, r]))
}

export function rankDnsPresets(presets: DnsPreset[], results: DnsBenchmarkResult[]): DnsPresetRanking[] {
  const measured = byServer(results)
  const hasMeasurement = results.length > 0

  const enriched = presets.map((preset) => {
    const primary = measured.get(preset.primary)
    const secondary = measured.get(preset.secondary)
    const avgMs = primary?.ok ? primary.avgMs : null
    return {
      ...preset,
      avgMs,
      bestMs: primary?.ok ? primary.bestMs : null,
      secondaryAvgMs: secondary?.ok ? secondary.avgMs : null,
      ok: avgMs !== null,
      rank: 0,
      isBest: false,
    }
  })

  const sorted = enriched.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1
    if (!a.ok || !b.ok) return 0
    return (a.avgMs ?? Number.POSITIVE_INFINITY) - (b.avgMs ?? Number.POSITIVE_INFINITY)
  })

  return sorted.map((entry, index) => ({
    ...entry,
    rank: hasMeasurement ? index + 1 : 0,
    isBest: hasMeasurement && entry.ok && index === 0,
  }))
}
