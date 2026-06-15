export function formatDuration(ms: number, t?: (...args: unknown[]) => string): string {
  if (ms < 1000) return t ? t('duration.lessThanOneSecond') : '<1s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return t ? t('duration.seconds', { count: seconds }) : `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return t ? t('duration.minutesAndSeconds', { minutes, seconds: secs }) : `${minutes}m ${secs}s`
}
