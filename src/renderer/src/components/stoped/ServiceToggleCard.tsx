import type { StopedServiceState } from '@shared/types'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Toggle } from './Toggle'

interface ServiceToggleCardProps {
  service: StopedServiceState
  description: string
  label: string
  onToggle: (enabled: boolean) => void
  disabled?: boolean
  busy?: boolean
}

export function ServiceToggleCard({
  service,
  label,
  description,
  onToggle,
  disabled = false,
  busy = false,
}: ServiceToggleCardProps) {
  const { t } = useTranslation('stoped')
  const isRunning = service.found && service.running
  const enabledState = isRunning
  const statusText = enabledState ? t('statusRunning') : t('statusStopped')
  const statusClass = enabledState ? 'text-emerald-400' : 'text-red-400'

  return (
    <div
      className="group flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: 'var(--card-bg)',
        borderColor: enabledState ? 'rgba(34,197,94,0.25)' : 'var(--border-subtle)',
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-semibold text-white">{label}</h3>
          <span className="truncate rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {service.name}
          </span>
          {!service.found && (
            <span
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
              style={{ background: 'rgba(245,158,11,0.15)' }}
              title={t('missingTooltip')}
            >
              <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              {t('missing')}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className={`text-xs font-semibold ${statusClass}`} data-testid={`stoped-status-${service.id}`}>
            {statusText}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t(enabledState ? 'toggleOn' : 'toggleOff')}
          </span>
        </div>
        <Toggle
          checked={enabledState}
          disabled={disabled || busy || !service.found}
          onChange={(next) => onToggle(next)}
          ariaLabel={`${label} - ${enabledState ? t('statusRunning') : t('statusStopped')}`}
          data-testid={`stoped-toggle-${service.id}`}
        />
      </div>
    </div>
  )
}
