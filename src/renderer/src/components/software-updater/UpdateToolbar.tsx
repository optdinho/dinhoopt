import { ArrowUpDown, CheckCircle2, ChevronDown, Filter, Loader2, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FILTER_LABEL_KEYS, SORT_LABEL_KEYS } from './constants'

export function UpdateToolbar({
  loading,
  hasChecked,
  appsCount,
  upToDateCount = 0,
  platform,
  windowsPackageManager,
  searchQuery,
  sortField,
  sortDirection,
  severityFilter,
  showSortMenu,
  showFilterMenu,
  filterMenuRef,
  sortMenuRef,
  isBusy,
  onCheck,
  onPackageManagerChange,
  onSearchChange,
  onSeverityFilterChange,
  onSortChange,
  onToggleSortMenu,
  onToggleFilterMenu,
}: {
  loading: boolean
  hasChecked: boolean
  appsCount: number
  upToDateCount?: number
  platform: string
  windowsPackageManager: string | undefined
  packageManagerName: string | undefined
  searchQuery: string
  sortField: string
  sortDirection: string
  severityFilter: string
  showSortMenu: boolean
  showFilterMenu: boolean
  filterMenuRef: React.RefObject<HTMLDivElement | null>
  sortMenuRef: React.RefObject<HTMLDivElement | null>
  isBusy: boolean
  onCheck: () => void
  onPackageManagerChange: (value: 'winget' | 'choco' | 'scoop') => void
  onSearchChange: (value: string) => void
  onSeverityFilterChange: (value: string) => void
  onSortChange: (field: string, direction: string) => void
  onToggleSortMenu: () => void
  onToggleFilterMenu: () => void
}) {
  const { t } = useTranslation('updates')

  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        type="button"
        onClick={onCheck}
        disabled={isBusy}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
        style={{
          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          color: 'var(--text-on-accent)',
        }}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <RefreshCw className="h-4 w-4" strokeWidth={2} />
        )}
        {loading
          ? t('softwareUpdater.checkingButton')
          : hasChecked
            ? t('softwareUpdater.recheckButton')
            : t('softwareUpdater.checkForUpdatesButton')}
      </button>

      {platform === 'win32' && (
        <select
          value={windowsPackageManager ?? 'winget'}
          onChange={(e) => onPackageManagerChange(e.target.value as 'winget' | 'choco' | 'scoop')}
          disabled={isBusy}
          aria-label={t('softwareUpdater.packageManagerLabel')}
          className="rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 outline-none transition-all disabled:opacity-40"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-medium)',
          }}
        >
          <option value="winget">winget</option>
          <option value="choco">Chocolatey</option>
          <option value="scoop">Scoop</option>
        </select>
      )}

      {hasChecked && (appsCount > 0 || upToDateCount > 0) && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-2.5"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border-medium)',
          }}
        >
          <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('softwareUpdater.searchPlaceholder')}
            className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-48"
          />
        </div>
      )}

      {hasChecked && (appsCount > 0 || upToDateCount > 0) && (
        <div className="relative" ref={filterMenuRef}>
          <button
            type="button"
            onClick={onToggleFilterMenu}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-medium)',
            }}
          >
            <Filter className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t(FILTER_LABEL_KEYS[severityFilter] ?? 'filter.all')}
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
          {showFilterMenu && (
            <div
              className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
              style={{
                background: '#1e1e22',
                border: '1px solid var(--border-strong)',
                minWidth: 120,
              }}
            >
              {Object.entries(FILTER_LABEL_KEYS).map(([key, labelKey]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => onSeverityFilterChange(key)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                >
                  {t(labelKey)}
                  {severityFilter === key && (
                    <CheckCircle2 className="ml-auto h-3 w-3 text-amber-400" strokeWidth={2} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasChecked && (appsCount > 0 || upToDateCount > 0) && (
        <div className="relative" ref={sortMenuRef}>
          <button
            type="button"
            onClick={onToggleSortMenu}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-medium)',
            }}
          >
            <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t(SORT_LABEL_KEYS[sortField] ?? 'sort.name')}
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
          {showSortMenu && (
            <div
              className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
              style={{
                background: '#1e1e22',
                border: '1px solid var(--border-strong)',
                minWidth: 140,
              }}
            >
              {Object.entries(SORT_LABEL_KEYS).map(([field, labelKey]) => (
                <button
                  type="button"
                  key={field}
                  onClick={() => {
                    const newDir = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc'
                    onSortChange(field, newDir)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                >
                  {t(labelKey)}
                  {sortField === field && (
                    <span className="ml-auto text-amber-400 text-[10px]">
                      {sortDirection === 'asc' ? t('softwareUpdater.sortAsc') : t('softwareUpdater.sortDesc')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
