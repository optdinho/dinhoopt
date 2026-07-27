import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

interface StickyActionBarProps {
  selectedCount: number
  totalLabel: string
  onAction: () => void
  actionLabel: string
  actionIcon?: LucideIcon
}

export function StickyActionBar({
  selectedCount,
  totalLabel,
  onAction,
  actionLabel,
  actionIcon: ActionIcon,
}: StickyActionBarProps) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-3"
          style={{
            background: 'var(--card-bg)',
            borderTop: '1px solid var(--border-medium)',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold text-zinc-200">{selectedCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>{totalLabel}</span>
          </div>
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-2 rounded-xl px-5 py-2 text-[13px] font-semibold transition-all active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: 'var(--text-on-accent)',
              boxShadow: '0 4px 16px rgba(245,158,11,0.25)',
            }}
          >
            {ActionIcon && <ActionIcon className="h-4 w-4" strokeWidth={2} />}
            {actionLabel}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
