import { EmptyState } from '@/components/shared/EmptyState'
import { CircleCheckBig, Search } from 'lucide-react'
import type { ProgressData } from '@shared/types'
import { useTranslation } from 'react-i18next'

interface CleanProgress {
  progress: number
  currentPath: string | null
}

interface NetworkScanResultProps {
  isScanning: boolean
  isCleaning: boolean
  cleanProgress: CleanProgress | null
  cleanResult: { cleaned: number; failed: number; details: string[] } | null
  status: string
  hasItems: boolean
  onScan: () => void
}

export function NetworkScanResult({
  isScanning,
  isCleaning,
  cleanProgress,
  cleanResult,
  status,
  hasItems,
  onScan,
}: NetworkScanResultProps) {
  const { t } = useTranslation('network')

  if (isScanning) {
    return (
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        <span className="text-[13px] text-zinc-400">{t('scanningStatus')}</span>
      </div>
    )
  }

  if (isCleaning) {
    return (
      <div
        className="mb-5 rounded-2xl px-5 py-4"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <span className="text-[13px] text-zinc-300">
            {cleanProgress?.currentPath
              ? t('cleaningItem', { item: cleanProgress.currentPath })
              : t('cleaningStatus')}
          </span>
          {cleanProgress && (
            <span className="ml-auto font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {cleanProgress.progress}%
            </span>
          )}
        </div>
        {cleanProgress && (
          <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${cleanProgress.progress}%`,
                background: 'linear-gradient(90deg, #f59e0b, #d97706)',
              }}
            />
          </div>
        )}
      </div>
    )
  }

  if (cleanResult && status === 'complete') {
    return (
      <div
        className="mb-5 rounded-2xl p-4"
        style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
      >
        <div className="flex items-center gap-3">
          <CircleCheckBig className="h-5 w-5 shrink-0 text-green-500" strokeWidth={1.8} />
          <div>
            <p className="text-[13px] font-medium text-zinc-200">{t('cleanupComplete')}</p>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('cleanedCount', { count: cleanResult.cleaned })}
              {cleanResult.failed > 0 && <span> · {t('failedCount', { count: cleanResult.failed })}</span>}
            </p>
          </div>
        </div>
        {cleanResult.details.length > 0 && (
          <div className="ml-8 mt-3 space-y-0.5">
            {cleanResult.details.map((detail) => (
              <p key={detail} className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {detail}
              </p>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!hasItems && !isScanning) {
    return (
      <EmptyState
        icon={Search}
        title={t('emptyStateTitle')}
        description={t('emptyStateDescription')}
        action={
          <button
            type="button"
            onClick={onScan}
            disabled={isCleaning}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: 'var(--text-on-accent)',
            }}
          >
            <Search className="h-4 w-4" strokeWidth={1.8} />
            {t('startScanButton')}
          </button>
        }
      />
    )
  }

  return null
}
