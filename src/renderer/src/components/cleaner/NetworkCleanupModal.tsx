import type { NetworkCleanResult, NetworkItem } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { CircleCheckBig, Globe, History, Loader2, Network, Search, Sparkles, Wifi, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import logger from '@/lib/renderer-logger'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'

interface NetworkCleanupModalProps {
  open: boolean
  onClose: () => void
}

type NetworkCategory = NetworkItem['type']

interface CategoryDef {
  type: NetworkCategory
  labelKey: string
  icon: LucideIcon
}

const categories: CategoryDef[] = [
  { type: 'dns-cache', labelKey: 'categoryDnsCache', icon: Globe },
  { type: 'arp-cache', labelKey: 'categoryArpCache', icon: Network },
  { type: 'wifi-profile', labelKey: 'categoryWifiProfiles', icon: Wifi },
  { type: 'network-history', labelKey: 'categoryNetworkHistory', icon: History },
]

export function NetworkCleanupModal({ open, onClose }: NetworkCleanupModalProps) {
  const { t } = useTranslation('network')
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const cleanStartRef = useRef(0)
  const scanGenRef = useRef(0)

  const [items, setItems] = useState<NetworkItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'idle' | 'scanning' | 'cleaning' | 'complete'>('idle')
  const [cleanResult, setCleanResult] = useState<NetworkCleanResult | null>(null)
  const [activeCategory, setActiveCategory] = useState<NetworkCategory>('dns-cache')
  const [showConfirm, setShowConfirm] = useState(false)

  const handleScan = useCallback(async () => {
    scanGenRef.current++
    setStatus('scanning')
    setItems([])
    setSelectedIds(new Set())
    setCleanResult(null)
    try {
      const result = await window.dinho.networkScan()
      setItems(result)
      const preSelected = new Set(result.filter((i) => i.selected).map((i) => i.id))
      setSelectedIds(preSelected)
      setStatus('complete')
    } catch (err) {
      logger.error('NetworkCleanupModal', 'Scan failed', err)
      setStatus('idle')
    }
  }, [])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    setStatus('cleaning')
    cleanStartRef.current = Date.now()
    const currentSelectedIds = new Set(selectedIds)
    const currentItems = [...items]
    try {
      const result = await window.dinho.networkClean([...currentSelectedIds])
      setCleanResult(result)
      setItems(currentItems.filter((i) => !currentSelectedIds.has(i.id)))
      setSelectedIds(new Set())

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
      setStatus('complete')

      const genAtClean = scanGenRef.current
      try {
        const freshItems = await window.dinho.networkScan()
        if (scanGenRef.current === genAtClean) {
          setItems(freshItems)
          setSelectedIds(new Set())
        }
      } catch {
        /* re-scan is best-effort */
      }
    } catch (err) {
      logger.error('NetworkCleanupModal', 'Clean failed', err)
      setStatus('idle')
    }
  }, [items, selectedIds, addEntry, recomputeStats])

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleCategory = useCallback(
    (type: NetworkCategory) => {
      const catItems = items.filter((i) => i.type === type)
      const allSelected = catItems.every((i) => selectedIds.has(i.id))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const item of catItems) {
          if (allSelected) next.delete(item.id)
          else next.add(item.id)
        }
        return next
      })
    },
    [items, selectedIds],
  )

  useEffect(() => {
    if (open && status === 'idle') {
      handleScan()
    }
  }, [open, status, handleScan])

  const isScanning = status === 'scanning'
  const isCleaning = status === 'cleaning'
  const hasItems = items.length > 0
  const categoryItems = items.filter((i) => i.type === activeCategory)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

          {/* Modal */}
          <motion.div
            className="relative z-10 mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl shadow-2xl"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
          >
            {/* Modal header */}
            <div
              className="flex shrink-0 items-center justify-between rounded-t-2xl px-6 py-4"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-3">
                <Wifi className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-normal)' }}>
                  {t('pageTitle')}
                </h2>
              </div>
              <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-white/5">
                <X className="h-4 w-4" strokeWidth={1.8} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* Modal body — scrollable */}
            <div className="flex flex-1 gap-5 overflow-y-auto p-5">
              {/* Category sidebar */}
              <div className="w-48 shrink-0 space-y-1">
                {categories.map((cat) => {
                  const count = items.filter((i) => i.type === cat.type).length
                  const isActive = activeCategory === cat.type
                  return (
                    <button
                      type="button"
                      key={cat.type}
                      onClick={() => setActiveCategory(cat.type)}
                      className="relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-all"
                      style={{
                        background: isActive ? 'var(--accent-muted-bg)' : 'transparent',
                        color: isActive ? 'var(--accent-hover)' : 'var(--text-muted)',
                      }}
                    >
                      {isActive && (
                        <div
                          className="absolute left-0 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-r-full"
                          style={{ background: 'var(--accent)' }}
                        />
                      )}
                      <cat.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span className="flex-1 text-[12px] font-medium">{t(cat.labelKey)}</span>
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
              </div>

              {/* Items panel */}
              <div className="flex-1 min-w-0">
                {/* Scan in progress */}
                {isScanning && (
                  <div
                    className="flex items-center gap-3 rounded-2xl px-5 py-4"
                    style={{ background: 'var(--bg-hover)' }}
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={1.8} />
                    <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      {t('scanningStatus')}
                    </span>
                  </div>
                )}

                {/* Cleaning in progress */}
                {isCleaning && (
                  <div
                    className="flex items-center gap-3 rounded-2xl px-5 py-4"
                    style={{ background: 'var(--bg-hover)' }}
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={1.8} />
                    <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      {t('cleaningStatus')}
                    </span>
                  </div>
                )}

                {/* Clean result */}
                {cleanResult && status === 'complete' && (
                  <div
                    className="mb-4 rounded-2xl p-4"
                    style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
                  >
                    <div className="flex items-center gap-3">
                      <CircleCheckBig className="h-5 w-5 shrink-0 text-green-500" strokeWidth={1.8} />
                      <div>
                        <p className="text-[13px] font-medium" style={{ color: 'var(--text-normal)' }}>
                          {t('cleanupComplete')}
                        </p>
                        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                          {t('cleanedCount', { count: cleanResult.cleaned })}
                          {cleanResult.failed > 0 && <span> · {t('failedCount', { count: cleanResult.failed })}</span>}
                        </p>
                      </div>
                    </div>
                    {cleanResult.details.length > 0 && (
                      <div className="mt-3 ml-8 space-y-0.5">
                        {cleanResult.details.map((d) => (
                          <p key={d} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                            {d}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Empty state */}
                {!hasItems && !isScanning && !isCleaning && (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Search className="mb-3 h-8 w-8" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
                    <p className="mb-1 text-[13px] font-medium" style={{ color: 'var(--text-normal)' }}>
                      {t('emptyStateTitle')}
                    </p>
                    <p className="mb-4 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      {t('emptyStateDescription')}
                    </p>
                    <button
                      type="button"
                      onClick={handleScan}
                      className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                        color: 'var(--text-on-accent)',
                      }}
                    >
                      <Search className="h-4 w-4" strokeWidth={1.8} />
                      {t('startScanButton')}
                    </button>
                  </div>
                )}

                {/* Items list */}
                {hasItems && !isScanning && (
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
                          onClick={() => toggleCategory(activeCategory)}
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
                            className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 transition-all"
                            style={{
                              background: checked ? 'rgba(245,158,11,0.04)' : 'var(--card-bg)',
                              border: checked ? '1px solid rgba(245,158,11,0.2)' : '1px solid var(--border-default)',
                            }}
                            onClick={() => toggleItem(item.id)}
                          >
                            <Checkbox checked={checked} onChange={() => toggleItem(item.id)} />
                            <CatIcon
                              className="h-4 w-4 shrink-0"
                              style={{ color: checked ? 'var(--accent)' : 'var(--text-muted)' }}
                              strokeWidth={1.8}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium" style={{ color: 'var(--text-normal)' }}>
                                {item.label}
                              </p>
                              <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
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

            {/* Modal footer */}
            <div
              className="flex shrink-0 items-center justify-end gap-3 rounded-b-2xl px-6 py-4"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span className="mr-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {hasItems && selectedIds.size > 0 && t('selectedItems', { count: selectedIds.size })}
              </span>
              <button
                type="button"
                onClick={handleScan}
                disabled={isScanning || isCleaning}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all disabled:opacity-40"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                }}
              >
                <Search className="h-4 w-4" strokeWidth={1.8} />
                {t('scanButton')}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={!hasItems || isScanning || isCleaning || selectedIds.size === 0}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all disabled:opacity-30"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: 'var(--text-on-accent)',
                }}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                {t('cleanButton')}
              </button>
            </div>

            <ConfirmDialog
              open={showConfirm}
              onConfirm={handleClean}
              onCancel={() => setShowConfirm(false)}
              title={t('confirmTitle')}
              description={`${t('confirmDescription', { count: selectedIds.size })}${selectedIds.size > 0 && items.some((i) => i.type === 'wifi-profile' && selectedIds.has(i.id)) ? ` ${t('confirmWifiWarning')}` : ''}`}
              confirmLabel={t('confirmLabel')}
              variant="warning"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
