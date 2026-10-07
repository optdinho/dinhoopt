import type { WindowsTweakCategory, WindowsTweakResult } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  Accessibility,
  ChevronDown,
  CircleCheckBig,
  CircleX,
  Cpu,
  Gamepad2,
  Keyboard,
  Monitor,
  MonitorCog,
  Mouse,
  Shield,
  TriangleAlert,
  Wifi,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { TweakRow } from '@/components/TweakRow'
import { useWindowsTweaksStore } from '@/stores/windows-tweaks-store'
import type { TimerSettings } from './windows-tweaks/AdvancedTools'
import { AdvancedTools } from './windows-tweaks/AdvancedTools'

interface CategoryDef {
  id: WindowsTweakCategory
  label: string
  icon: LucideIcon
  color: string
  glow: string
}

export function WindowsTweaksPage() {
  const { t } = useTranslation('windowsTweaks')
  const store = useWindowsTweaksStore
  const {
    tweaks,
    dnsPresets,
    dnsBenchmark,
    dnsBenchmarking,
    currentDns,
    selectedIds,
    scanning,
    applying,
    progress,
    lastResult,
    revertResult,
    expandedCategories,
    gamingTimer,
    gamingTimerLoading,
  } = useWindowsTweaksStore(
    useShallow((s) => ({
      tweaks: s.tweaks,
      dnsPresets: s.dnsPresets,
      dnsBenchmark: s.dnsBenchmark,
      dnsBenchmarking: s.dnsBenchmarking,
      currentDns: s.currentDns,
      selectedIds: s.selectedIds,
      scanning: s.scanning,
      applying: s.applying,
      progress: s.progress,
      lastResult: s.lastResult,
      revertResult: s.revertResult,
      expandedCategories: s.expandedCategories,
      gamingTimer: s.gamingTimer,
      gamingTimerLoading: s.gamingTimerLoading,
    })),
  )

  const CATEGORIES = useMemo<CategoryDef[]>(
    () => [
      {
        id: 'mouse',
        label: t('categories.mouse', 'Mouse'),
        icon: Mouse,
        color: '#06b6d4',
        glow: 'rgba(6,182,212,0.12)',
      },
      {
        id: 'keyboard',
        label: t('categories.keyboard', 'Keyboard'),
        icon: Keyboard,
        color: '#8b5cf6',
        glow: 'rgba(139,92,246,0.12)',
      },
      {
        id: 'accessibility',
        label: t('categories.accessibility', 'Accessibility'),
        icon: Accessibility,
        color: '#22c55e',
        glow: 'rgba(34,197,94,0.12)',
      },
      {
        id: 'network',
        label: t('categories.network', 'Network'),
        icon: Wifi,
        color: '#ec4899',
        glow: 'rgba(236,72,153,0.12)',
      },
      { id: 'gpu', label: t('categories.gpu', 'GPU'), icon: Monitor, color: '#f59e0b', glow: 'rgba(245,158,11,0.12)' },
      {
        id: 'system',
        label: t('categories.system', 'System'),
        icon: MonitorCog,
        color: '#14b8a6',
        glow: 'rgba(20,184,166,0.12)',
      },
      {
        id: 'gaming',
        label: t('categories.gaming', 'Gaming'),
        icon: Gamepad2,
        color: '#f97316',
        glow: 'rgba(249,115,22,0.12)',
      },
      {
        id: 'privacy',
        label: t('categories.privacy', 'Privacy'),
        icon: Shield,
        color: '#a855f7',
        glow: 'rgba(168,85,247,0.12)',
      },
      { id: 'mmcss', label: t('categories.mmcss', 'MMCSS'), icon: Cpu, color: '#06b6d4', glow: 'rgba(6,182,212,0.12)' },
      {
        id: 'energy',
        label: t('categories.power', 'Power'),
        icon: Zap,
        color: '#eab308',
        glow: 'rgba(234,179,8,0.12)',
      },
    ],
    [t],
  )

  const CAT_COLORS = useMemo(
    () =>
      CATEGORIES.reduce(
        (acc, c) => {
          acc[c.id] = { color: c.color, glow: c.glow }
          return acc
        },
        {} as Record<string, { color: string; glow: string }>,
      ),
    [CATEGORIES],
  )

  useEffect(() => {
    Promise.all([
      store.getState().load(),
      store.getState().loadDnsPresets(),
      store.getState().loadCurrentDns(),
      store.getState().loadGamingTimer(),
    ])
  }, [])

  const appliedCount = useMemo(() => tweaks.filter((t) => t.applied).length, [tweaks])

  const getCatStats = useCallback(
    (cat: WindowsTweakCategory) => {
      const catTweaks = tweaks.filter((t) => t.tweak.category === cat)
      return {
        total: catTweaks.length,
        applied: catTweaks.filter((t) => t.applied).length,
      }
    },
    [tweaks],
  )

  const handleToggle = useCallback((id: string) => {
    store.getState().toggle(id)
  }, [])

  const showApplyFeedback = useCallback(
    (result: WindowsTweakResult | null, verb: 'applied' | 'reverted') => {
      if (!result) {
        toast.error(t('operationFailed', 'A operação falhou'))
        return
      }
      if (result.failed > 0) {
        toast.error(t('someFailed', 'Falhou {{count}} otimização(ões)', { count: result.failed }))
        return
      }
      if (verb === 'applied') toast.success(t('toastAppliedSuccess', 'Tweaks applied successfully!'))
      else toast.success(t('toastRevertedSuccess', 'Tweaks reverted!'))
    },
    [t],
  )

  const handleApply = useCallback(async () => {
    if (store.getState().selectedIds.size === 0) return
    await store.getState().apply()
    showApplyFeedback(store.getState().lastResult, 'applied')
  }, [showApplyFeedback])

  const handleRevert = useCallback(async () => {
    if (store.getState().selectedIds.size === 0) return
    await store.getState().revert()
    showApplyFeedback(store.getState().revertResult, 'reverted')
  }, [showApplyFeedback])

  const handleSelectAll = useCallback(() => store.getState().selectAll(), [])
  const handleDeselectAll = useCallback(() => store.getState().deselectAll(), [])

  const handleSetDns = useCallback(
    async (primary: string, secondary?: string) => {
      const ok = await store.getState().setDns(primary, secondary)
      if (ok) toast.success(t('dnsChanged', 'DNS alterado!'))
      else toast.error(t('dnsChangeFailed', 'Não foi possível alterar o DNS'))
    },
    [t],
  )

  const handleOpenExternal = useCallback((url: string) => {
    void window.dinho.openExternal(url)
  }, [])

  const handleBenchmarkDns = useCallback(async () => {
    await store.getState().benchmarkDns()
  }, [])

  const handleTcpApply = useCallback(async () => {
    const r = await store.getState().netshTcpApply()
    if (r.success) toast.success(t('tcpIpApplied', 'Otimizações TCP/IP aplicadas!'))
    else toast.error(r.error ?? t('failed', 'Falhou'))
  }, [t])

  const handleTcpRevert = useCallback(async () => {
    const r = await store.getState().netshTcpRevert()
    if (r.success) toast.success(t('tcpIpReverted', 'Otimizações TCP/IP revertidas!'))
    else toast.error(r.error ?? t('failed', 'Falhou'))
  }, [t])

  const handleSetTimer = useCallback(
    async (settings: TimerSettings) => {
      const r = await store.getState().setGamingTimer(settings)
      if (r.success) toast.success(t('timerApplied', 'Definição de timer aplicada!'))
      else toast.error(r.errors[0] ?? t('failed', 'Falhou'))
    },
    [t],
  )

  const handleRevertTimer = useCallback(async () => {
    const r = await store.getState().revertGamingTimer()
    if (r.success) toast.success(t('timerReverted', 'Timer revertido para os valores padrão!'))
    else toast.error(r.errors[0] ?? t('failed', 'Falhou'))
  }, [t])

  const handleAutoTuning = useCallback(
    async (action: 'apply' | 'revert') => {
      const r = await store.getState().setAutoTuning(action)
      if (r.success) toast.success(t('timerApplied', 'Definição de timer aplicada!'))
      else toast.error(r.error ?? t('failed', 'Falhou'))
    },
    [t],
  )

  if (scanning) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
        <div className="mt-8 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
          <span className="ml-3 text-zinc-400">{t('scanningTweaks', 'Checking tweaks...')}</span>
        </div>
      </div>
    )
  }

  if (tweaks.length === 0) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
        <EmptyState icon={MonitorCog} title={t('emptyStateTitle')} description={t('emptyStateDescription')} />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      <div
        className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl px-5 py-3.5"
        style={{ border: '1px solid var(--border-default)', background: 'var(--card-bg)' }}
        data-testid="tweak-toolbar"
      >
        <div className="flex items-center gap-4" data-testid="toolbar-counters">
          <div className="flex items-center gap-2">
            <CircleCheckBig className="h-4 w-4 text-green-400" />
            <span className="text-sm text-zinc-300">
              {t('tweaksActive', { count: appliedCount, total: tweaks.length })}
            </span>
          </div>
          <div className="h-4 w-px bg-zinc-700" />
          <span className="text-sm text-zinc-500">{t('selectedCount', { count: selectedIds.size })}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2.5" data-testid="toolbar-actions">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={applying}
            className="rounded-xl px-4 py-2 text-[13px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white disabled:opacity-40"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            {t('selectUnapplied', 'Select unapplied')}
          </button>
          <button
            type="button"
            onClick={handleDeselectAll}
            disabled={applying}
            className="rounded-xl px-4 py-2 text-[13px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white disabled:opacity-40"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            {t('deselectAll')}
          </button>
          <button
            type="button"
            onClick={handleRevert}
            disabled={selectedIds.size === 0 || applying}
            className="rounded-xl px-4 py-2 text-[13px] font-medium text-red-400 transition-all hover:bg-red-900/20 disabled:opacity-40"
            style={{ border: '1px solid rgba(239,68,68,0.25)' }}
          >
            {t('revert')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={selectedIds.size === 0 || applying}
            className="rounded-xl px-5 py-2 text-[13px] font-bold text-white transition-all disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
              boxShadow: selectedIds.size > 0 && !applying ? '0 0 20px rgba(6,182,212,0.25)' : 'none',
            }}
          >
            {applying
              ? `${t('applying', 'Applying...')} ${progress ? `${progress.current}/${progress.total}` : ''}`
              : t('applyWithCount', { count: selectedIds.size })}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <AnimatePresence>
        {applying && progress && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 overflow-hidden rounded-lg border"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            <div className="flex items-center justify-between px-4 py-2 text-sm text-zinc-400">
              <span>{progress.currentTweak}</span>
              <span>
                {progress.current}/{progress.total}
              </span>
            </div>
            <div className="h-1.5 bg-zinc-800">
              <motion.div
                className="h-full will-change-transform"
                style={{ background: 'linear-gradient(90deg, #06b6d4, #0891b2)' }}
                initial={{ width: 0 }}
                animate={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      {lastResult && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-green-800 bg-green-900/10 px-4 py-3 text-sm text-green-400">
            <CircleCheckBig className="h-4 w-4 shrink-0" />
            {t('tweaksAppliedResult', { count: lastResult.succeeded })}
            {lastResult.failed > 0 && `, ${t('tweaksFailedResult', { count: lastResult.failed })}`}
          </div>
          {lastResult.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-800 bg-red-900/10 px-4 py-3 text-sm">
              {lastResult.errors.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-red-400">
                  <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <span className="font-medium">{e.name}</span>
                    <span className="ml-2 text-red-300/80">{e.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {lastResult.rebootRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-800 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-400">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-medium">{t('restartRequired', 'Restart required')}</span>
                <ul className="mt-1 list-inside list-disc text-yellow-300/80">
                  {lastResult.rebootRequired.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {lastResult.logoffRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-800 bg-blue-900/10 px-4 py-3 text-sm text-blue-400">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-medium">{t('relogRequired', 'Re-login required')}</span>
                <ul className="mt-1 list-inside list-disc text-blue-300/80">
                  {lastResult.logoffRequired.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
      {revertResult && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-yellow-800 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-400">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {t('tweaksRevertedResult', { count: revertResult.succeeded })}
            {revertResult.failed > 0 && `, ${t('tweaksFailedResult', { count: revertResult.failed })}`}
          </div>
          {revertResult.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-800 bg-red-900/10 px-4 py-3 text-sm">
              {revertResult.errors.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-red-400">
                  <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <span className="font-medium">{e.name}</span>
                    <span className="ml-2 text-red-300/80">{e.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AdvancedTools
        applying={applying}
        dnsPresets={dnsPresets}
        dnsBenchmark={dnsBenchmark}
        dnsBenchmarking={dnsBenchmarking}
        currentDns={currentDns}
        gamingTimer={gamingTimer}
        gamingTimerLoading={gamingTimerLoading}
        onBenchmarkDns={handleBenchmarkDns}
        onApplyTcp={handleTcpApply}
        onRevertTcp={handleTcpRevert}
        onSetDns={handleSetDns}
        onSetTimer={handleSetTimer}
        onRevertTimer={handleRevertTimer}
        onSetAutoTuning={handleAutoTuning}
        onOpenExternal={handleOpenExternal}
      />

      <div className="tweak-categories space-y-3" data-testid="tweak-categories">
        {CATEGORIES.map((cat) => {
          const catTweaks = tweaks.filter((t) => t.tweak.category === cat.id)
          if (catTweaks.length === 0) return null
          const stats = getCatStats(cat.id)
          const isExpanded = expandedCategories.has(cat.id)

          return (
            <div
              key={cat.id}
              className="overflow-hidden rounded-2xl"
              style={{ border: '1px solid var(--border-default)', background: 'var(--card-bg)' }}
            >
              <button
                type="button"
                onClick={() => store.getState().toggleCategory(cat.id)}
                className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-all hover:bg-white/[0.02]"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: cat.glow }}
                >
                  <cat.icon className="h-[18px] w-[18px]" style={{ color: cat.color }} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-zinc-200">{cat.label}</div>
                  <div className="mt-0.5 text-[12px] text-zinc-500">
                    {t('categoryStats', { applied: stats.applied, total: stats.total })}
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  strokeWidth={1.8}
                />
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden will-change-transform"
                  >
                    <div className="space-y-0.5 border-t px-4 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      {catTweaks.map(({ tweak, applied }, idx) => {
                        const catColor = CAT_COLORS[tweak.category]
                        return (
                          <TweakRow
                            key={tweak.id}
                            tweak={tweak}
                            applied={applied}
                            selected={selectedIds.has(tweak.id)}
                            accentColor={catColor?.color ?? '#8b5cf6'}
                            accentGlow={catColor?.glow ?? 'rgba(139,92,246,0.12)'}
                            index={idx}
                            onToggle={handleToggle}
                          />
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
