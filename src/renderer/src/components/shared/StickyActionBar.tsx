import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

export interface StickyAction {
  label: string
  onClick: () => void
  icon?: LucideIcon
  variant?: 'accent' | 'danger' | 'neutral'
}

interface StickyActionBarProps {
  selectedCount: number
  totalLabel: string
  /** Single-action API (kept for existing callers). */
  onAction?: () => void
  actionLabel?: string
  actionIcon?: LucideIcon
  /** Multi-action API — takes precedence over the single-action props. */
  actions?: StickyAction[]
}

const ACTION_STYLES: Record<
  NonNullable<StickyAction['variant']>,
  { background: string; color: string; boxShadow: string }
> = {
  accent: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'var(--text-on-accent)',
    boxShadow: '0 4px 16px rgba(245,158,11,0.25)',
  },
  danger: {
    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    color: 'var(--text-on-accent)',
    boxShadow: '0 4px 16px rgba(239,68,68,0.25)',
  },
  neutral: {
    background: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    boxShadow: 'none',
  },
}

export function StickyActionBar({
  selectedCount,
  totalLabel,
  onAction,
  actionLabel,
  actionIcon: ActionIcon,
  actions,
}: StickyActionBarProps) {
  const items: StickyAction[] =
    actions && actions.length > 0
      ? actions
      : actionLabel && onAction
        ? [{ label: actionLabel, onClick: onAction, ...(ActionIcon ? { icon: ActionIcon } : {}) }]
        : []

  return (
    <AnimatePresence>
      {selectedCount > 0 && items.length > 0 && (
        <motion.div
          data-testid="sticky-action-bar"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
          className="fixed bottom-0 right-0 z-40 flex items-center justify-between gap-3 px-4 py-3 lg:px-10"
          style={{
            left: 'var(--sidebar-w, 250px)',
            background: 'var(--card-bg)',
            borderTop: '1px solid var(--border-medium)',
            boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              {selectedCount}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{totalLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {items.map((action) => {
              const variant = ACTION_STYLES[action.variant ?? 'accent']
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all active:scale-[0.98]"
                  style={{ background: variant.background, color: variant.color, boxShadow: variant.boxShadow }}
                >
                  {action.icon && <action.icon className="h-4 w-4" strokeWidth={2} />}
                  {action.label}
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
