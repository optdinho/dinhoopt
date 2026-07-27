import type { PrivacySetting } from '@shared/types'
import { CircleCheckBig, Eye, Loader2, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface ApplySectionProps {
  busy: boolean
  state: {
    score: number
    total: number
    protected: number
    settings: PrivacySetting[]
  } | null
  unprotectedCount: number
  applyResult: {
    succeeded: number
    failed: number
    errors: Array<{ id: string; label: string; reason: string }>
  } | null
  status: string
  onScan: () => void
  onApplyAll: () => void
}

export function ApplySection({
  busy,
  state,
  unprotectedCount,
  applyResult,
  status,
  onScan,
  onApplyAll,
}: ApplySectionProps) {
  const { t } = useTranslation('hardening')

  return (
    <>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onScan}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
        >
          <Eye className="h-4 w-4" strokeWidth={1.8} />
          {t('privacy.scanButton')}
        </button>
        {state && unprotectedCount > 0 && (
          <button
            type="button"
            onClick={onApplyAll}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(34,197,94,0.2)',
            }}
          >
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
            {t('privacy.protectAllButton', { count: unprotectedCount })}
          </button>
        )}
      </div>

      {status === 'applying' && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin text-green-400" />
          <span className="text-[13px] text-zinc-400">{t('privacy.applyingProtections')}</span>
        </div>
      )}

      {applyResult && status === 'done' && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.04)' : 'rgba(34,197,94,0.06)',
            border: `1px solid ${applyResult.failed > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)'}`,
          }}
        >
          <div className="flex items-center gap-3">
            <CircleCheckBig className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">
                {t(applyResult.succeeded !== 1 ? 'privacy.settingsAppliedPlural' : 'privacy.settingsApplied', {
                  count: applyResult.succeeded,
                })}
              </p>
              {applyResult.failed > 0 && (
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--accent)' }}>
                  {t('privacy.settingsFailedRequireAdmin', { count: applyResult.failed })}
                </p>
              )}
            </div>
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
      )}
    </>
  )
}
