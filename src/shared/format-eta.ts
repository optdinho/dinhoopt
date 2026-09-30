/**
 * Renders an ETA for display, e.g. "45s", "1m 23s", "3h 05m".
 * Returns null when the ETA is unknown or the job is already finished, so the
 * caller can simply omit the label.
 */
export function formatEta(etaSeconds: number | null): string | null {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return null

  const total = Math.round(etaSeconds)
  if (total < 60) return `${total}s`

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
