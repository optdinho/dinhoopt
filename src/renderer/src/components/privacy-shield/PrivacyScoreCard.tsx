import type { PrivacySetting } from '@shared/types'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { categories, ScoreRing } from '@/pages/privacy/PrivacyShieldComponents'

export interface PrivacyScoreCardProps {
  state: {
    score: number
    total: number
    protected: number
    settings: PrivacySetting[]
  }
  unprotectedCount: number
}

export function PrivacyScoreCard({ state, unprotectedCount }: PrivacyScoreCardProps) {
  const { t } = useTranslation('hardening')

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        className="rounded-2xl p-5 flex items-center gap-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <ScoreRing score={state.score} />
        <div>
          <p className="text-[14px] font-semibold text-zinc-200">{t('privacy.privacyScore')}</p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {state.score >= 80
              ? t('privacy.scoreWellProtected')
              : state.score >= 50
                ? t('privacy.scoreNeedsImprovement')
                : t('privacy.scoreAtRisk')}
          </p>
        </div>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          {unprotectedCount === 0 ? (
            <ShieldCheck className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          ) : (
            <ShieldAlert className="h-5 w-5 text-amber-500" strokeWidth={1.8} />
          )}
          <span className="text-[13px] font-medium text-zinc-200">
            {unprotectedCount === 0
              ? t('privacy.fullyProtected')
              : t('privacy.unprotectedCount', { count: unprotectedCount })}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(state.protected / state.total) * 100}%`,
                background: state.score >= 80 ? '#22c55e' : state.score >= 50 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
          <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {state.protected}/{state.total}
          </span>
        </div>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
          {t('privacy.categoriesLabel')}
        </p>
        <div className="space-y-1.5">
          {categories.map((cat) => {
            const catSettings = state.settings.filter((s) => s.category === cat.id)
            if (catSettings.length === 0) return null
            const protectedInCat = catSettings.filter((s) => s.enabled).length
            const allGood = protectedInCat === catSettings.length
            return (
              <div key={cat.id} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: allGood ? '#22c55e' : cat.color }}
                  />
                  <span className="text-[11px] text-zinc-400">{t(cat.labelKey).split(' ')[0]}</span>
                </div>
                <span
                  className="text-[11px] font-mono"
                  style={{ color: allGood ? '#22c55e' : 'var(--text-muted)' }}
                >
                  {protectedInCat}/{catSettings.length}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
