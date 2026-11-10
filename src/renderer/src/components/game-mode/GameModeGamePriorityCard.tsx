import { motion } from 'framer-motion'
import { TriangleAlert, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface GameModeGamePriorityCardProps {
  enabled: boolean
  active: boolean
  onToggle: () => void
}

/**
 * Prominent call-out for the `cpu-game-priority` optimization. It lives at the
 * top of the page because it is the highest-impact toggle for most games, and
 * carries the mouse-software conflict warning that used to be buried in the
 * Processes category.
 */
export function GameModeGamePriorityCard({ enabled, active, onToggle }: GameModeGamePriorityCardProps) {
  const { t } = useTranslation('gameMode')

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="overflow-hidden rounded-xl"
      style={{
        border: enabled ? '1px solid var(--accent-muted-border)' : '1px solid var(--border-default)',
        background: enabled
          ? 'linear-gradient(135deg, var(--accent-muted-bg), var(--bg-subtle) 70%)'
          : 'var(--bg-subtle)',
      }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--accent-muted-bg)' }}
        >
          <Zap className="h-5 w-5" style={{ color: 'var(--accent)' }} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-zinc-100">{t('gamePriorityTitle')}</span>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
              style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
            >
              {t('gamePriorityBadge')}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">{t('gamePriorityDesc')}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={active}
          aria-label={t('gamePriorityTitle')}
          aria-pressed={enabled}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40"
          style={{ background: enabled ? 'var(--accent)' : 'var(--bg-active)' }}
        >
          <motion.div
            className="absolute top-0.5 h-5 w-5 rounded-full"
            animate={{ left: enabled ? 22 : 2, background: enabled ? '#fff' : 'var(--text-muted)' }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      <div
        className="flex items-start gap-2.5 px-5 py-3 text-[11px]"
        style={{ background: 'rgba(245,158,11,0.07)', borderTop: '1px solid rgba(245,158,11,0.15)' }}
      >
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: '#f59e0b' }} />
        <p className="text-amber-200/80">{t('gamePriorityWarning')}</p>
      </div>
    </motion.div>
  )
}
