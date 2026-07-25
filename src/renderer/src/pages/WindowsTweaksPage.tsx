import { TweakRow } from '@/components/TweakRow'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { useWindowsTweaksStore } from '@/stores/windows-tweaks-store'
import type { WindowsTweakCategory } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Accessibility,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Gamepad2,
  Globe,
  Keyboard,
  Monitor,
  MonitorCog,
  Mouse,
  Shield,
  Timer,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
  const tweaks = useWindowsTweaksStore((s) => s.tweaks)
  const dnsPresets = useWindowsTweaksStore((s) => s.dnsPresets)
  const selectedIds = useWindowsTweaksStore((s) => s.selectedIds)
  const scanning = useWindowsTweaksStore((s) => s.scanning)
  const applying = useWindowsTweaksStore((s) => s.applying)
  const progress = useWindowsTweaksStore((s) => s.progress)
  const lastResult = useWindowsTweaksStore((s) => s.lastResult)
  const revertResult = useWindowsTweaksStore((s) => s.revertResult)
  const expandedCategories = useWindowsTweaksStore((s) => s.expandedCategories)
  const gamingTimer = useWindowsTweaksStore((s) => s.gamingTimer)
  const gamingTimerLoading = useWindowsTweaksStore((s) => s.gamingTimerLoading)
  const [dnsStatus, setDnsStatus] = useState<string | null>(null)
  const [timerStatus, setTimerStatus] = useState<string | null>(null)

  const CATEGORIES: CategoryDef[] = [
    { id: 'mouse', label: t('categories.mouse', 'Mouse'), icon: Mouse, color: '#06b6d4', glow: 'rgba(6,182,212,0.12)' },
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
    { id: 'energy', label: t('categories.power', 'Power'), icon: Zap, color: '#eab308', glow: 'rgba(234,179,8,0.12)' },
  ]

  const CAT_COLORS = CATEGORIES.reduce(
    (acc, c) => {
      acc[c.id] = { color: c.color, glow: c.glow }
      return acc
    },
    {} as Record<string, { color: string; glow: string }>,
  )

  useEffect(() => {
    Promise.all([store.getState().load(), store.getState().loadDnsPresets(), store.getState().loadGamingTimer()])
  }, [store])

  const appliedCount = tweaks.filter((t) => t.applied).length

  const getCatStats = (cat: WindowsTweakCategory) => {
    const catTweaks = tweaks.filter((t) => t.tweak.category === cat)
    return {
      total: catTweaks.length,
      applied: catTweaks.filter((t) => t.applied).length,
    }
  }

  const handleToggle = (id: string) => {
    store.getState().toggle(id)
  }

  const handleApply = async () => {
    await store.getState().apply()
    toast.success(t('toastAppliedSuccess', 'Tweaks applied successfully!'))
  }

  const handleRevert = async () => {
    await store.getState().revert()
    toast.success(t('toastRevertedSuccess', 'Tweaks reverted!'))
  }

  const handleSelectAll = () => store.getState().selectAll()
  const handleDeselectAll = () => store.getState().deselectAll()

  const handleSetDns = async (primary: string, secondary: string) => {
    const ok = await store.getState().setDns(primary, secondary)
    setDnsStatus(
      ok ? t('dnsChangedSuccess', 'DNS changed successfully!') : t('dnsChangeFailed', 'Failed to change DNS'),
    )
    if (ok) toast.success(t('dnsChanged', 'DNS changed!'))
    else toast.error(t('dnsChangeFailed', 'Failed to change DNS'))
  }

  if (scanning) {
    return (
      <div className="p-6">
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
      <div className="p-6">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
        <EmptyState icon={MonitorCog} title={t('emptyStateTitle')} description={t('emptyStateDescription')} />
      </div>
    )
  }

  return (
    <div className="p-6">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* Stats bar */}
      <div
        className="mb-6 flex items-center gap-4 rounded-xl border px-5 py-3"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="text-sm text-zinc-300">
            {t('tweaksActive', { count: appliedCount, total: tweaks.length })}
          </span>
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <span className="text-sm text-zinc-500">{t('selectedCount', { count: selectedIds.size })}</span>
      </div>

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSelectAll}
          disabled={applying}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white disabled:opacity-40"
        >
          {t('selectUnapplied', 'Select unapplied')}
        </button>
        <button
          type="button"
          onClick={handleDeselectAll}
          disabled={applying}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white disabled:opacity-40"
        >
          {t('deselectAll')}
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={selectedIds.size === 0 || applying}
          className="rounded-lg px-5 py-2 text-sm font-bold text-white transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
            boxShadow: '0 0 20px rgba(6,182,212,0.2)',
          }}
        >
          {applying
            ? `${t('applying', 'Applying...')} ${progress ? `${progress.current}/${progress.total}` : ''}`
            : t('applyWithCount', { count: selectedIds.size })}
        </button>
        <button
          type="button"
          onClick={handleRevert}
          disabled={selectedIds.size === 0 || applying}
          className="rounded-lg border border-red-800 px-5 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-900/20 disabled:opacity-40"
        >
          {t('revert')}
        </button>
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
                className="h-full"
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
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t('tweaksAppliedResult', { count: lastResult.succeeded })}
            {lastResult.failed > 0 && `, ${t('tweaksFailedResult', { count: lastResult.failed })}`}
          </div>
          {lastResult.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-800 bg-red-900/10 px-4 py-3 text-sm">
              {lastResult.errors.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-red-400">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
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
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
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
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('tweaksRevertedResult', { count: revertResult.succeeded })}
            {revertResult.failed > 0 && `, ${t('tweaksFailedResult', { count: revertResult.failed })}`}
          </div>
          {revertResult.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-800 bg-red-900/10 px-4 py-3 text-sm">
              {revertResult.errors.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-red-400">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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

      {/* Netsh TCP */}
      <div className="mb-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <Zap className="h-4 w-4 text-cyan-400" />
          {t('tcpIpOptimization', 'TCP/IP Stack Optimization')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              store
                .getState()
                .netshTcpApply()
                .then((r) => {
                  if (r.success) toast.success(t('tcpIpApplied', 'TCP/IP tweaks applied!'))
                  else toast.error(r.error ?? t('failed', 'Failed'))
                })
            }
            disabled={applying}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-cyan-700 hover:text-cyan-400 disabled:opacity-40"
          >
            {t('applyTcpTweaks', 'Apply TCP Tweaks')}
          </button>
          <button
            type="button"
            onClick={() =>
              store
                .getState()
                .netshTcpRevert()
                .then((r) => {
                  if (r.success) toast.success(t('tcpIpReverted', 'TCP/IP tweaks reverted!'))
                  else toast.error(r.error ?? t('failed', 'Failed'))
                })
            }
            disabled={applying}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-red-700 hover:text-red-400 disabled:opacity-40"
          >
            {t('revertTcpTweaks', 'Revert TCP Tweaks')}
          </button>
        </div>
      </div>

      {/* Timer & Gaming Tweaks */}
      <div className="mb-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <Timer className="h-4 w-4 text-orange-400" />
          {t('timerTweaks', 'Timer & Gaming Tweaks')}
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          {t('timerTweaksDescription', 'Optimize Windows timer resolution and CPU scheduling for competitive gaming. Requires reboot to take effect.')}
        </p>
        {gamingTimerLoading ? (
          <div className="flex items-center gap-2 py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-orange-400" />
            <span className="text-xs text-zinc-500">{t('loadingTimer', 'Loading timer status...')}</span>
          </div>
        ) : gamingTimer ? (
          <div className="space-y-3">
            {/* HPET */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}>
              <div>
                <div className="text-sm font-medium text-zinc-200">
                  {t('hpetTitle', 'HPET (High Precision Event Timer)')}
                </div>
                <div className="text-xs text-zinc-500">
                  {t('hpetDescription', 'Disable platform clock for lower timer latency on Intel CPUs. May help on AMD Ryzen too.')}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  store.getState().setGamingTimer({ hpetOff: !gamingTimer.hpetOff }).then((r) => {
                    if (r.success) toast.success(t('timerApplied', 'Timer setting applied!'))
                    else toast.error(r.errors[0] ?? t('failed', 'Failed'))
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  gamingTimer.hpetOff ? 'bg-orange-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    gamingTimer.hpetOff ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* TSC Sync Policy */}
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}>
              <div className="mb-2">
                <div className="text-sm font-medium text-zinc-200">
                  {t('tscSyncTitle', 'TSC Sync Policy')}
                </div>
                <div className="text-xs text-zinc-500">
                  {t('tscSyncDescription', 'Legacy = lower input lag, slightly less FPS. Enhanced = more FPS, slightly more input lag.')}
                </div>
              </div>
              <div className="flex gap-2">
                {(['default', 'legacy', 'enhanced'] as const).map((policy) => (
                  <button
                    type="button"
                    key={policy}
                    onClick={() =>
                      store.getState().setGamingTimer({ tscSyncPolicy: policy }).then((r) => {
                        if (r.success) toast.success(t('timerApplied', 'Timer setting applied!'))
                        else toast.error(r.errors[0] ?? t('failed', 'Failed'))
                      })
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      gamingTimer.tscSyncPolicy === policy
                        ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    {policy === 'default' ? t('tscDefault', 'Default') : policy === 'legacy' ? t('tscLegacy', 'Legacy (Low Latency)') : t('tscEnhanced', 'Enhanced (High FPS)')}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Tick */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}>
              <div>
                <div className="text-sm font-medium text-zinc-200">
                  {t('dynamicTickTitle', 'Disable Dynamic Tick')}
                </div>
                <div className="text-xs text-zinc-500">
                  {t('dynamicTickDescription', 'Prevents Windows from suspending the system timer tick in idle. Reduces micro-stutters.')}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  store.getState().setGamingTimer({ dynamicTickDisabled: !gamingTimer.dynamicTickDisabled }).then((r) => {
                    if (r.success) toast.success(t('timerApplied', 'Timer setting applied!'))
                    else toast.error(r.errors[0] ?? t('failed', 'Failed'))
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  gamingTimer.dynamicTickDisabled ? 'bg-orange-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    gamingTimer.dynamicTickDisabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* AutoTuning */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}>
              <div>
                <div className="text-sm font-medium text-zinc-200">
                  {t('autoTuningTitle', 'TCP AutoTuning — Disabled')}
                </div>
                <div className="text-xs text-zinc-500">
                  {t('autoTuningDescription', 'Reduces bufferbloat and jitter during gaming. Recommended for competitive gaming. May slow large downloads.')}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  store.getState().setAutoTuning(gamingTimer.autoTuningDisabled ? 'revert' : 'apply').then((r) => {
                    if (r.success) toast.success(t('timerApplied', 'Timer setting applied!'))
                    else toast.error(r.error ?? t('failed', 'Failed'))
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  gamingTimer.autoTuningDisabled ? 'bg-orange-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    gamingTimer.autoTuningDisabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Revert All */}
            <button
              type="button"
              onClick={() =>
                store.getState().revertGamingTimer().then((r) => {
                  if (r.success) toast.success(t('timerReverted', 'Timer settings reverted to defaults!'))
                  else toast.error(r.errors[0] ?? t('failed', 'Failed'))
                })
              }
              className="rounded-lg border border-red-800 px-4 py-2 text-xs font-medium text-red-400 transition-all hover:bg-red-900/20"
            >
              {t('revertTimerDefaults', 'Revert Timer to Defaults')}
            </button>

            {timerStatus && <p className="text-xs text-zinc-500">{timerStatus}</p>}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{t('timerLoadFailed', 'Failed to load timer status.')}</p>
        )}
      </div>

      {/* DNS Presets */}
      {dnsPresets.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <Globe className="h-4 w-4 text-cyan-400" />
            {t('dnsPresets', 'DNS Presets')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {dnsPresets.map((preset) => (
              <button
                type="button"
                key={preset.name}
                onClick={() => handleSetDns(preset.primary, preset.secondary)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-cyan-700 hover:text-cyan-400"
              >
                {preset.name}
                <span className="ml-2 text-xs text-zinc-600">{preset.primary}</span>
              </button>
            ))}
          </div>
          {dnsStatus && <p className="mt-2 text-xs text-zinc-500">{dnsStatus}</p>}
        </div>
      )}

      {/* Category cards */}
      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const catTweaks = tweaks.filter((t) => t.tweak.category === cat.id)
          if (catTweaks.length === 0) return null
          const stats = getCatStats(cat.id)
          const isExpanded = expandedCategories.has(cat.id)

          return (
            <div
              key={cat.id}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
            >
              {/* Category header */}
              <button
                type="button"
                onClick={() => store.getState().toggleCategory(cat.id)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-all hover:bg-white/[0.02]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: cat.glow }}>
                  <cat.icon className="h-4 w-4" style={{ color: cat.color }} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-200">{cat.label}</div>
                  <div className="text-xs text-zinc-500">
                    {t('categoryStats', { applied: stats.applied, total: stats.total })}
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Tweak items */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-0.5 border-t px-5 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
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
