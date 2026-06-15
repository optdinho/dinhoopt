import { useContextMenuStore } from '@/stores/context-menu-store'
import type { ContextMenuApplyResult } from '@shared/types'
import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ApplyResultCardProps {
  result: ContextMenuApplyResult | null
  showErrors: boolean
}

export function ApplyResultCard({ result, showErrors }: ApplyResultCardProps) {
  const { t } = useTranslation('contextMenu')
  if (!result) return null
  return (
    <div
      className="mb-5 overflow-hidden rounded-2xl"
      style={{
        border: `1px solid ${result.failed > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)'}`,
      }}
    >
      <div
        className="flex items-center gap-3 p-4"
        style={{
          background: result.failed > 0 ? 'rgba(239,68,68,0.04)' : 'rgba(34,197,94,0.06)',
        }}
      >
        <CheckCircle2 className="h-5 w-5 text-green-500" strokeWidth={1.8} />
        <p className="flex-1 text-[13px] text-zinc-200">
          {result.succeeded === 1
            ? t('applyDoneSuccess', { count: result.succeeded })
            : t('applyDoneSuccessPlural', { count: result.succeeded })}
          {result.failed > 0 && (
            <button
              type="button"
              onClick={() => useContextMenuStore.getState().setShowErrors(!showErrors)}
              className="ml-2 text-red-400 underline decoration-red-400/30 hover:decoration-red-400 transition-colors"
            >
              {t('applyDoneFailureCount', { count: result.failed })} —{' '}
              {showErrors ? t('applyHideFailures') : t('applyShowFailures')}
            </button>
          )}
        </p>
      </div>
      {showErrors && result.errors.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {result.errors.map((err, i) => (
            <div
              key={`${err.entryId}-${i}`}
              className="flex items-start gap-3 px-5 py-3"
              style={{
                borderBottom: i < result.errors.length - 1 ? '1px solid var(--bg-subtle)' : 'none',
              }}
            >
              <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              <div className="min-w-0">
                <p className="text-[12px] text-zinc-300">{err.displayName}</p>
                <p className="mt-0.5 text-[11px] text-red-400/80">{err.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
