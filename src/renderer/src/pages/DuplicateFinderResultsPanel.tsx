import type { DuplicateScanResult } from '@shared/types'
import { ChevronDown, ChevronRight, FolderOpen, RotateCcw, Shield, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatBytes, formatDuration } from '@/lib/utils'
import { StatCard } from './DuplicateFinderConstants'

interface DuplicateStore {
  result: DuplicateScanResult | null
  selectedPaths: Set<string>
  deleteMode: 'recycle' | 'permanent'
  togglePath: (path: string) => void
  selectAllDuplicates: () => void
  deselectAll: () => void
  setDeleteMode: (mode: 'recycle' | 'permanent') => void
  reset: () => void
}

interface ResultsPanelProps {
  store: DuplicateStore
  selectedCount: number
  selectedSize: number
  expandedGroups: Set<string>
  setExpandedGroups: Dispatch<SetStateAction<Set<string>>>
  setShowConfirm: (v: boolean) => void
}

export function ResultsPanel({
  store,
  selectedCount,
  selectedSize,
  expandedGroups,
  setExpandedGroups,
  setShowConfirm,
}: ResultsPanelProps) {
  const { t } = useTranslation('duplicates')

  const toggleGroup = (hash: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  if (!store.result) return null

  return (
    <>
      {/* Cancelled banner */}
      {store.result.cancelled && (
        <div
          className="mb-4 rounded-xl px-4 py-2.5 text-[13px] font-medium"
          style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
        >
          {t('scanCancelled')}
        </div>
      )}

      {/* Summary stats */}
      <div className="mb-5 grid grid-cols-4 gap-3">
        <StatCard label={t('duplicatesFound')} value={store.result.totalDuplicates.toLocaleString()} />
        <StatCard label={t('reclaimableSpace')} value={formatBytes(store.result.totalReclaimable)} accent />
        <StatCard label={t('filesScanned')} value={store.result.totalFilesScanned.toLocaleString()} />
        <StatCard label={t('duration')} value={formatDuration(store.result.duration)} />
      </div>

      {store.result.groups.length > 0 ? (
        <>
          {/* Action bar */}
          <div className="mb-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (selectedCount > 0) store.deselectAll()
                else store.selectAllDuplicates()
              }}
              className="rounded-xl px-4 py-2 text-[12px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              style={{ background: 'var(--bg-subtle-2)' }}
            >
              {selectedCount > 0 ? t('deselectAll') : t('selectAllDuplicates')}
            </button>

            {/* Delete mode toggle */}
            <div className="flex overflow-hidden rounded-lg" style={{ background: 'var(--bg-subtle-2)' }}>
              <button
                type="button"
                onClick={() => store.setDeleteMode('recycle')}
                className={cn(
                  'px-3 py-1.5 text-[12px] font-medium transition-colors',
                  store.deleteMode === 'recycle' ? 'text-amber-400' : 'text-zinc-500',
                )}
                style={store.deleteMode === 'recycle' ? { background: 'rgba(245,158,11,0.1)' } : undefined}
              >
                {t('recycleBin')}
              </button>
              <button
                type="button"
                onClick={() => store.setDeleteMode('permanent')}
                className={cn(
                  'px-3 py-1.5 text-[12px] font-medium transition-colors',
                  store.deleteMode === 'permanent' ? 'text-red-400' : 'text-zinc-500',
                )}
                style={store.deleteMode === 'permanent' ? { background: 'rgba(239,68,68,0.1)' } : undefined}
              >
                {t('permanentDelete')}
              </button>
            </div>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => store.reset()}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
              style={{ background: 'var(--bg-subtle-2)' }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('scanAgain')}
            </button>

            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className="flex items-center gap-2 rounded-xl px-5 py-2 text-[13px] font-semibold transition-colors"
                style={{
                  background: store.deleteMode === 'permanent' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                  color: store.deleteMode === 'permanent' ? '#ef4444' : '#f59e0b',
                }}
              >
                <Trash2 className="h-4 w-4" />
                {t('deleteSelected', { count: selectedCount, size: formatBytes(selectedSize) })}
              </button>
            )}
          </div>

          {/* Duplicate groups */}
          <div className="space-y-2">
            {store.result.groups.map((group) => {
              const isExpanded = expandedGroups.has(group.fullHash)
              const sorted = [...group.files].sort((a, b) => a.path.length - b.path.length)
              const groupSelected = group.files.filter((f) => store.selectedPaths.has(f.path)).length

              return (
                <div
                  key={group.fullHash}
                  className="overflow-hidden rounded-xl"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
                >
                  {/* Group header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.fullHash)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] font-medium text-white">
                        {t('groupHeader', { size: formatBytes(group.fileSize), count: group.files.length })}
                      </span>
                    </div>
                    {groupSelected > 0 && (
                      <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                        {groupSelected} selected
                      </span>
                    )}
                    <span className="text-[12px] font-medium" style={{ color: '#22c55e' }}>
                      {formatBytes(group.reclaimableSpace)}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                    >
                      {group.hash}
                    </span>
                  </button>

                  {/* Expanded file list */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      {sorted.map((file, idx) => {
                        const isKept = idx === 0 && !store.selectedPaths.has(file.path)
                        return (
                          <div
                            key={file.path}
                            className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-white/[0.02]"
                            style={idx > 0 ? { borderTop: '1px solid var(--bg-subtle)' } : undefined}
                          >
                            <Checkbox
                              checked={store.selectedPaths.has(file.path)}
                              onChange={() => store.togglePath(file.path)}
                              size="sm"
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-[12px]"
                              style={{ color: 'var(--text-secondary)' }}
                              title={file.path}
                            >
                              {file.path}
                            </span>
                            {isKept && (
                              <span
                                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
                                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                              >
                                <Shield className="h-3 w-3" />
                                {t('original')}
                              </span>
                            )}
                            <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                              {new Date(file.lastModified).toLocaleDateString()}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                window.dinho?.duplicatesOpenLocation?.(file.path)
                              }}
                              className="shrink-0 text-zinc-600 hover:text-zinc-400"
                              title={t('openLocation')}
                            >
                              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <EmptyState icon={FolderOpen} title={t('emptyTitle')} description={t('emptyDescription')} />
      )}
    </>
  )
}
