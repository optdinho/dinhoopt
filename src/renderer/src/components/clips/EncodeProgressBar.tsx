import { formatEta } from '@shared/format-eta'
import { Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ClipEncodeProgressState } from './useClipEncodeProgress'

interface EncodeProgressBarProps {
  progress: ClipEncodeProgressState
  onCancel: () => void
  cancelError?: string | undefined
}

export function EncodeProgressBar({ progress, onCancel, cancelError }: EncodeProgressBarProps) {
  const { t } = useTranslation('clips')
  if (!progress.running) return null

  const percent = Math.max(0, Math.min(100, progress.percent))
  const eta = formatEta(progress.etaSeconds)

  return (
    <div className="mt-2" data-testid="encode-progress">
      <div
        className="mb-1 flex items-center justify-between text-[10px]"
        style={{ color: 'var(--text-muted)' }}
        aria-live="polite"
      >
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {t('encodeProgress')}
        </span>
        <span className="font-mono" data-testid="encode-progress-percent">
          {progress.indeterminate ? '—' : `${Math.round(percent)}%`}
          {eta ? ` · ${t('encodeEta', { time: eta })}` : ''}
        </span>
      </div>

      <div
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--bg-subtle-2)' }}
        role="progressbar"
        aria-valuenow={progress.indeterminate ? undefined : Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('encodeProgress')}
      >
        <div
          className={`h-full rounded-full transition-all duration-200 ${progress.indeterminate ? 'animate-pulse' : ''}`}
          style={{
            width: progress.indeterminate ? '100%' : `${percent}%`,
            opacity: progress.indeterminate ? 0.4 : 1,
            background: 'var(--accent)',
          }}
        />
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
      >
        <X className="h-3.5 w-3.5" />
        {t('cancelEncode')}
      </button>

      {cancelError ? (
        <p className="mt-1 text-[10px]" style={{ color: 'var(--danger, #ef4444)' }} role="alert">
          {cancelError}
        </p>
      ) : null}
    </div>
  )
}
