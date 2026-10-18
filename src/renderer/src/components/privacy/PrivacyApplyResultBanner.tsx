import type { PrivacyApplyResult } from '@shared/types'
import { CircleAlert, CircleCheckBig, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PrivacyApplyResultBannerProps {
  applyResult: PrivacyApplyResult | null
  status: string
  onDismiss: () => void
}

export function PrivacyApplyResultBanner({ applyResult, status, onDismiss }: PrivacyApplyResultBannerProps) {
  const { t } = useTranslation('hardening')

  if (!applyResult || status !== 'done') return null

  const allFailed = applyResult.succeeded === 0 && applyResult.failed > 0
  const hasFailures = applyResult.failed > 0

  return (
    <div
      className="mb-5 rounded-2xl p-4"
      style={{
        background: allFailed ? 'rgba(239,68,68,0.04)' : hasFailures ? 'rgba(245,158,11,0.04)' : 'rgba(34,197,94,0.06)',
        border: `1px solid ${
          allFailed ? 'rgba(239,68,68,0.1)' : hasFailures ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)'
        }`,
      }}
    >
      <div className="flex items-center gap-3">
        {hasFailures ? (
          <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        ) : (
          <CircleCheckBig className="h-5 w-5 shrink-0 text-green-500" strokeWidth={1.8} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-zinc-200">
            {allFailed
              ? t('privacy.applyResultFailedTitle')
              : t(applyResult.succeeded !== 1 ? 'privacy.settingsAppliedPlural' : 'privacy.settingsApplied', {
                  count: applyResult.succeeded,
                })}
          </p>
          {applyResult.failed > 0 && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--accent)' }}>
              {applyResult.errors.length > 0
                ? t('privacy.settingsFailedDetails', { count: applyResult.failed })
                : t('privacy.settingsFailedRequireAdmin', { count: applyResult.failed })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('privacy.dismiss')}
          className="shrink-0 rounded-lg p-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      {applyResult.errors.length > 0 && (
        <div className="mt-3 ml-8 space-y-1">
          {applyResult.errors.map((err) => (
            <p key={err.id} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {err.label}: {err.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
