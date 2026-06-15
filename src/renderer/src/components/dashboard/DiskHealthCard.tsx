import { HardDrive, Thermometer, Timer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { DiskSmartInfo } from '@shared/types'

function getHealthColor(status: DiskSmartInfo['healthStatus']): string {
  switch (status) {
    case 'Healthy':
      return '#22c55e'
    case 'Caution':
      return '#f59e0b'
    case 'Bad':
      return '#ef4444'
    default:
      return '#6b7280'
  }
}

function getHealthLabel(status: DiskSmartInfo['healthStatus']): string {
  switch (status) {
    case 'Healthy':
      return 'Healthy'
    case 'Caution':
      return 'Caution'
    case 'Bad':
      return 'Critical'
    default:
      return 'Unknown'
  }
}

export function DiskHealthCard() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const [disks, setDisks] = useState<DiskSmartInfo[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.dinho?.perfGetDiskHealth?.()
      .then((data) => {
        if (!cancelled) setDisks(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const disk = disks?.[0] ?? null
  const healthColor = disk ? getHealthColor(disk.healthStatus) : '#6b7280'
  const healthLabel = disk ? getHealthLabel(disk.healthStatus) : '—'
  const remainingLife = disk?.remainingLife ?? null
  const temperature = disk?.temperature ?? null

  const handleClick = useCallback(() => {
    navigate('/disk')
  }, [navigate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        navigate('/disk')
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
      aria-label={t('diskCardAria')}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${healthColor}20, ${healthColor}08)`,
            border: `1px solid ${error ? 'var(--border-subtle)' : `${healthColor}35`}`,
          }}
        >
          <HardDrive
            className="h-4 w-4"
            style={{ color: error ? 'var(--text-faint)' : healthColor }}
            strokeWidth={1.8}
          />
        </div>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('diskCardTitle')}
        </span>
      </div>

      {error ? (
        <span className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('diskCardUnavailable')}
        </span>
      ) : disks === null ? (
        <div className="mt-4 space-y-2">
          <div className="h-5 w-20 animate-pulse rounded" style={{ background: 'var(--bg-subtle-2)' }} />
          <div className="h-3 w-32 animate-pulse rounded" style={{ background: 'var(--bg-subtle-2)' }} />
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-2">
            <span
              className="text-xl font-bold tracking-tight"
              style={{ color: healthColor }}
            >
              {healthLabel}
            </span>
            {disk && (
              <span className="truncate text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {disk.model}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-4">
            {remainingLife !== null && (
              <div className="flex items-center gap-1.5">
                <Timer className="h-3 w-3" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>
                  {t('diskCardLife', { pct: remainingLife })}
                </span>
              </div>
            )}
            {temperature !== null && (
              <div className="flex items-center gap-1.5">
                <Thermometer className="h-3 w-3" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>
                  {temperature}°C
                </span>
              </div>
            )}
          </div>

          {disk && (
            <div className="mb-3 mt-3 h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${remainingLife ?? 100}%`,
                  background: `linear-gradient(90deg, ${healthColor}, ${healthColor}cc)`,
                  boxShadow: `0 0 8px ${healthColor}30`,
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
