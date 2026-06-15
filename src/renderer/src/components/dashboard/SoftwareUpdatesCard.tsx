import { Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { UpdateCheckResult } from '@shared/types'

export function SoftwareUpdatesCard() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const [data, setData] = useState<UpdateCheckResult | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.dinho?.softwareUpdateCheck?.()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const totalCount = data?.totalCount ?? 0
  const majorCount = data?.majorCount ?? 0
  const minorCount = data?.minorCount ?? 0
  const patchCount = data?.patchCount ?? 0
  const color = majorCount > 0 ? '#ef4444' : totalCount > 0 ? '#f59e0b' : '#22c55e'

  const handleClick = useCallback(() => {
    navigate('/software-updates')
  }, [navigate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        navigate('/software-updates')
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
      aria-label={t('updatesCardAria', { count: totalCount })}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${color}20, ${color}08)`,
            border: `1px solid ${error ? 'var(--border-subtle)' : `${color}35`}`,
          }}
        >
          <Download
            className="h-4 w-4"
            style={{ color: error ? 'var(--text-faint)' : color }}
            strokeWidth={1.8}
          />
        </div>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('updatesCardTitle')}
        </span>
      </div>

      {error ? (
        <span className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('updatesCardUnavailable')}
        </span>
      ) : data === null ? (
        <div className="mt-4 space-y-2">
          <div className="h-5 w-12 animate-pulse rounded" style={{ background: 'var(--bg-subtle-2)' }} />
          <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'var(--bg-subtle-2)' }} />
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-white">{totalCount}</span>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
              {t('updatesCardAvailable')}
            </span>
          </div>

          {totalCount > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {majorCount > 0 && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: '#ef444420',
                    color: '#ef4444',
                    border: '1px solid #ef444435',
                  }}
                >
                  {majorCount} major
                </span>
              )}
              {minorCount > 0 && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: '#f59e0b20',
                    color: '#f59e0b',
                    border: '1px solid #f59e0b35',
                  }}
                >
                  {minorCount} minor
                </span>
              )}
              {patchCount > 0 && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: '#06b6d420',
                    color: '#06b6d4',
                    border: '1px solid #06b6d435',
                  }}
                >
                  {patchCount} patch
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
