import type { PrivacySetting } from '@shared/types'
import { useTranslation } from 'react-i18next'

export interface PrivacySettingRowProps {
  setting: PrivacySetting
  depSetting: PrivacySetting | undefined
  depMissing: boolean
  toggleDisabled: boolean
  isLast: boolean
  onToggle: (settingId: string) => void
}

export function PrivacySettingRow({
  setting,
  depSetting,
  depMissing,
  toggleDisabled,
  isLast,
  onToggle,
}: PrivacySettingRowProps) {
  const { t } = useTranslation('hardening')

  return (
    <div
      className="flex items-center gap-4 px-5 py-3.5"
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--bg-subtle)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-zinc-300">{setting.label}</span>
          {setting.requiresAdmin && (
            <span
              className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
              style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
            >
              {t('privacy.adminBadge')}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {t(`privacy.descriptions.${setting.id}`, setting.description)}
        </p>
        {depMissing && depSetting && (
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--accent)' }}>
            {t('privacy.requiresSettingEnabled', { label: depSetting.label })}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onToggle(setting.id)}
        disabled={toggleDisabled}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
        style={{ background: setting.enabled ? '#22c55e' : 'var(--bg-active)' }}
      >
        <div
          className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
          style={{
            left: setting.enabled ? '22px' : '2px',
            background: setting.enabled ? '#fff' : 'var(--text-muted)',
          }}
        />
      </button>
    </div>
  )
}
