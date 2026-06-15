import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ProgressBanner({
  isRunning,
  phaseLabel,
  stepProgress,
}: {
  isRunning: boolean
  phaseLabel: string
  stepProgress: { current: number; total: number }
}) {
  const { t } = useTranslation('dashboard')

  return (
    <AnimatePresence>
      {isRunning && (
        <motion.div
          initial={{ opacity: 0, y: -12, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -12, height: 0 }}
          transition={{ type: 'tween', ease: 'easeOut', duration: 0.3 }}
          className="glass-card depth-mid rounded-2xl px-5 py-4 overflow-hidden"
          style={{
            borderColor: 'rgba(245,158,11,0.2)',
            boxShadow: '0 0 20px rgba(245,158,11,0.04)',
          }}
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} />
            <span className="flex-1 text-sm text-zinc-400">{phaseLabel || t('progressWorking')}</span>
            {stepProgress.total > 0 && (
              <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                {stepProgress.current}/{stepProgress.total}
              </span>
            )}
          </div>
          {stepProgress.total > 0 && (
            <div className="mt-2.5 h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out animate-shimmer"
                style={{
                  width: `${(stepProgress.current / stepProgress.total) * 100}%`,
                  background: `linear-gradient(90deg, #f59e0b, #fbbf24, #d97706)`,
                  backgroundSize: '200% 100%',
                  boxShadow: '0 0 8px rgba(245,158,11,0.3)',
                }}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
