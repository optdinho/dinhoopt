import type { UpdateCheckResult, UpdateSeverity } from '@shared/types'

export function cleanOutput(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape needed
  let cleaned = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/gu, '')
  cleaned = cleaned
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i] ?? ''
        if (part.trim()) return part
      }
      return ''
    })
    .join('\n')
  return cleaned
}

export function computeSeverity(current: string, available: string): UpdateSeverity {
  const parse = (v: string): [number, number, number] | null => {
    const m = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
    if (!m) return null
    return [Number.parseInt(m[1] ?? '0', 10), Number.parseInt(m[2] ?? '0', 10), Number.parseInt(m[3] ?? '0', 10)]
  }

  const c = parse(current)
  const a = parse(available)
  if (!c || !a) return 'unknown'

  if (a[0] > c[0]) return 'major'
  if (a[0] === c[0] && a[1] > c[1]) return 'minor'
  if (a[0] === c[0] && a[1] === c[1] && a[2] > c[2]) return 'patch'
  return 'unknown'
}

export function emptyResult(
  packageManagerAvailable: boolean,
  packageManagerName: UpdateCheckResult['packageManagerName'],
): UpdateCheckResult {
  return {
    apps: [],
    totalCount: 0,
    majorCount: 0,
    minorCount: 0,
    patchCount: 0,
    packageManagerAvailable,
    packageManagerName,
  }
}

export function stripTrailingVersion(name: string): string {
  return name.replace(/\s+v?\d+[\d.]*\s*$/, '').trim()
}

export function formatAppName(raw: string): string {
  const cleaned = raw.replace(/[_-]/g, ' ').trim()
  if (!cleaned) return raw
  return cleaned
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2) return word.toLowerCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
