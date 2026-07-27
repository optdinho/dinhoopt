import { Loader2, RefreshCw, Shield, Sparkles } from 'lucide-react'

interface ServiceBulkActionsProps {
  isBusy: boolean
  scanning: boolean
  applying: boolean
  hasScanned: boolean
  totalSafeToDisable: number
  selectedActiveCount: number
  selectedDisabledCount: number
  onScan: () => void
  onSelectRecommended: () => void
  onDisableSelected: () => void
  onEnableSelected: () => void
}

export function ServiceBulkActions({
  isBusy,
  scanning,
  applying,
  hasScanned,
  totalSafeToDisable,
  selectedActiveCount,
  selectedDisabledCount,
  onScan,
  onSelectRecommended,
  onDisableSelected,
  onEnableSelected,
}: ServiceBulkActionsProps) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <button
        type="button"
        onClick={onScan}
        disabled={isBusy}
        className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
        style={{
          background: isBusy ? '#27272a' : 'var(--accent)',
          opacity: isBusy ? 0.5 : 1,
        }}
      >
        {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
        {scanning ? 'Scanning...' : 'Scan Services'}
      </button>

      {hasScanned && (
        <>
          <button
            type="button"
            onClick={onSelectRecommended}
            disabled={isBusy || totalSafeToDisable === 0}
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-all"
            style={{
              background: 'rgba(34,197,94,0.10)',
              color: '#22c55e',
              border: '1px solid rgba(34,197,94,0.20)',
              opacity: isBusy || totalSafeToDisable === 0 ? 0.5 : 1,
            }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2} />
            Select Recommended ({totalSafeToDisable})
          </button>

          {selectedActiveCount > 0 && (
            <button
              type="button"
              onClick={onDisableSelected}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
              style={{
                background: !isBusy ? '#dc2626' : '#27272a',
                opacity: isBusy ? 0.5 : 1,
              }}
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" strokeWidth={2} />
              )}
              {applying ? 'Applying...' : `Disable (${selectedActiveCount})`}
            </button>
          )}
          {selectedDisabledCount > 0 && (
            <button
              type="button"
              onClick={onEnableSelected}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
              style={{
                background: !isBusy ? '#22c55e' : '#27272a',
                opacity: isBusy ? 0.5 : 1,
              }}
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" strokeWidth={2} />
              )}
              {applying ? 'Applying...' : `Enable (${selectedDisabledCount})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
