import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Circle, Link2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServiceStore } from '@/stores/service-store'
import type { ServiceCategory, ServiceSafety, WindowsService } from '@shared/types'

// ── Constants ─────────────────────────────────────────────────────

export const SAFETY_COLORS = {
  safe: { dot: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.20)' },
  caution: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
  unsafe: { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.20)' },
} as const

export const STATUS_COLORS: Record<string, string> = {
  Running: '#22c55e',
  Stopped: 'var(--text-muted)',
  StartPending: '#f59e0b',
  StopPending: '#f59e0b',
  Paused: '#f59e0b',
  Unknown: 'var(--text-muted)',
}

export const START_TYPE_KEY_MAP: Record<string, string> = {
  Automatic: 'serviceManager.startTypeAutomatic',
  Manual: 'serviceManager.startTypeManual',
  Disabled: 'serviceManager.startTypeDisabled',
  Unknown: 'serviceManager.startTypeUnknown',
}

export const STATUS_KEY_MAP: Record<string, string> = {
  Running: 'serviceManager.statusRunning',
  Stopped: 'serviceManager.statusStopped',
  Paused: 'serviceManager.statusPaused',
  StartPending: 'serviceManager.statusStartPending',
  StopPending: 'serviceManager.statusStopPending',
  Unknown: 'serviceManager.statusUnknown',
}

export const CATEGORY_LABEL_KEYS: Record<ServiceCategory | 'all', string> = {
  all: 'serviceManager.filterAllCategories',
  telemetry: 'serviceManager.categoryTelemetry',
  xbox: 'serviceManager.categoryXbox',
  print: 'serviceManager.categoryPrint',
  fax: 'serviceManager.categoryFax',
  media: 'serviceManager.categoryMedia',
  network: 'serviceManager.categoryNetwork',
  bluetooth: 'serviceManager.categoryBluetooth',
  remote: 'serviceManager.categoryRemote',
  'hyper-v': 'serviceManager.categoryHyperV',
  developer: 'serviceManager.categoryDeveloper',
  misc: 'serviceManager.categoryMisc',
  core: 'serviceManager.categoryCore',
  security: 'serviceManager.categorySecurity',
  unknown: 'serviceManager.categoryOther',
}

// ── Sub-components ───────────────────────────────────────────────

export function SafetyGroup({
  safetyKey,
  label,
  services,
}: {
  safetyKey: 'safe' | 'caution' | 'unsafe'
  label: string
  services: WindowsService[]
}) {
  const { t } = useTranslation('hardening')
  const [collapsed, setCollapsed] = useState(false)
  const colors = SAFETY_COLORS[safetyKey]
  const selectedInGroup = services.filter((s) => s.selected).length
  const alreadyDisabled = services.filter((s) => s.startType === 'Disabled').length

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: 'var(--card-bg)', border: `1px solid ${colors.border}` }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: colors.bg }}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: colors.dot }} strokeWidth={2} />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" style={{ color: colors.dot }} strokeWidth={2} />
        )}
        <Circle className="h-2.5 w-2.5 shrink-0" fill={colors.dot} stroke="none" />
        <span className="text-[13px] font-semibold" style={{ color: colors.dot }}>
          {label}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {t(services.length !== 1 ? 'serviceManager.servicesCountPlural' : 'serviceManager.servicesCount', {
            count: services.length,
          })}
          {alreadyDisabled > 0 && ` · ${t('serviceManager.alreadyDisabled', { count: alreadyDisabled })}`}
          {selectedInGroup > 0 && (
            <span style={{ color: colors.dot }}>
              {' '}
              · {t('serviceManager.selectedCount', { count: selectedInGroup })}
            </span>
          )}
        </span>
      </button>

      {!collapsed && (
        <>
          <div
            className="grid items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{
              gridTemplateColumns: '32px 1fr 120px 100px 60px',
              color: 'var(--text-muted)',
              borderTop: `1px solid ${colors.border}`,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span />
            <span>{t('serviceManager.columnService')}</span>
            <span>{t('serviceManager.columnStartupType')}</span>
            <span>{t('serviceManager.columnStatus')}</span>
            <span className="text-center">{t('serviceManager.columnDeps')}</span>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {services.map((svc) => (
              <ServiceRow key={svc.name} service={svc} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function ServiceRow({ service: svc }: { service: WindowsService }) {
  const { t } = useTranslation('hardening')
  const isUnsafe = svc.safety === 'unsafe'
  const colors = SAFETY_COLORS[svc.safety]

  return (
    <button
      type="button"
      onClick={() => !isUnsafe && useServiceStore.getState().toggleService(svc.name)}
      className="grid w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
      style={{
        gridTemplateColumns: '32px 1fr 120px 100px 60px',
        background: svc.selected ? colors.bg : 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: isUnsafe ? 'default' : 'pointer',
      }}
    >
      <div className="flex justify-center">
        <div
          className="flex h-[18px] w-[18px] items-center justify-center rounded"
          style={{
            border: `1.5px solid ${svc.selected ? colors.dot : isUnsafe ? 'var(--text-faint)' : 'var(--text-muted)'}`,
            background: svc.selected ? colors.dot : 'transparent',
            opacity: isUnsafe ? 0.4 : 1,
          }}
        >
          {svc.selected && <CheckCircle2 className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white">{svc.displayName}</span>
          {isUnsafe && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              {t('serviceManager.criticalBadge')}
            </span>
          )}
          {svc.incompatibleGames && svc.incompatibleGames.length > 0 && !isUnsafe && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
              title={svc.incompatibleGames.join(', ')}
            >
              <AlertTriangle className="-ml-0.5 mr-0.5 inline h-2.5 w-2.5" strokeWidth={2.5} />
              {t('serviceManager.notRecommendedForGames')}
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {svc.description || svc.name}
        </div>
      </div>

      <div>
        <span
          className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            background:
              svc.startType === 'Disabled'
                ? 'rgba(239,68,68,0.10)'
                : svc.startType === 'Automatic' || svc.startType === 'AutomaticDelayed'
                  ? 'rgba(59,130,246,0.10)'
                  : 'rgba(113,113,122,0.15)',
            color:
              svc.startType === 'Disabled'
                ? '#ef4444'
                : svc.startType === 'Automatic' || svc.startType === 'AutomaticDelayed'
                  ? '#60a5fa'
                  : '#a1a1aa',
          }}
        >
          {svc.startType === 'AutomaticDelayed'
            ? t('serviceManager.startTypeAutoDelayed')
            : t(START_TYPE_KEY_MAP[svc.startType] || 'serviceManager.startTypeUnknown')}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <div
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: STATUS_COLORS[svc.status] || 'var(--text-muted)' }}
        />
        <span className="text-[12px]" style={{ color: STATUS_COLORS[svc.status] || 'var(--text-muted)' }}>
          {t(STATUS_KEY_MAP[svc.status] || 'serviceManager.statusUnknown')}
        </span>
      </div>

      <div className="flex items-center justify-center gap-1">
        {svc.dependents.length > 0 && (
          <span
            className="flex items-center gap-0.5 text-[11px]"
            style={{ color: 'var(--text-muted)' }}
            title={t('serviceManager.dependentsTitle', { count: svc.dependents.length })}
          >
            <Link2 className="h-3 w-3" strokeWidth={1.8} />
            {svc.dependents.length}
          </span>
        )}
      </div>
    </button>
  )
}

export function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-[22px] font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

export function FilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg py-2 pl-3 pr-8 text-[12.5px] font-medium text-white outline-none"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
        style={{ color: 'var(--text-muted)' }}
        strokeWidth={2}
      />
    </div>
  )
}
