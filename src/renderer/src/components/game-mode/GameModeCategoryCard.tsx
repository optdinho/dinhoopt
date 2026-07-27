import { lookupServiceSafety } from '@shared/service-safety-kb'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Plus, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useGameModeStore } from '@/stores/game-mode-store'
import { OPTIMIZATION_SERVICE_MAP, OPTIMIZATIONS } from './constants'
import type { CategoryDef } from './types'

interface GameModeCategoryCardProps {
  cat: CategoryDef
  catIndex: number
  enabledSet: Set<string>
  customInput: string
  active: boolean
  onCustomInputChange: (v: string) => void
  onAddCustomProcess: () => void
  onRemoveCustomProcess: (name: string) => void
}

export function GameModeCategoryCard({
  cat,
  catIndex,
  enabledSet,
  customInput,
  active,
  onCustomInputChange,
  onAddCustomProcess,
  onRemoveCustomProcess,
}: GameModeCategoryCardProps) {
  const { t } = useTranslation('gameMode')
  const store = useGameModeStore
  const expandedCategories = useGameModeStore((s) => s.expandedCategories)
  const config = useGameModeStore((s) => s.config)
  const catOpts = OPTIMIZATIONS.filter((o) => o.category === cat.id)
  const enabledInCat = catOpts.filter((o) => enabledSet.has(o.id)).length
  const isExpanded = expandedCategories.has(cat.id)
  const CatIcon = cat.icon

  if (catOpts.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: catIndex * 0.05, duration: 0.3 }}
      className="group overflow-hidden rounded-xl transition-all duration-300"
      style={{
        border: `1px solid ${isExpanded ? `${cat.color}22` : 'var(--border-default)'}`,
        background: isExpanded ? `linear-gradient(135deg, ${cat.glow}, transparent)` : 'var(--bg-subtle)',
      }}
    >
      <button
        type="button"
        onClick={() => store.getState().toggleCategory(cat.id)}
        className="flex w-full items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300"
          style={{ background: `${cat.color}14`, boxShadow: isExpanded ? `0 0 12px ${cat.color}20` : 'none' }}
        >
          <CatIcon className="h-[18px] w-[18px]" style={{ color: cat.color }} strokeWidth={1.8} />
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-zinc-200">{t(cat.labelKey)}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: `${cat.color}14`, color: cat.color }}
            >
              {t('enabledCount', { count: enabledInCat })}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t(cat.descKey)}</p>
        </div>
        <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-600" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            {catOpts.map((opt) => {
              const isEnabled = enabledSet.has(opt.id)
              const serviceName = OPTIMIZATION_SERVICE_MAP[opt.id]
              const kbEntry = serviceName ? lookupServiceSafety(serviceName) : null
              const hasGameConflict = kbEntry?.incompatibleGames && kbEntry.incompatibleGames.length > 0
              return (
                <div
                  key={opt.id}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.01]"
                  style={{ borderBottom: '1px solid var(--bg-subtle)' }}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-300">{t(opt.labelKey)}</span>
                      {opt.requiresAdmin && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
                          style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
                        >
                          {t('adminBadge')}
                        </span>
                      )}
                      {hasGameConflict && (
                        <span
                          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
                          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
                        >
                          <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2.5} />
                          {t('notRecommendedForGames')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{t(opt.descKey)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => !active && store.getState().toggleOptimization(opt.id)}
                    disabled={active}
                    className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40"
                    style={{ background: isEnabled ? cat.color : 'var(--bg-active)' }}
                  >
                    <motion.div
                      className="absolute top-0.5 h-5 w-5 rounded-full"
                      animate={{ left: isEnabled ? 22 : 2, background: isEnabled ? '#fff' : 'var(--text-muted)' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </button>
                </div>
              )
            })}

            {cat.id === 'processes' && (
              <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--bg-subtle)' }}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => onCustomInputChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onAddCustomProcess()}
                    placeholder={t('customProcessPlaceholder')}
                    disabled={active}
                    className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-cyan-500/30 disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={onAddCustomProcess}
                    disabled={active || !customInput.trim()}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                    style={{ background: `${cat.color}14`, color: cat.color }}
                  >
                    <Plus className="h-3 w-3" />
                    {t('customProcessAdd')}
                  </button>
                </div>
                {config.customProcessKillList.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {config.customProcessKillList.map((name) => (
                      <span
                        key={name}
                        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
                        style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                      >
                        {name}
                        {!active && (
                          <button
                            type="button"
                            onClick={() => onRemoveCustomProcess(name)}
                            className="hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-zinc-600">{t('customProcessEmpty')}</p>
                )}
                {enabledSet.has('proc-kill-custom') && config.customProcessKillList.length > 0 && (
                  <p className="mt-2 text-[10px] text-amber-500/70">{t('warningProcesses')}</p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
