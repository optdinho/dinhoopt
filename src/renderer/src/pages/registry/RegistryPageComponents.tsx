import type { RegistryEntry } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { CalendarClock, Check, ChevronDown, Gauge, Server, ShieldAlert, Trash2, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'

type CardType = RegistryEntry['type']

export const typeKeyMap: Record<CardType, string> = {
  obsolete: 'entryTypeObsolete',
  invalid: 'entryTypeInvalid',
  orphaned: 'entryTypeOrphaned',
  broken: 'entryTypeBroken',
  vulnerability: 'entryTypeVulnerability',
  privacy: 'entryTypeVulnerability', // kept for type compat
  performance: 'entryTypePerformance',
  network: 'entryTypeNetwork',
  service: 'entryTypeService',
  task: 'entryTypeTask',
}

export const riskKeyMap: Record<RegistryEntry['risk'], string> = {
  low: 'riskLow',
  medium: 'riskMedium',
  high: 'riskHigh',
}

export const typeColors: Record<CardType, { bg: string; text: string }> = {
  obsolete: { bg: 'var(--bg-hover)', text: 'var(--text-muted)' },
  invalid: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b' },
  orphaned: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6' },
  broken: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444' },
  vulnerability: { bg: 'rgba(168,85,247,0.1)', text: '#a855f7' },
  privacy: { bg: 'rgba(236,72,153,0.1)', text: '#ec4899' }, // kept for type compat
  performance: { bg: 'rgba(20,184,166,0.1)', text: '#14b8a6' },
  network: { bg: 'rgba(99,102,241,0.1)', text: '#6366f1' },
  service: { bg: 'rgba(251,146,60,0.1)', text: '#fb923c' },
  task: { bg: 'rgba(163,230,53,0.1)', text: '#a3e635' },
}

export const riskColors: Record<RegistryEntry['risk'], string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
}

export interface CardDef {
  types: CardType[]
  icon: LucideIcon
  titleKey: string
  descriptionKey: string
  color: { bg: string; text: string }
  /** Total number of checks for this card (undefined = dynamic/variable) */
  totalChecks?: number
}

export const cards: CardDef[] = [
  {
    types: ['obsolete', 'invalid', 'orphaned', 'broken'],
    icon: Trash2,
    titleKey: 'cardRegistryCleanup',
    descriptionKey: 'cardRegistryCleanupDescription',
    color: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b' },
  },
  {
    types: ['vulnerability'],
    icon: ShieldAlert,
    titleKey: 'cardSecurity',
    descriptionKey: 'cardSecurityDescription',
    color: typeColors.vulnerability,
    totalChecks: 12,
  },
  {
    types: ['performance'],
    icon: Gauge,
    titleKey: 'cardPerformance',
    descriptionKey: 'cardPerformanceDescription',
    color: typeColors.performance,
    totalChecks: 1,
  },
  {
    types: ['network'],
    icon: Wifi,
    titleKey: 'cardNetwork',
    descriptionKey: 'cardNetworkDescription',
    color: typeColors.network,
    totalChecks: 2,
  },
  {
    types: ['service'],
    icon: Server,
    titleKey: 'cardServices',
    descriptionKey: 'cardServicesDescription',
    color: typeColors.service,
    totalChecks: 2,
  },
  {
    types: ['task'],
    icon: CalendarClock,
    titleKey: 'cardScheduledTasks',
    descriptionKey: 'cardScheduledTasksDescription',
    color: typeColors.task,
  },
]

export function HealthRing({ percent, color, size = 36 }: { percent: number; color: string; size?: number }) {
  const { t } = useTranslation('registry')
  const r = (size - 4) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percent / 100) * circumference
  const isComplete = percent === 100

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <title>{t('progressGauge')}</title>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gauge-track)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={isComplete ? '#22c55e' : color}
          strokeWidth={3}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute text-[10px] font-bold" style={{ color: isComplete ? '#22c55e' : color }}>
        {isComplete ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : `${percent}%`}
      </span>
    </div>
  )
}

