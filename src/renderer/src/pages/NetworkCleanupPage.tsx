import { PageHeader } from '@/components/layout/PageHeader'
import { Checkbox } from '@/components/shared/Checkbox'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { useIpcAction } from '@/hooks/useIpcAction'
import { useIpcScan } from '@/hooks/useIpcScan'
import { usePlatform } from '@/hooks/usePlatform'
import { cn } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useNetworkStore } from '@/stores/network-store'
import { useStatsStore } from '@/stores/stats-store'
import type { NetworkItem, ProgressData } from '@shared/types'
import { CheckCircle2, Globe, History, Network, Search, Sparkles, Wifi } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type NetworkCategory = NetworkItem['type']

interface CategoryDef {
  type: NetworkCategory
  labelKey: string
  icon: LucideIcon
  descriptionKey: string
}

const categories: CategoryDef[] = [
  { type: 'dns-cache', labelKey: 'categoryDnsCache', icon: Globe, descriptionKey: 'categoryDnsCacheDesc' },
  { type: 'wifi-profile', labelKey: 'categoryWifiProfiles', icon: Wifi, descriptionKey: 'categoryWifiProfilesDesc' },
  { type: 'arp-cache', labelKey: 'categoryArpCache', icon: Network, descriptionKey: 'categoryArpCacheDesc' },
  {
    type: 'network-history',
    labelKey: 'categoryNetworkHistory',
    icon: History,
    descriptionKey: 'categoryNetworkHistoryDesc',
  },
]

