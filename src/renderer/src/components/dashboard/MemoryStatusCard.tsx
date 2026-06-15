import { MemoryStick, Zap } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

interface MemoryStatusCardProps {
  memPercent: number
  memUsedBytes: number
  memTotalBytes: number
}

export function MemoryStatusCard({ memPercent, memUsedBytes, memTotalBytes }: MemoryStatusCardProps) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  const color = memPercent >= 85 ? '#ef4444' : memPercent >= 60 ? '#f59e0b' : '#06b6d4'

  const handleClick = useCallback(() => {
    navigate('/memory')
  }, [navigate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        navigate('/memory')
      }
    },
    [navigate],
  )

  const handleOptimize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      window.dinho?.memoryOptimize?.()
    },
    [],
  )

  return (
    <div
      className="glass-card glass-card-hover depth-mid group relative flex cursor-pointer flex-col rounded-2xl px-4 py-5 transition-all"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('memoryCardAria')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
            style={{
              background: `linear-gradient(135deg, ${color}20, ${color}08)`,
              border: `1px solid ${color}35`,
            }}
          >
            <MemoryStick className="h-4 w-4" style={{ color }} strokeWidth={1.8} />
          </div>
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('memoryCardTitle')}
          </span>
        </div>

        <button
          type="button"
          onClick={handleOptimize}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-all hover:scale-105"
          style={{
            background: 'var(--accent-muted-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-muted-border)',
          }}
          title={t('memoryCardOptimizeTitle')}
        >
          <Zap className="h-3 w-3" strokeWidth={2} />
          {t('memoryCardOptimize')}
        </button>
      </div>

      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tracking-tight text-white">
          {memPercent}%
        </span>
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
          {t('memoryCardUsed')}
        </span>
      </div>

      <div className="mb-3 mt-2 h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${memPercent}%`,
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
            boxShadow: `0 0 8px ${color}30`,
          }}
        />
      </div>

      <span className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>
        {t('memoryCardDetail', { used: formatMem(memUsedBytes), total: formatMem(memTotalBytes) })}
      </span>
    </div>
  )
}

function formatMem(bytes: number): string {
  if (bytes === 0) return '0 GB'
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}
