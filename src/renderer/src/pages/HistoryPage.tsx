import { OverviewView } from '@/components/history/OverviewView'
import { TimelineView } from '@/components/history/TimelineView'
import type { ViewMode } from '@/components/history/constants'
import { useTypeConfig } from '@/components/history/useTypeConfig'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { useHistoryStore } from '@/stores/history-store'
import { History, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function HistoryPage() {
  const { t } = useTranslation('history')
  const typeConfig = useTypeConfig()
  const { entries, loaded, load, clear } = useHistoryStore()
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('overview')
  const [typeFilter, setTypeFilter] = useState<'all' | import('@shared/types').ScanHistoryEntry['type']>('all')

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () => (typeFilter === 'all' ? entries : entries.filter((e) => e.type === typeFilter)),
    [entries, typeFilter],
  )

  const stats = useMemo(() => {
    const totalSpace = entries.reduce((s, e) => s + e.totalSpaceSaved, 0)
    const totalItems = entries.reduce((s, e) => s + e.totalItemsCleaned, 0)
    const totalErrors = entries.reduce((s, e) => s + e.errorCount, 0)
    const avgDuration = entries.length > 0 ? entries.reduce((s, e) => s + e.duration, 0) / entries.length : 0
    return { totalSpace, totalItems, totalErrors, avgDuration, totalScans: entries.length }
  }, [entries])

  const timelineData = useMemo(() => {
    const byDay: Record<string, { space: number; items: number }> = {}
    for (const e of filtered) {
      const key = new Date(e.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      if (!byDay[key]) byDay[key] = { space: 0, items: 0 }
      byDay[key].space += e.totalSpaceSaved
      byDay[key].items += e.totalItemsCleaned
    }
    return Object.entries(byDay)
      .slice(0, 30)
      .reverse()
      .map(([date, d]) => ({ date, space: d.space, items: d.items }))
  }, [filtered])

  const typeBreakdown = useMemo(() => {
    const byType: Record<string, { count: number; space: number; items: number }> = {}
    for (const e of entries) {
      const label = typeConfig[e.type].label
      if (!byType[label]) byType[label] = { count: 0, space: 0, items: 0 }
      byType[label].count++
      byType[label].space += e.totalSpaceSaved
      byType[label].items += e.totalItemsCleaned
    }
    return Object.entries(byType).map(([name, d]) => ({ name, ...d }))
  }, [entries, typeConfig])

  const categoryBreakdown = useMemo(() => {
    const byCategory: Record<string, { items: number; space: number }> = {}
    for (const e of entries) {
      for (const c of e.categories) {
        if (!byCategory[c.name]) byCategory[c.name] = { items: 0, space: 0 }
        const cat = byCategory[c.name]
        if (cat) {
          cat.items += c.itemsCleaned
          cat.space += c.spaceSaved
        }
      }
    }
    return Object.entries(byCategory)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.space - a.space || b.items - a.items)
      .slice(0, 8)
  }, [entries])

  const weeklyData = useMemo(() => {
    const weeks: Record<string, { space: number; items: number; count: number }> = {}
    for (const e of entries) {
      const d = new Date(e.timestamp)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      if (!weeks[key]) weeks[key] = { space: 0, items: 0, count: 0 }
      weeks[key].space += e.totalSpaceSaved
      weeks[key].items += e.totalItemsCleaned
      weeks[key].count++
    }
    return Object.entries(weeks)
      .slice(0, 12)
      .reverse()
      .map(([week, d]) => ({ week, ...d }))
  }, [entries])

  if (!loaded) return null

  if (entries.length === 0) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
        <EmptyState icon={History} title={t('emptyStateTitle')} description={t('emptyStateDescription')} />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-medium)' }}>
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="px-4 py-2 text-[12px] font-medium transition-colors"
                style={{
                  background: viewMode === 'overview' ? 'var(--accent-muted-bg)' : 'var(--bg-subtle)',
                  color: viewMode === 'overview' ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {t('viewOverview')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('timeline')}
                className="px-4 py-2 text-[12px] font-medium transition-colors"
                style={{
                  background: viewMode === 'timeline' ? 'var(--accent-muted-bg)' : 'var(--bg-subtle)',
                  color: viewMode === 'timeline' ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {t('viewTimeline')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-500 transition-all hover:text-zinc-300"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('clearButton')}
            </button>
          </div>
        }
      />

      {viewMode === 'overview' ? (
        <OverviewView
          stats={stats}
          timelineData={timelineData}
          typeBreakdown={typeBreakdown}
          categoryBreakdown={categoryBreakdown}
          weeklyData={weeklyData}
          entries={entries}
        />
      ) : viewMode === 'timeline' ? (
        <TimelineView
          entries={filtered}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          selectedEntry={selectedEntry}
          setSelectedEntry={setSelectedEntry}
          typeConfig={typeConfig}
        />
      ) : null}

      <ConfirmDialog
        open={showClearConfirm}
        onConfirm={() => {
          clear()
          setShowClearConfirm(false)
        }}
        onCancel={() => setShowClearConfirm(false)}
        title={t('confirmClearScanTitle')}
        description={t('confirmClearScanDescription')}
        confirmLabel={t('confirmClearLabel')}
        variant="danger"
      />
    </div>
  )
}
