import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { usePlatform } from '@/hooks/usePlatform'
import { formatBytes } from '@/lib/utils'
import type { HistoryEntryType, ScanHistoryEntry } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheckBig, Clock, Info, CircleX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DetailStat } from './DetailStat'
import { PIE_COLORS } from './constants'
import { formatDuration } from './formatDuration'

export function TimelineView({
  entries,
  typeFilter,
  setTypeFilter,
  selectedEntry,
  setSelectedEntry,
  typeConfig,
}: {
  entries: ScanHistoryEntry[]
  typeFilter: 'all' | ScanHistoryEntry['type']
  setTypeFilter: (f: 'all' | ScanHistoryEntry['type']) => void
  selectedEntry: string | null
  setSelectedEntry: (id: string | null) => void
  typeConfig: Record<HistoryEntryType, { label: string; icon: LucideIcon; color: string; bg: string }>
}) {
  const { t } = useTranslation('history')
  const { features } = usePlatform()
  const filters: { label: string; value: 'all' | ScanHistoryEntry['type'] }[] = [
    { label: t('timeline.filterAll'), value: 'all' },
    { label: t('timeline.filterCleaner'), value: 'cleaner' },
    ...(features.registry ? [{ label: t('timeline.filterRegistry'), value: 'registry' as const }] : []),
    ...(features.debloater ? [{ label: t('timeline.filterDebloater'), value: 'debloater' as const }] : []),
    { label: t('timeline.filterNetwork'), value: 'network' },
    ...(features.drivers ? [{ label: t('timeline.filterDrivers'), value: 'drivers' as const }] : []),
    { label: t('timeline.filterMalware'), value: 'malware' },
    { label: t('timeline.filterPrivacy'), value: 'privacy' },
    { label: t('timeline.filterStartup'), value: 'startup' },
    { label: t('timeline.filterServices'), value: 'services' },
    { label: t('timeline.filterUpdates'), value: 'software-update' },
  ]

  const detail = entries.find((e) => e.id === selectedEntry) ?? null

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        {filters.map((f) => (
          <button
            type="button"
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: typeFilter === f.value ? 'var(--accent-muted-bg)' : 'var(--bg-subtle-2)',
              color: typeFilter === f.value ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {t('timeline.entriesCount', { count: entries.length })}
        </span>
      </div>

      <div
        className="overflow-hidden rounded-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-medium)' }}>
              <th
                className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('timeline.columnType')}
              </th>
              <th
                className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('timeline.columnDate')}
              </th>
              <th
                className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('timeline.columnItems')}
              </th>
              <th
                className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('timeline.columnSpace')}
              </th>
              <th
                className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('timeline.columnDuration')}
              </th>
              <th
                className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('timeline.columnStatus')}
              </th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const config = typeConfig[entry.type]
              const Icon = config.icon
              return (
                <tr
                  key={entry.id}
                  className="cursor-pointer transition-colors hover:bg-white/[0.04]"
                  style={{ borderBottom: '1px solid var(--bg-subtle)' }}
                  onClick={() => setSelectedEntry(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedEntry(entry.id)
                  }}
                  tabIndex={0}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: config.bg }}
                      >
                        <Icon className="h-3.5 w-3.5" style={{ color: config.color }} strokeWidth={1.8} />
                      </div>
                      <span className="text-[12.5px] font-medium text-zinc-200">{config.label}</span>
                      {entry.scheduled && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                          style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}
                        >
                          {t('timeline.scheduledBadge')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {new Date(entry.timestamp).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>
                      {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-zinc-300">
                    {entry.totalItemsCleaned.toLocaleString()}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-mono text-[12px]"
                    style={{ color: entry.totalSpaceSaved > 0 ? '#22c55e' : 'var(--text-muted)' }}
                  >
                    {entry.totalSpaceSaved > 0 ? formatBytes(entry.totalSpaceSaved) : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {formatDuration(entry.duration, t)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {entry.errorCount > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                      >
                        <CircleAlert className="h-3 w-3" strokeWidth={2} />
                        {entry.errorCount}
                      </span>
                    ) : (
                      <CircleCheckBig className="inline h-4 w-4" style={{ color: '#22c55e' }} strokeWidth={1.8} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Info className="inline h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {entries.length === 0 && (
          <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {t('timeline.noEntriesMatchFilter')}
          </div>
        )}
      </div>

      {detail && <ScanDetailPopup entry={detail} typeConfig={typeConfig} onClose={() => setSelectedEntry(null)} />}
    </>
  )
}

function ScanDetailPopup({
  entry,
  typeConfig,
  onClose,
}: {
  entry: ScanHistoryEntry
  typeConfig: Record<HistoryEntryType, { label: string; icon: LucideIcon; color: string; bg: string }>
  onClose: () => void
}) {
  const { t } = useTranslation('history')
  const config = typeConfig[entry.type]
  const Icon = config.icon

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <motion.div
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
          onClick={onClose}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        />
        <motion.div
          className="relative w-full max-w-lg rounded-2xl p-6"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-medium)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          }}
          initial={{ opacity: 0, scale: 0.92, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 10 }}
          transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
        >
          <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: config.bg }}
            >
              <Icon className="h-5 w-5" style={{ color: config.color }} strokeWidth={1.8} />
            </div>
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-white">{config.label}</h3>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {new Date(entry.timestamp).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {` ${t('timeline.dateAt')} `}
                {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                {entry.scheduled && (
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}
                  >
                    {t('detail.scheduledBadge')}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.04]"
              style={{ color: 'var(--text-muted)' }}
            >
              <CircleX className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>

          <StaggerContainer className="mb-5 grid grid-cols-4 gap-2.5">
            <StaggerItem>
              <DetailStat label={t('detail.statFound')} value={entry.totalItemsFound.toLocaleString()} />
            </StaggerItem>
            <StaggerItem>
              <DetailStat label={t('detail.statProcessed')} value={entry.totalItemsCleaned.toLocaleString()} />
            </StaggerItem>
            <StaggerItem>
              <DetailStat label={t('detail.statSkipped')} value={entry.totalItemsSkipped.toLocaleString()} />
            </StaggerItem>
            <StaggerItem>
              <DetailStat
                label={t('detail.statSpaceSaved')}
                value={entry.totalSpaceSaved > 0 ? formatBytes(entry.totalSpaceSaved) : '\u2014'}
              />
            </StaggerItem>
          </StaggerContainer>

          <div className="mb-5 flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <Clock className="h-3.5 w-3.5" strokeWidth={1.6} />
              {formatDuration(entry.duration, t)}
            </div>
            {entry.errorCount > 0 && (
              <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#ef4444' }}>
                <CircleAlert className="h-3.5 w-3.5" strokeWidth={1.8} />
                {entry.errorCount !== 1
                  ? t('detail.errorCountPlural', { count: entry.errorCount })
                  : t('detail.errorCount', { count: entry.errorCount })}
              </div>
            )}
          </div>

          {entry.categories.length > 0 && (
            <div>
              <h4
                className="mb-3 text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('detail.categoriesLabel')}
              </h4>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {entry.categories.map((cat, i) => {
                  const maxItems = Math.max(...entry.categories.map((c) => c.itemsCleaned), 1)
                  const percent = (cat.itemsCleaned / maxItems) * 100
                  return (
                    <div key={cat.name} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-[12px] capitalize text-zinc-400">{cat.name}</span>
                      <div
                        className="h-[6px] flex-1 overflow-hidden rounded-full"
                        style={{ background: 'var(--bg-subtle-2)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percent}%`,
                            background: PIE_COLORS[i % PIE_COLORS.length],
                            opacity: 0.8,
                          }}
                        />
                      </div>
                      <span
                        className="w-14 shrink-0 text-right font-mono text-[11px]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {cat.itemsCleaned}
                      </span>
                      {cat.spaceSaved > 0 && (
                        <span
                          className="w-18 shrink-0 text-right font-mono text-[11px]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {formatBytes(cat.spaceSaved)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
