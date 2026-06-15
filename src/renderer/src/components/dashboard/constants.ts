export function gaugeColor(pct: number): string {
  if (pct >= 85) return '#ef4444'
  if (pct >= 60) return '#f59e0b'
  return '#22c55e'
}

export function formatGmElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export const toolRoutes: Record<string, string> = {
  cleaner: '/cleaner',
  registry: '/registry',
  drivers: '/drivers',
  updater: '/updates',
  services: '/services',
  startup: '/startup',
}
