import type { PrivacySetting } from '@shared/types'
import { CircleCheckBig } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { CategoryDef } from '@/pages/privacy/PrivacyShieldComponents'
import { usePrivacyStore } from '@/stores/privacy-store'
import { PrivacySettingRow } from './PrivacySettingRow'

export interface CategoryToggleProps {
  cat: CategoryDef
  state: {
    score: number
    total: number
    protected: number
    settings: PrivacySetting[]
  }
  isExpanded: boolean
  isApplying: boolean
  busy: boolean
  onApplyCategory: (categoryId: string) => void
  onToggleSingle: (settingId: string) => void
}

export function CategoryToggle({
  cat,
  state,
  isExpanded,
  isApplying,
  busy,
  onApplyCategory,
  onToggleSingle,
}: CategoryToggleProps) {
  const { t } = useTranslation('hardening')
  const catSettings = state.settings.filter((s) => s.category === cat.id)
  if (catSettings.length === 0) return null

  const protectedInCat = catSettings.filter((s) => s.enabled).length
  const allProtected = protectedInCat === catSettings.length
  const unprotectedInCat = catSettings.length - protectedInCat
  const CatIcon = cat.icon

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        border: `1px solid ${allProtected ? 'rgba(34,197,94,0.15)' : cat.border}`,
        opacity: isApplying ? 0.5 : 1,
        pointerEvents: isApplying ? 'none' : 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => usePrivacyStore.getState().toggleCategory(cat.id)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors"
        style={{ background: allProtected ? 'rgba(34,197,94,0.03)' : 'var(--bg-subtle)' }}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: allProtected ? 'rgba(34,197,94,0.1)' : cat.bg }}
        >
          <CatIcon className="h-5 w-5" style={{ color: allProtected ? '#22c55e' : cat.color }} strokeWidth={1.8} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[14px] font-semibold text-zinc-200">{t(cat.labelKey)}</span>
            {allProtected ? (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
              >
                {t('privacy.allProtectedBadge')}
              </span>
            ) : (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: cat.bg, color: cat.color }}
              >
                {t('privacy.unprotectedBadge', { count: unprotectedInCat })}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {t(cat.descriptionKey)}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!allProtected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onApplyCategory(cat.id)
              }}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
            >
              {t('privacy.protectAllCategoryButton')}
            </button>
          )}
          {allProtected && (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: 'rgba(34,197,94,0.1)' }}
            >
              <CircleCheckBig className="h-4 w-4 text-green-500" strokeWidth={2.5} />
            </div>
          )}
          <div
            className={cn('h-5 w-5 transition-transform', isExpanded ? 'rotate-180' : 'rotate-0')}
            style={{ color: 'var(--text-muted)' }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" role="img" aria-label={t('expandAria')}>
              <title>{t('expandAria')}</title>
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {catSettings.map((setting, i) => {
            const depSetting = setting.dependsOn ? state.settings.find((s) => s.id === setting.dependsOn) : undefined
            const depMissing = depSetting !== undefined && !depSetting.enabled
            const toggleDisabled = busy || depMissing || (setting.enabled && !setting.reversible)

            return (
              <PrivacySettingRow
                key={setting.id}
                setting={setting}
                depSetting={depSetting}
                depMissing={depMissing}
                toggleDisabled={toggleDisabled}
                isLast={i === catSettings.length - 1}
                onToggle={onToggleSingle}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
