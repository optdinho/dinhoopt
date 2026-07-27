import type { InstalledProgram, StartupSafetyRating } from '@shared/types'
import type { TFunction } from 'i18next'
import { CheckSquare, Clock, Loader2, Package, Square, Trash2, TriangleAlert } from 'lucide-react'
import { Fragment, memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '@/lib/utils'
import { useUninstallerStore } from '@/stores/uninstaller-store'
import { formatDate, formatLastUsed, isUnused, safetyIcon, safetyScoreColor } from './constants'

interface UninstallerProgramCardProps {
  prog: InstalledProgram
  uninstalling: boolean
  filterMode: string
  onUninstall: (prog: InstalledProgram) => void
}

const UninstallerProgramCard = memo(function UninstallerProgramCard({
  prog,
  uninstalling,
  onUninstall,
}: UninstallerProgramCardProps) {
  const { t } = useTranslation('uninstaller')
  const selectedIds = useUninstallerStore((s) => s.selectedIds)
  const expandedItemId = useUninstallerStore((s) => s.expandedItemId)
  const safetyRatings = useUninstallerStore((s) => s.safetyRatings)
  const safetyLoading = useUninstallerStore((s) => s.safetyLoading)

  const unused = isUnused(prog)
  const isSelected = selectedIds.has(prog.id)
  const rating = safetyRatings[prog.displayName]
  const isExpanded = expandedItemId === prog.id

  return (
    <Fragment>
      <div
        className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
        style={{
          background: isSelected ? 'var(--accent-muted-bg)' : unused ? 'rgba(245,158,11,0.03)' : 'var(--bg-subtle)',
          border: `1px solid ${isSelected ? 'var(--accent-muted-border)' : unused ? 'var(--accent-muted-bg)' : 'var(--border-subtle)'}`,
        }}
      >
        <button
          type="button"
          onClick={() => useUninstallerStore.getState().toggleSelected(prog.id)}
          disabled={uninstalling}
          className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30"
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
          ) : (
            <Square className="h-5 w-5" strokeWidth={1.8} />
          )}
        </button>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: unused ? 'rgba(245,158,11,0.1)' : 'rgba(139,92,246,0.1)' }}
        >
          {unused ? (
            <TriangleAlert className="h-5 w-5" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
          ) : (
            <Package className="h-5 w-5" style={{ color: '#a78bfa' }} strokeWidth={1.8} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[13px] font-medium text-zinc-200 truncate">{prog.displayName}</span>
            {prog.displayVersion && (
              <span
                className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
              >
                v{prog.displayVersion}
              </span>
            )}
            {unused && (
              <span
                className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
                style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-hover)' }}
              >
                {t('unusedBadge')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3">
            <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              {prog.publisher || t('unknownPublisher')}
              {prog.installDate ? ` — ${formatDate(prog.installDate)}` : ''}
            </p>
            {prog.lastUsed > 0 && (
              <span
                className="flex items-center gap-1 text-[10px] shrink-0"
                style={{ color: unused ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                <Clock className="h-3 w-3" strokeWidth={1.8} />
                {formatLastUsed(prog.lastUsed, t)}
              </span>
            )}
            {prog.lastUsed === 0 && (
              <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: 'var(--accent)' }}>
                <Clock className="h-3 w-3" strokeWidth={1.8} />
                {t('lastUsedNeverDetected')}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-4">
          {rating ? (
            <SafetyBadge rating={rating} isExpanded={isExpanded} progId={prog.id} t={t} />
          ) : (
            <SafetyBadgePending safetyLoading={safetyLoading} t={t} />
          )}
          <div className="text-right">
            <span className="text-[12px] font-medium text-zinc-400">{formatBytes(prog.estimatedSize)}</span>
          </div>
          <button
            type="button"
            onClick={() => onUninstall(prog)}
            disabled={uninstalling}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:bg-red-500/10 disabled:opacity-30"
            style={{ border: '1px solid rgba(239,68,68,0.15)' }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('uninstallButton')}
          </button>
        </div>
      </div>

      {isExpanded && rating && <SafetyDetailPanel rating={rating} t={t} />}
    </Fragment>
  )
})

export { UninstallerProgramCard }

function SafetyBadge({
  rating,
  isExpanded,
  progId,
  t,
}: {
  rating: StartupSafetyRating
  isExpanded: boolean
  progId: string
  t: TFunction<'uninstaller'>
}) {
  const colors = safetyScoreColor(rating.safetyScore)
  const Icon = safetyIcon(rating.safetyScore)
  const tooltipKey =
    rating.safetyScore >= 8
      ? 'safetyTooltipSafe'
      : rating.safetyScore >= 5
        ? 'safetyTooltipCaution'
        : rating.safetyScore >= 3
          ? 'safetyTooltipWarning'
          : 'safetyTooltipDanger'

  return (
    <SafetyTooltip text={t(tooltipKey)}>
      <button
        type="button"
        onClick={() => useUninstallerStore.getState().setExpandedItemId(isExpanded ? null : progId)}
        className="flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:scale-110"
        style={{ background: colors.bg }}
      >
        <Icon className="h-4.5 w-4.5" style={{ color: colors.text }} strokeWidth={1.8} />
      </button>
    </SafetyTooltip>
  )
}

function SafetyBadgePending({ safetyLoading, t }: { safetyLoading: boolean; t: TFunction<'uninstaller'> }) {
  return (
    <SafetyTooltip text={t(safetyLoading ? 'safetyTooltipPending' : 'safetyPending')}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-hover)' }}>
        {safetyLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
        ) : (
          <div className="h-4.5 w-4.5" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        )}
      </div>
    </SafetyTooltip>
  )
}

function SafetyDetailPanel({ rating, t }: { rating: StartupSafetyRating; t: TFunction<'uninstaller'> }) {
  const colors = safetyScoreColor(rating.safetyScore)
  const DetailIcon = safetyIcon(rating.safetyScore)

  return (
    <div
      className="flex items-start gap-3 rounded-2xl px-5 py-4 -mt-1 animate-fade-in"
      style={{ background: colors.bg, border: `1px solid ${colors.text}22` }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${colors.text}20` }}
      >
        <DetailIcon className="h-5 w-5" style={{ color: colors.text }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: colors.text }}>
          {t('safetyScore', { score: rating.safetyScore })}
        </p>
        {rating.description && <p className="mt-1 text-[12px] text-zinc-300 leading-relaxed">{rating.description}</p>}
        {rating.analyzedAt && (
          <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {t('safetyAnalyzed', { date: new Date(rating.analyzedAt).toLocaleDateString() })}
          </p>
        )}
      </div>
    </div>
  )
}

function SafetyTooltip({ children, text }: { children: React.ReactNode; text: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-medium pointer-events-none z-50 shadow-lg"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          {text}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid var(--border-strong)',
            }}
          />
        </div>
      )}
    </div>
  )
}
