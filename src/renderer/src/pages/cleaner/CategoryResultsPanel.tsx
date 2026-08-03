import type { CleanerType } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn, formatBytes, formatNumber } from '@/lib/utils'
import { useScanStore } from '@/stores/scan-store'
import { categories, isAbsolutePath } from './CleanerPageConstants'

export function CategoryResultsPanel({
  activeCategory,
  expandedGroups,
  toggleGroup,
  toggleSubcategorySelection,
}: {
  activeCategory: CleanerType
  expandedGroups: Set<string>
  toggleGroup: (key: string) => void
  toggleSubcategorySelection: (result: ScanResult) => void
}) {
  const { t } = useTranslation('cleaner')
  const store = useScanStore()

  const categoryResults = (type: CleanerType) => store.results.filter((r) => r.category === type)

  const results = categoryResults(activeCategory)
  const ungrouped = results.filter((r) => !r.group)
  const grouped = new Map<string, ScanResult[]>()
  for (const r of results) {
    if (!r.group) continue
    if (!grouped.has(r.group)) grouped.set(r.group, [])
    grouped.get(r.group)!.push(r)
  }

  const sections: { label?: string; items: ScanResult[] }[] = []
  if (ungrouped.length > 0) sections.push({ items: ungrouped })
  for (const [label, items] of grouped) sections.push({ label, items })

  return (
    <div key={activeCategory} className="space-y-2">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('categoryItemsHeading', {
            category: t(categories.find((c) => c.type === activeCategory)?.labelKey ?? ''),
          })}
        </span>
        <button
          type="button"
          onClick={() => store.toggleCategory(activeCategory)}
          className="text-[12px] font-medium text-amber-500 hover:text-amber-400"
        >
          {t('toggleAll')}
        </button>
      </div>

      {results.length === 0 && (
        <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('noItemsInCategory')}
        </div>
      )}

      {sections.map((section) => (
        <div key={section.label || '_ungrouped'}>
          {section.label && (
            <div className="mt-4 mb-2 flex items-center gap-2 px-1">
              <span
                className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-secondary)' }}
              >
                {section.label}
              </span>
              <div className="flex-1 h-px" style={{ background: 'var(--bg-hover-2)' }} />
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {formatBytes(section.items.reduce((s, r) => s + r.totalSize, 0))}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            {section.items.map((result) => {
              const groupKey = `${result.category}:${result.subcategory}`
              const isExpanded = expandedGroups.has(groupKey)
              const selectedInGroup = result.items.filter((item) => store.selectedItems.has(item.id)).length
              const allSelected = selectedInGroup === result.items.length
              const someSelected = selectedInGroup > 0 && !allSelected

              return (
                <div
                  key={result.subcategory}
                  className="rounded-xl overflow-hidden"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
                >
                  {/* Group header */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3.5 cursor-pointer"
                    onClick={() => toggleGroup(groupKey)}
                    style={{ background: 'transparent', border: 'none', textAlign: 'left' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-subtle)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {/* Checkbox */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSubcategorySelection(result)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          toggleSubcategorySelection(result)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className="flex items-center"
                    >
                      <div
                        className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] cursor-pointer"
                        style={{
                          background: allSelected || someSelected ? 'var(--accent)' : 'var(--bg-hover-2)',
                          border: allSelected || someSelected ? 'none' : '1.5px solid var(--border-stronger)',
                        }}
                      >
                        {allSelected && (
                          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                            <title>{t('checkmark')}</title>
                            <path
                              d="M2.5 6l2.5 2.5 4.5-5"
                              stroke="var(--text-on-accent)"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                        {someSelected && (
                          <div className="h-[2px] w-2 rounded-full" style={{ background: 'var(--text-on-accent)' }} />
                        )}
                      </div>
                    </span>

                    {/* Expand arrow */}
                    <ChevronRight
                      className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isExpanded && 'rotate-90')}
                      style={{ color: 'var(--text-muted)' }}
                      strokeWidth={2}
                    />

                    {/* Folder icon */}
                    <Folder
                      className="h-4 w-4 shrink-0"
                      style={{ color: allSelected ? 'var(--accent)' : 'var(--text-muted)' }}
                      strokeWidth={1.8}
                    />

                    {/* Label */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-zinc-300">{result.subcategory}</span>
                    </div>

                    {/* Stats */}
                    <span
                      className="rounded-md px-2 py-0.5 font-mono text-[11px] shrink-0"
                      style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                    >
                      {t(result.itemCount === 1 ? 'itemCount' : 'itemCountPlural', {
                        count: formatNumber(result.itemCount),
                      })}
                    </span>
                    <span className="font-mono text-[12px] font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {formatBytes(result.totalSize)}
                    </span>

                    {/* Open location */}
                    {result.items.length > 0 && result.items[0] && isAbsolutePath(result.items[0].path) && (
                      <button
                        type="button"
                        title={t('openLocation')}
                        className="shrink-0 p-1 rounded transition-colors hover:bg-[var(--bg-hover-2)]"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (result.items[0]) window.dinho?.cleanerOpenLocation?.(result.items[0].path)
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                      </button>
                    )}
                  </button>

                  {/* Expanded item list */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      {result.items.slice(0, 50).map((item) => {
                        const checked = store.selectedItems.has(item.id)
                        const pathLabel = item.path.split(/[/\\]/).slice(-2).join('/') || item.path
                        return (
                          // biome-ignore lint/a11y/noStaticElementInteractions: hover-only highlight on a row whose real control is the nested Checkbox
                          <div
                            key={item.id}
                            className="flex items-center gap-3 px-4 py-2 pl-14 cursor-pointer transition-colors"
                            style={{ background: checked ? 'rgba(245,158,11,0.03)' : 'transparent' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.05)' : 'var(--bg-subtle)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.03)' : 'transparent'
                            }}
                          >
                            <Checkbox checked={checked} onChange={() => store.toggleItem(item.id)} size="sm" />
                            <span
                              className="flex-1 min-w-0 truncate text-[12px] font-mono"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              {pathLabel}
                            </span>
                            <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>
                              {formatBytes(item.size)}
                            </span>
                            {isAbsolutePath(item.path) && (
                              <button
                                type="button"
                                title={t('openLocation')}
                                className="shrink-0 p-0.5 rounded transition-colors hover:bg-[var(--bg-hover-2)]"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  window.dinho?.cleanerOpenLocation?.(item.path)
                                }}
                              >
                                <FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                      {result.items.length > 50 && (
                        <div className="px-4 py-2.5 pl-14 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {t('moreItems', { count: formatNumber(result.items.length - 50) })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
