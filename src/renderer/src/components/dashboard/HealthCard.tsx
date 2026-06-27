import { HealthScore } from '@/components/shared/HealthScore'
import { usePolling } from '@/hooks/usePolling'
import { formatBytes } from '@/lib/utils'
import type { DiskSmartInfo } from '@shared/types'
import { BarChart3, Check, FileStack, HardDrive, MemoryStick } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toolRoutes } from './constants'
import type { ToolCoverageItem } from './types'

const STATS_POLL_INTERVAL = 60_000

export function HealthCard({
  healthScore,
  toolCoverage,
  memPercent,
  totalSpaceSaved,
  totalFilesCleaned,
  totalScans,
}: {
  healthScore: number
  toolCoverage: ToolCoverageItem[]
  memPercent: number
  totalSpaceSaved: number
  totalFilesCleaned: number
  totalScans: number
}) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { data: disks } = usePolling<DiskSmartInfo[]>(
    () => window.dinho?.perfGetDiskHealth?.() ?? Promise.resolve([]),
    STATS_POLL_INTERVAL,
  )
  const disk = disks?.[0] ?? null
  const memColor = memPercent >= 85 ? '#ef4444' : memPercent >= 60 ? '#f59e0b' : '#06b6d4'

  const diskLabel = useMemo(() => {
    if (!disk) return '—'
    switch (disk.healthStatus) {
      case 'Healthy':
        return 'Saudável'
      case 'Caution':
        return 'Atenção'
      case 'Bad':
        return 'Crítico'
      default:
        return '—'
    }
  }, [disk])

  const diskColor = useMemo(() => {
    if (!disk) return '#6b7280'
    switch (disk.healthStatus) {
      case 'Healthy':
        return '#22c55e'
      case 'Caution':
        return '#f59e0b'
      case 'Bad':
        return '#ef4444'
      default:
        return '#6b7280'
    }
  }, [disk])

  const stats = useMemo(
    () => [
      { icon: MemoryStick, label: t('gaugeRam'), value: `${memPercent}%`, color: memColor },
      { icon: HardDrive, label: t('diskCardTitle'), value: diskLabel, color: diskColor },
      { icon: BarChart3, label: t('statSpaceRecovered'), value: formatBytes(totalSpaceSaved), color: '#06b6d4' },
      { icon: FileStack, label: t('statFilesCleaned'), value: String(totalFilesCleaned), color: '#22c55e' },
      { icon: BarChart3, label: t('statTotalScans'), value: String(totalScans), color: '#a855f7' },
    ],
    [memPercent, diskLabel, diskColor, totalSpaceSaved, totalFilesCleaned, totalScans, t],
  )

  return (
    <div
      className="glass-card depth-emphasis flex flex-col items-center justify-center rounded-2xl px-4 py-5 sm:px-6 sm:py-6 animate-fade-in"
      style={{
        borderLeft: '2px solid var(--accent)',
        boxShadow: '0 0 24px rgba(139,92,246,0.04), 0 2px 8px rgba(0,0,0,0.12), inset 0 1px 0 var(--glass-inset)',
      }}
    >
      <HealthScore score={healthScore} size="md" />
      <div className="mt-4 flex flex-wrap justify-center items-center gap-1.5 sm:gap-2">
        {toolCoverage.map((tool, i) => {
          const Icon = tool.icon
          const route = toolRoutes[tool.key]
          return (
            <div
              key={tool.key}
              className="relative flex h-7 w-7 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-lg transition-all duration-200 hover:brightness-110 hover:scale-110"
              style={{
                animation: `fade-in 0.3s ease-out ${0.2 + i * 0.05}s both`,
                background: tool.usedRecently ? `${tool.color}18` : 'var(--bg-subtle)',
                border: `1px solid ${tool.usedRecently ? `${tool.color}30` : 'var(--border-subtle)'}`,
              }}
              title={`${tool.label}: ${tool.usedRecently ? t('toolTipUsedRecently') : tool.usedEver ? t('toolTipNotUsedRecently') : t('toolTipNeverUsed')}`}
              onClick={() => route && navigate(route)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && route) {
                  e.preventDefault()
                  navigate(route)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <Icon
                className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                style={{ color: tool.usedRecently ? tool.color : 'var(--text-faint)' }}
                strokeWidth={1.8}
              />
              {tool.usedRecently && (
                <div
                  className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full"
                  style={{ background: '#22c55e' }}
                >
                  <Check className="h-2 w-2 text-white" strokeWidth={3} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div
        className="mt-4 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t pt-3"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {s.label}
            </span>
            <span className="text-[11px] font-semibold text-white">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
