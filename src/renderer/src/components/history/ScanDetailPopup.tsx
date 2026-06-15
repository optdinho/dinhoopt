import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { formatBytes } from '@/lib/utils'
import type { ScanHistoryEntry } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Clock, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DetailStat } from './DetailStat'
import { PIE_COLORS } from './constants'
import { formatDuration } from './formatDuration'
import { useTypeConfig } from './useTypeConfig'

export function ScanDetailPopup({ entry, onClose }: { entry: ScanHistoryEntry | null; onClose: () => void }) {
  const { t } = useTranslation('history')
  const typeConfig = useTypeConfig()

  return (
    <AnimatePresence>
      {entry && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            onClick={onClose}
            onKeyDown={() => {}}
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
            {(() => {
              const config = typeConfig[entry.type]
              const Icon = config.icon
              return (
                <>
                  {/* Header */}
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
                        {new Date(entry.timestamp).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
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
                      <XCircle className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>

                  {/* Stats grid */}
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

                  {/* Duration & errors */}
                  <div className="mb-5 flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      <Clock className="h-3.5 w-3.5" strokeWidth={1.6} />
                      {formatDuration(entry.duration, t)}
                    </div>
                    {entry.errorCount > 0 && (
                      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#ef4444' }}>
                        <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {entry.errorCount !== 1
                          ? t('detail.errorCountPlural', { count: entry.errorCount })
                          : t('detail.errorCount', { count: entry.errorCount })}
                      </div>
                    )}
                  </div>

                  {/* Category breakdown */}
                  {entry.categories.length > 0 && (
                    <div>
                      <h4
                        className="mb-3 text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {t('detail.categoriesLabel')}
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                        {entry.categories.map((cat, i) => {
                          const maxItems = Math.max(...entry.categories.map((c) => c.itemsCleaned), 1)
                          const percent = (cat.itemsCleaned / maxItems) * 100
                          return (
                            <div key={cat.name} className="flex items-center gap-3">
                              <span className="w-24 shrink-0 truncate text-[12px] capitalize text-zinc-400">
                                {cat.name}
                              </span>
                              <div
                                className="flex-1 h-[6px] rounded-full overflow-hidden"
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
                </>
              )
            })()}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