interface RegistryCardsSectionProps {
  entries: RegistryEntry[]
  expandedCards: Set<number>
  fixing: boolean
  onToggleCardAll: (types: string[]) => void
  onToggleCardExpand: (index: number) => void
  onToggleEntry: (id: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}

export function RegistryCardsSection({
  entries,
  expandedCards,
  fixing,
  onToggleCardAll,
  onToggleCardExpand,
  onToggleEntry,
  t,
}: RegistryCardsSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {cards.map((card, cardIndex) => {
        const cardEntries = entries.filter((e) => card.types.includes(e.type))
        const issueCount = cardEntries.length
        const selectedInCard = cardEntries.filter((e) => e.selected).length
        const allSelected = issueCount > 0 && selectedInCard === issueCount
        const isExpanded = expandedCards.has(cardIndex)
        const highRiskCount = cardEntries.filter((e) => e.risk === 'high').length
        const mediumRiskCount = cardEntries.filter((e) => e.risk === 'medium').length
        const Icon = card.icon
        const color = card.color

        const hasPercentage = card.totalChecks !== undefined
        const healthPercent = hasPercentage
          ? Math.round(((card.totalChecks! - issueCount) / card.totalChecks!) * 100)
          : issueCount === 0
            ? 100
            : undefined
        const isClean = issueCount === 0

        return (
          <div
            key={card.titleKey}
            className="overflow-hidden rounded-2xl"
            style={{
              border: `1px solid ${isClean ? 'rgba(34,197,94,0.15)' : allSelected ? `${color.text}20` : 'var(--border-default)'}`,
              opacity: fixing ? 0.5 : 1,
              pointerEvents: fixing ? 'none' : 'auto',
            }}
          >
            {/* Card header */}
            <div
              className="flex items-center gap-4 px-5 py-4"
              style={{ background: isClean ? 'rgba(34,197,94,0.03)' : allSelected ? color.bg : 'var(--bg-subtle)' }}
            >
              {/* Health ring or icon */}
              {hasPercentage || isClean ? (
                <HealthRing percent={healthPercent ?? 100} color={color.text} size={40} />
              ) : (
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: color.bg }}
                >
                  <Icon className="h-5 w-5" style={{ color: color.text }} strokeWidth={1.8} />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] font-semibold text-zinc-200">{t(card.titleKey)}</span>
                  {isClean ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                    >
                      {t('allClear')}
                    </span>
                  ) : (
                    <>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                      >
                        {issueCount !== 1
                          ? t('issueCountPlural', { count: issueCount })
                          : t('issueCount', { count: issueCount })}
                      </span>
                      {highRiskCount > 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                        >
                          {t('highRisk', { count: highRiskCount })}
                        </span>
                      )}
                      {mediumRiskCount > 0 && highRiskCount === 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
                        >
                          {t('mediumRisk', { count: mediumRiskCount })}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  {t(card.descriptionKey)}
                  {hasPercentage && !isClean && (
                    <span
                      style={{
                        color: healthPercent! >= 80 ? '#22c55e' : healthPercent! >= 50 ? '#f59e0b' : '#ef4444',
                      }}
                    >
                      {' '}
                      — {t('checksPassed', { passed: card.totalChecks! - issueCount, total: card.totalChecks! })}
                    </span>
                  )}
                </p>
              </div>

              {/* Toggle + Expand */}
              {!isClean && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleCardAll(card.types)}
                    className="relative h-6 w-11 rounded-full transition-colors"
                    style={{ background: allSelected ? color.text : 'var(--bg-active)' }}
                  >
                    <div
                      className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
                      style={{
                        left: allSelected ? '22px' : '2px',
                        background: allSelected ? '#fff' : 'var(--text-secondary)',
                      }}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleCardExpand(cardIndex)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
                    style={{ background: 'var(--bg-subtle-2)' }}
                  >
                    <ChevronDown
                      className="h-4 w-4 transition-transform"
                      style={{
                        color: 'var(--text-secondary)',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                      strokeWidth={2}
                    />
                  </button>
                </div>
              )}

              {/* Green check for clean cards */}
              {isClean && (
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'rgba(34,197,94,0.1)' }}
                >
                  <Check className="h-4 w-4 text-green-500" strokeWidth={2.5} />
                </div>
              )}
            </div>

            {/* Expanded items */}
            {isExpanded && !isClean && (
              <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                {cardEntries.map((entry, i) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-4 px-5 py-3 transition-colors"
                    style={{
                      background: entry.selected ? color.bg.replace('0.1', '0.03') : 'transparent',
                      borderBottom: i < cardEntries.length - 1 ? '1px solid var(--bg-subtle)' : 'none',
                    }}
                  >
                    <div
                      className="w-6 cursor-pointer"
                      onClick={() => onToggleEntry(entry.id)}
                      onKeyDown={() => onToggleEntry(entry.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <Checkbox checked={entry.selected} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-zinc-300">{entry.issue}</p>
                      <p className="mt-0.5 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {entry.keyPath}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: typeColors[entry.type].bg, color: typeColors[entry.type].text }}
                    >
                      {t(typeKeyMap[entry.type])}
                    </span>
                    <span className="shrink-0 text-[11px] font-medium" style={{ color: riskColors[entry.risk] }}>
                      {t(riskKeyMap[entry.risk])}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