export function NetworkCleanupPage() {
  const { t } = useTranslation('network')
  const { platform } = usePlatform()
  const visibleCategories = useMemo(
    () =>
      categories.filter((c) => {
        if (c.type === 'network-history' && platform !== 'win32') return false
        return true
      }),
    [platform],
  )
  const items = useNetworkStore((s) => s.items)
  const selectedIds = useNetworkStore((s) => s.selectedIds)
  const status = useNetworkStore((s) => s.status)
  const cleanResult = useNetworkStore((s) => s.cleanResult)
  const [activeCategory, setActiveCategory] = useState<NetworkCategory>('dns-cache')
  const [cleanProgress, setCleanProgress] = useState<ProgressData | null>(null)

  useEffect(() => {
    if (!window.dinho?.onScanProgress) return
    return window.dinho.onScanProgress((data) => {
      if (data.phase === 'cleaning' && data.category === 'network') {
        setCleanProgress(data)
      }
    })
  }, [])

  const [showConfirm, setShowConfirm] = useState(false)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const cleanStartRef = useRef(0)
  const scanGenRef = useRef(0)

  const { scan: handleScan } = useIpcScan({
    scanFn: () => {
      scanGenRef.current++
      return window.dinho.networkScan()
    },
    resetState: () => {
      const s = useNetworkStore.getState()
      s.setStatus('scanning')
      s.setItems([])
      s.setSelectedIds(new Set())
      s.setCleanResult(null)
    },
    onResult: (result) => {
      const s = useNetworkStore.getState()
      s.setItems(result)
      const preSelected = new Set(result.filter((i) => i.selected).map((i) => i.id))
      s.setSelectedIds(preSelected)
      s.setStatus('complete')
    },
    onError: () => {
      useNetworkStore.getState().setStatus('idle')
    },
  })

  const { execute: handleClean } = useIpcAction({
    actionFn: async () => {
      cleanStartRef.current = Date.now()
      const { selectedIds: currentSelectedIds, items: currentItems } = useNetworkStore.getState()
      const result = await window.dinho.networkClean([...currentSelectedIds])
      return { result, currentSelectedIds: new Set(currentSelectedIds), currentItems }
    },
    onStart: () => {
      setShowConfirm(false)
      useNetworkStore.getState().setStatus('cleaning')
    },
    onResult: ({ result, currentSelectedIds, currentItems }) => {
      const s = useNetworkStore.getState()
      s.setCleanResult(result)
      s.setItems(currentItems.filter((i) => !currentSelectedIds.has(i.id)))
      s.setSelectedIds(new Set())

      const byType: Record<string, { found: number; cleaned: number }> = {}
      for (const item of currentItems) {
        if (!byType[item.type]) byType[item.type] = { found: 0, cleaned: 0 }
        const entry = byType[item.type]
        if (entry) {
          entry.found++
          if (currentSelectedIds.has(item.id)) entry.cleaned++
        }
      }
      addEntry({
        id: Date.now().toString(),
        type: 'network',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: currentItems.length,
        totalItemsCleaned: result.cleaned,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byType).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.cleaned,
          spaceSaved: 0,
        })),
        errorCount: result.failed,
      })
      recomputeStats()

      useNetworkStore.getState().setStatus('complete')

      // Re-scan after cleaning to show the actual current state
      const genAtClean = scanGenRef.current
      window.dinho
        .networkScan()
        .then((freshItems) => {
          if (scanGenRef.current !== genAtClean) return // stale — user started a new scan
          const ns = useNetworkStore.getState()
          ns.setItems(freshItems)
          ns.setSelectedIds(new Set())
        })
        .catch(() => {
          /* re-scan is best-effort */
        })
    },
    onError: () => {
      useNetworkStore.getState().setStatus('idle')
    },
  })

  const isScanning = status === 'scanning'
  const isCleaning = status === 'cleaning'
  const hasItems = items.length > 0
  const categoryItems = items.filter((i) => i.type === activeCategory)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={platform === 'win32' ? t('pageDescriptionWindows') : t('pageDescriptionOther')}
        action={
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('scanButton')}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={!hasItems || isScanning || isCleaning || selectedIds.size === 0}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
                boxShadow: hasItems ? '0 4px 20px rgba(245,158,11,0.2)' : 'none',
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {t('cleanButton')}
            </button>
          </div>
        }
      />

      <div className="flex gap-5">
        {/* Category sidebar */}
        <div className="w-56 shrink-0 space-y-1.5">
          {visibleCategories.map((cat) => {
            const count = items.filter((i) => i.type === cat.type).length
            const isActive = activeCategory === cat.type
            return (
              <button
                type="button"
                key={cat.type}
                onClick={() => setActiveCategory(cat.type)}
                className="relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all"
                style={{
                  background: isActive ? 'var(--accent-muted-bg)' : 'transparent',
                  color: isActive ? 'var(--accent-hover)' : 'var(--text-muted)',
                }}
              >
                {isActive && (
                  <div
                    className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
                <cat.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium">{t(cat.labelKey)}</span>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t(cat.descriptionKey)}
                  </p>
                </div>
                {count > 0 && (
                  <span
                    className="rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ background: 'var(--bg-hover-2)', color: 'var(--text-muted)' }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}

          {hasItems && (
            <div
              className="mt-5 rounded-2xl p-4"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
            >
              <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('totalFound')}
              </p>
              <p className="text-[20px] font-bold tracking-tight text-amber-400">{items.length}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('networkItems')}
              </p>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t('selected')}
                </p>
                <p className="text-[15px] font-semibold text-zinc-200">
                  {t('selectedItems', { count: selectedIds.size })}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Items panel */}
        <div className="flex-1 min-w-0">
          {isScanning && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
            >
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <span className="text-[13px] text-zinc-400">{t('scanningStatus')}</span>
            </div>
          )}

          {isCleaning && (
            <div
              className="mb-5 rounded-2xl px-5 py-4"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                <span className="text-[13px] text-zinc-300">
                  {cleanProgress?.currentPath
                    ? t('cleaningItem', { item: cleanProgress.currentPath })
                    : t('cleaningStatus')}
                </span>
                {cleanProgress && (
                  <span className="ml-auto text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    {cleanProgress.progress}%
                  </span>
                )}
              </div>
              {cleanProgress && (
                <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-hover-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${cleanProgress.progress}%`,
                      background: 'linear-gradient(90deg, #f59e0b, #d97706)',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {cleanResult && status === 'complete' && (
            <div
              className="mb-5 rounded-2xl p-4"
              style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-[13px] font-medium text-zinc-200">{t('cleanupComplete')}</p>
                  <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {t('cleanedCount', { count: cleanResult.cleaned })}
                    {cleanResult.failed > 0 && <span> · {t('failedCount', { count: cleanResult.failed })}</span>}
                  </p>
                </div>
              </div>
              {cleanResult.details.length > 0 && (
                <div className="mt-3 ml-8 space-y-0.5">
                  {cleanResult.details.map((detail) => (
                    <p key={detail} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {detail}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasItems && !isScanning && (
            <EmptyState
              icon={Search}
              title={t('emptyStateTitle')}
              description={t('emptyStateDescription')}
              action={
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={isCleaning}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    color: 'var(--text-on-accent)',
                  }}
                >
                  <Search className="h-4 w-4" strokeWidth={1.8} />
                  {t('startScanButton')}
                </button>
              }
            />
          )}

          {hasItems && (
            <div key={activeCategory} className="space-y-2">
              <div className="mb-3 flex items-center justify-between px-1">
                <span
                  className="text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t(categories.find((c) => c.type === activeCategory)?.labelKey ?? '')}
                </span>
                {categoryItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => useNetworkStore.getState().toggleCategory(activeCategory)}
                    className="text-[12px] font-medium text-amber-500 hover:text-amber-400"
                  >
                    {t('toggleAll')}
                  </button>
                )}
              </div>

              {categoryItems.length === 0 && (
                <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {t('noItemsInCategory')}
                </div>
              )}

              <div className="space-y-1.5">
                {categoryItems.map((item) => {
                  const checked = selectedIds.has(item.id)
                  const CatIcon = categories.find((c) => c.type === item.type)?.icon || Network
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3.5 transition-all',
                        checked && 'ring-1 ring-amber-500/20',
                      )}
                      style={{
                        background: checked ? 'rgba(245,158,11,0.04)' : 'var(--card-bg)',
                        border: '1px solid var(--border-default)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = checked ? 'var(--accent-muted-bg)' : 'var(--bg-subtle)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.04)' : 'var(--card-bg)'
                      }}
                    >
                      <Checkbox checked={checked} onChange={() => useNetworkStore.getState().toggleItem(item.id)} />
                      <CatIcon
                        className="h-4 w-4 shrink-0"
                        style={{ color: checked ? 'var(--accent)' : 'var(--text-muted)' }}
                        strokeWidth={1.8}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-zinc-300">{item.label}</p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {item.detail}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmTitle')}
        description={`${t('confirmDescription', { count: selectedIds.size })}${selectedIds.size > 0 && items.some((i) => i.type === 'wifi-profile' && selectedIds.has(i.id)) ? ` ${t('confirmWifiWarning')}` : ''}${platform === 'win32' && items.some((i) => i.type === 'network-history' && selectedIds.has(i.id)) ? ` ${t('confirmNetworkHistoryWarning')}` : ''}`}
        confirmLabel={t('confirmLabel')}
        variant="warning"
      />
    </div>
  )
}
