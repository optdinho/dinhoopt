import { useUninstallerStore } from '@/stores/uninstaller-store'
import { AlertTriangle, ArrowUpDown, ChevronDown, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SORT_LABEL_KEYS } from './constants'

interface UninstallerToolbarProps {
  loading: boolean
  isBusy: boolean
  hasPrefetchData: boolean
  handleLoad: () => void
  onBatchUninstallClick: () => void
}

const popoverStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-medium)',
}

export function UninstallerToolbar({
  loading,
  isBusy,
  hasPrefetchData,
  handleLoad,
  onBatchUninstallClick,
}: UninstallerToolbarProps) {
  const { t } = useTranslation('uninstaller')
  const hasLoaded = useUninstallerStore((s) => s.hasLoaded)
  const filterMode = useUninstallerStore((s) => s.filterMode)
  const programs = useUninstallerStore((s) => s.programs)
  const searchQuery = useUninstallerStore((s) => s.searchQuery)
  const sortField = useUninstallerStore((s) => s.sortField)
  const sortDirection = useUninstallerStore((s) => s.sortDirection)
  const selectedIds = useUninstallerStore((s) => s.selectedIds)
  const uninstalling = useUninstallerStore((s) => s.uninstalling)
  const unusedPrograms = programs.filter((p) => {
    if (p.lastUsed === -1) return false
    if (p.lastUsed === 0) return true
    const UNUSED_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000
    return Date.now() - p.lastUsed > UNUSED_THRESHOLD_MS
  })

  const [showSortMenu, setShowSortMenu] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showSortMenu) return
    const handler = (e: globalThis.MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu])

  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        type="button"
        onClick={handleLoad}
        disabled={isBusy}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
        )}
        {loading ? t('loading') : hasLoaded ? t('refresh') : t('loadPrograms')}
      </button>

      {hasLoaded && hasPrefetchData && (
        <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-medium)' }}>
          <button
            type="button"
            onClick={() => useUninstallerStore.getState().setFilterMode('all')}
            className="px-4 py-2.5 text-[12px] font-medium transition-colors"
            style={{
              background: filterMode === 'all' ? 'var(--bg-active)' : 'var(--bg-subtle)',
              color: filterMode === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {t('filterAll', { count: programs.length })}
          </button>
          <button
            type="button"
            onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors"
            style={{
              background: filterMode === 'unused' ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle)',
              color: filterMode === 'unused' ? 'var(--accent-hover)' : 'var(--text-muted)',
              borderLeft: '1px solid var(--border-medium)',
            }}
          >
            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
            {t('filterUnused', { count: unusedPrograms.length })}
          </button>
        </div>
      )}

      {hasLoaded && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-2.5"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => useUninstallerStore.getState().setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-48"
          />
        </div>
      )}

      {hasLoaded && (
        <div className="relative" ref={sortMenuRef}>
          <button
            type="button"
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
          >
            <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t(SORT_LABEL_KEYS[sortField] ?? 'sort.name')}
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
          {showSortMenu && (
            <div className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl" style={popoverStyle}>
              {Object.entries(SORT_LABEL_KEYS).map(([field, labelKey]) => (
                <button
                  type="button"
                  key={field}
                  onClick={() => {
                    const store = useUninstallerStore.getState()
                    if (sortField === field) {
                      store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                    } else {
                      // biome-ignore lint/suspicious/noExplicitAny: field is a string key
                      store.setSortField(field as any)
                      store.setSortDirection(field === 'estimatedSize' ? 'desc' : 'asc')
                    }
                    setShowSortMenu(false)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                >
                  {t(labelKey)}
                  {sortField === field && (
                    <span className="ml-auto text-amber-400 text-[10px]">
                      {sortDirection === 'asc' ? t('sortAscending') : t('sortDescending')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasLoaded && selectedIds.size > 0 && (
        <button
          type="button"
          onClick={onBatchUninstallClick}
          disabled={uninstalling}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-red-400 transition-all disabled:opacity-30"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          {t('uninstallSelected', { count: selectedIds.size })}
        </button>
      )}
    </div>
  )
}
