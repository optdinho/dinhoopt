import { Shield, Sparkles, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function ActionButtons({
  onQuickClean,
  onFullClean,
  onAutoMaintenance,
  isRunning,
  hasRegistry,
}: {
  onQuickClean: () => void
  onFullClean: () => void
  onAutoMaintenance?: () => void
  isRunning: boolean
  hasRegistry: boolean
}) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        type="button"
        onClick={onQuickClean}
        disabled={isRunning}
        className={cn(
          'glass-card glass-card-hover glow-amber depth-emphasis group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60',
        )}
      >
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            boxShadow: '0 0 20px rgba(245,158,11,0.2)',
          }}
        >
          <Sparkles className="h-5 w-5" style={{ color: 'var(--text-on-accent)' }} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-200">{t('quickCleanTitle')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {hasRegistry ? t('quickCleanDescriptionWithRegistry') : t('quickCleanDescriptionWithoutRegistry')}
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={onFullClean}
        disabled={isRunning}
        className={cn(
          'glass-card glass-card-hover glow-blue depth-emphasis group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60',
        )}
      >
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            boxShadow: '0 0 20px rgba(59,130,246,0.2)',
          }}
        >
          <Shield className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-200">{t('fullCleanTitle')}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {hasRegistry ? t('fullCleanDescriptionWithRegistry') : t('fullCleanDescriptionWithoutRegistry')}
          </p>
        </div>
      </button>

      {onAutoMaintenance && (
        <button
          type="button"
          onClick={onAutoMaintenance}
          disabled={isRunning}
          className={cn(
            'glass-card glass-card-hover glow-emerald depth-emphasis group relative flex items-center gap-4 rounded-2xl p-5 text-left transition-all disabled:opacity-60 sm:col-span-2 lg:col-span-1',
          )}
        >
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 0 20px rgba(16,185,129,0.25)',
            }}
          >
            <Wrench className="h-5 w-5 text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-200">{t('autoMaintenanceTitle')}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('autoMaintenanceDescription')}
            </p>
          </div>
        </button>
      )}
    </div>
  )
}
