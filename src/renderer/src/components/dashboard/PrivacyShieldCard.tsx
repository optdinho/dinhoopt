import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import { usePolling } from '@/hooks/usePolling'
import { ShieldCheck } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { PrivacyShieldState } from '@shared/types'

const PRIVACY_POLL_INTERVAL = 120_000

export function PrivacyShieldCard() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { data: state, error, loading } = usePolling<PrivacyShieldState>(
    () => window.dinho?.privacyScan?.() ?? Promise.resolve({ score: 0, protected: 0, total: 0 }),
    PRIVACY_POLL_INTERVAL,
  )

  const score = Math.round(useAnimatedCounter(state?.score ?? 0))
  const protectedCount = state?.protected ?? 0
  const total = state?.total ?? 0
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'

  const handleClick = useCallback(() => {
    navigate('/privacy')
  }, [navigate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        navigate('/privacy')
      }
    },
    [navigate],
  )

  return (
    <div
      className="glass-card glass-card-hover depth-mid group relative flex cursor-pointer flex-col rounded-2xl px-4 py-5 transition-all"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('privacyCardAria')}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${color}20, ${color}08)`,
            border: `1px solid ${error ? 'var(--border-subtle)' : `${color}35`}`,
          }}
        >
          <ShieldCheck className="h-4 w-4" style={{ color: error ? 'var(--text-faint)' : color }} strokeWidth={1.8} />
        </div>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('privacyCardTitle')}
        </span>
      </div>

      {error ? (
        <span className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('privacyCardUnavailable')}
        </span>
      ) : loading ? (
        <div className="mt-4 space-y-2">
          <div className="h-5 w-16 animate-pulse rounded" style={{ background: 'var(--bg-subtle-2)' }} />
          <div className="h-3 w-28 animate-pulse rounded" style={{ background: 'var(--bg-subtle-2)' }} />
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-white">{score}</span>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
              {t('privacyCardScore')}
            </span>
          </div>

          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {t('privacyCardProtected', { protected: protectedCount, total })}
          </div>

          <div className="mb-3 mt-3 h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${score}%`,
                background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                boxShadow: `0 0 8px ${color}30`,
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
