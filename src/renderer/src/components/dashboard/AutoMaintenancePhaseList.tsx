import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/shared/Checkbox'
import type { AutoMaintenanceOptions, AutoMaintenancePhase } from './auto-maintenance'

const PHASES: { key: AutoMaintenancePhase; labelKey: string }[] = [
  { key: 'systemRepair', labelKey: 'autoMaintenancePhaseSystemRepair' },
  { key: 'deepClean', labelKey: 'autoMaintenancePhaseDeepClean' },
  { key: 'registry', labelKey: 'autoMaintenancePhaseRegistry' },
  { key: 'softwareUpdates', labelKey: 'autoMaintenancePhaseSoftware' },
  { key: 'driverUpdates', labelKey: 'autoMaintenancePhaseDrivers' },
  { key: 'performance', labelKey: 'autoMaintenancePhasePerformance' },
]

export function AutoMaintenancePhaseList({
  options,
  onChange,
  hasRegistry,
  hasDrivers,
}: {
  options: AutoMaintenanceOptions
  onChange: (phase: AutoMaintenancePhase) => void
  hasRegistry: boolean
  hasDrivers: boolean
}) {
  const { t } = useTranslation('dashboard')

  const visible = PHASES.filter(
    (phase) => (phase.key !== 'registry' || hasRegistry) && (phase.key !== 'driverUpdates' || hasDrivers),
  )

  return (
    <fieldset className="mt-4">
      <legend className="mb-2 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {t('autoMaintenanceOptionsHeading')}
      </legend>
      <div className="space-y-1">
        {visible.map((phase) => (
          <button
            key={phase.key}
            type="button"
            role="checkbox"
            aria-checked={options[phase.key]}
            onClick={() => onChange(phase.key)}
            className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/[0.04]"
          >
            <Checkbox checked={options[phase.key]} aria-label={t(phase.labelKey)} />
            <span className="text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
              {t(phase.labelKey)}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}
