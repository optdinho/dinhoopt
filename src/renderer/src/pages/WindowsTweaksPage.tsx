import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mouse,
  Keyboard,
  Accessibility,
  Wifi,
  Monitor,
  MonitorCog,
  Gamepad2,
  Shield,
  Cpu,
  Zap,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { useWindowsTweaksStore } from '@/stores/windows-tweaks-store'
import type { WindowsTweakCategory } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

interface CategoryDef {
  id: WindowsTweakCategory
  label: string
  icon: LucideIcon
  color: string
  glow: string
}

const CATEGORIES: CategoryDef[] = [
  { id: 'mouse', label: 'Mouse', icon: Mouse, color: '#06b6d4', glow: 'rgba(6,182,212,0.12)' },
  { id: 'keyboard', label: 'Teclado', icon: Keyboard, color: '#8b5cf6', glow: 'rgba(139,92,246,0.12)' },
  { id: 'accessibility', label: 'Acessibilidade', icon: Accessibility, color: '#22c55e', glow: 'rgba(34,197,94,0.12)' },
  { id: 'network', label: 'Rede', icon: Wifi, color: '#ec4899', glow: 'rgba(236,72,153,0.12)' },
  { id: 'gpu', label: 'GPU', icon: Monitor, color: '#f59e0b', glow: 'rgba(245,158,11,0.12)' },
  { id: 'system', label: 'Sistema', icon: MonitorCog, color: '#14b8a6', glow: 'rgba(20,184,166,0.12)' },
  { id: 'gaming', label: 'Gaming', icon: Gamepad2, color: '#f97316', glow: 'rgba(249,115,22,0.12)' },
  { id: 'privacy', label: 'Privacidade', icon: Shield, color: '#a855f7', glow: 'rgba(168,85,247,0.12)' },
  { id: 'mmcss', label: 'MMCSS', icon: Cpu, color: '#06b6d4', glow: 'rgba(6,182,212,0.12)' },
  { id: 'energy', label: 'Energia', icon: Zap, color: '#eab308', glow: 'rgba(234,179,8,0.12)' },
]

export function WindowsTweaksPage() {
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
  const [dnsStatus, setDnsStatus] = useState<string | null>(null)

  useEffect(() => {
    store.getState().load()
    store.getState().loadDnsPresets()
  }, [])

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
    toast.success('Tweaks aplicados com sucesso!')
  }

  const handleRevert = async () => {
    await store.getState().revert()
    toast.success('Tweaks revertidos!')
  }

  const handleSelectAll = () => store.getState().selectAll()
  const handleDeselectAll = () => store.getState().deselectAll()

  const handleSetDns = async (primary: string, secondary: string) => {
    const ok = await store.getState().setDns(primary, secondary)
    setDnsStatus(ok ? 'DNS alterado com sucesso!' : 'Falha ao alterar DNS')
    if (ok) toast.success('DNS alterado!')
    else toast.error('Falha ao alterar DNS')
  }

  if (scanning) {
    return (
      <div className="p-6">
        <PageHeader title="Windows Tweaks" description="Catálogo de otimizações para Windows" />
        <div className="mt-8 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
          <span className="ml-3 text-zinc-400">Verificando tweaks...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <PageHeader title="Windows Tweaks" description="Catálogo de otimizações para Windows" />

      {/* Stats bar */}
      <div className="mb-6 flex items-center gap-4 rounded-xl border px-5 py-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="text-sm text-zinc-300">{appliedCount}/{tweaks.length} tweaks ativos</span>
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <span className="text-sm text-zinc-500">{selectedIds.size} selecionados</span>
      </div>

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-3">
        <button
          onClick={handleSelectAll}
          disabled={applying}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white disabled:opacity-40"
        >
          Selecionar não aplicados
        </button>
        <button
          onClick={handleDeselectAll}
          disabled={applying}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white disabled:opacity-40"
        >
          Desmarcar todos
        </button>
        <button
          onClick={handleApply}
          disabled={selectedIds.size === 0 || applying}
          className="rounded-lg px-5 py-2 text-sm font-bold text-white transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
            boxShadow: '0 0 20px rgba(6,182,212,0.2)',
          }}
        >
          {applying ? `Aplicando... ${progress ? `${progress.current}/${progress.total}` : ''}` : `Aplicar (${selectedIds.size})`}
        </button>
        <button
          onClick={handleRevert}
          disabled={selectedIds.size === 0 || applying}
          className="rounded-lg border border-red-800 px-5 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-900/20 disabled:opacity-40"
        >
          Reverter
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
              <span>{progress.current}/{progress.total}</span>
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
            {lastResult.succeeded} tweaks aplicados
            {lastResult.failed > 0 && `, ${lastResult.failed} falhas`}
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
                <span className="font-medium">Reinicialização necessária</span>
                <ul className="mt-1 list-inside list-disc text-yellow-300/80">
                  {lastResult.rebootRequired.map((t) => (
                    <li key={t.id}>{t.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {lastResult.logoffRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-800 bg-blue-900/10 px-4 py-3 text-sm text-blue-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-medium">Re-logue necessária</span>
                <ul className="mt-1 list-inside list-disc text-blue-300/80">
                  {lastResult.logoffRequired.map((t) => (
                    <li key={t.id}>{t.name}</li>
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
            {revertResult.succeeded} tweaks revertidos
            {revertResult.failed > 0 && `, ${revertResult.failed} falhas`}
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

      {/* DNS Presets */}
      {dnsPresets.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <Globe className="h-4 w-4 text-cyan-400" />
            DNS Presets
          </h3>
          <div className="flex flex-wrap gap-2">
            {dnsPresets.map((preset) => (
              <button
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
                onClick={() => store.getState().toggleCategory(cat.id)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-all hover:bg-white/[0.02]"
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: cat.glow }}
                >
                  <cat.icon className="h-4 w-4" style={{ color: cat.color }} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-zinc-200">{cat.label}</div>
                  <div className="text-xs text-zinc-500">
                    {stats.applied}/{stats.total} ativos
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
                      {catTweaks.map(({ tweak, applied }) => {
                        const isSelected = selectedIds.has(tweak.id)
                        return (
                          <div
                            key={tweak.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-all hover:bg-white/[0.03]"
                            onClick={() => handleToggle(tweak.id)}
                          >
                            <div
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
                                isSelected
                                  ? 'border-cyan-500 bg-cyan-500'
                                  : applied
                                    ? 'border-green-700 bg-green-900/30'
                                    : 'border-zinc-700'
                              }`}
                            >
                              {isSelected ? (
                                <span className="text-[10px] font-bold text-white">✓</span>
                              ) : applied ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                              ) : null}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-zinc-200">{tweak.name}</span>
                                {tweak.experimental && (
                                  <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
                                    EXP
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-zinc-600">
                                {tweak.hive}\\{tweak.path} • {tweak.key}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-zinc-400">
                                {tweak.kind === 'DWord' ? String(tweak.optimizedValue) : tweak.optimizedValue as string}
                              </div>
                              <div className="text-[10px] text-zinc-600">{tweak.level}</div>
                            </div>
                          </div>
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
