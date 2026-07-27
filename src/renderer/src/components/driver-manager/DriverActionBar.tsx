import { Loader2, Search, Shield, Sparkles } from 'lucide-react'

export interface DriverActionBarProps {
  isScanning: boolean
  isBusy: boolean
  applying: boolean
  installing: boolean
  cleaning: boolean
  totalSelected: number
  onScan: () => void
  onApply: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function DriverActionBar({
  isScanning,
  isBusy,
  applying,
  installing,
  cleaning,
  totalSelected,
  onScan,
  onApply,
  t,
}: DriverActionBarProps) {
  return (
    <>
      <div className="mb-5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onScan}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
        >
          <Search className={`h-4 w-4 ${isScanning ? 'animate-pulse' : ''}`} strokeWidth={1.8} />
          {isScanning ? t('driverManager.scanningButton') : t('driverManager.scanDriversButton')}
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={totalSelected === 0 || isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff' }}
        >
          {applying ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          )}
          {applying
            ? installing
              ? t('driverManager.installingButton')
              : cleaning
                ? t('driverManager.cleaningButton')
                : t('driverManager.applyingButton')
            : t('driverManager.updateAndCleanButton', { count: totalSelected })}
        </button>
      </div>

      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-bg)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold text-amber-500">{t('driverManager.safeOperationBold')}</span> —{' '}
          {t('driverManager.safeOperationText')}
        </p>
      </div>
    </>
  )
}
