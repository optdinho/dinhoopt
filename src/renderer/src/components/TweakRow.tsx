import type { WindowsTweakDef } from '@shared/types'
import { Check, CircleCheckBig } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface TweakRowProps {
  tweak: WindowsTweakDef
  applied: boolean
  selected: boolean
  accentColor: string
  accentGlow: string
  index: number
  onToggle: (id: string) => void
}

export const TweakRow = memo(function TweakRow({
  tweak,
  applied,
  selected,
  accentColor,
  accentGlow,
  index,
  onToggle,
}: TweakRowProps) {
  const { t } = useTranslation('windowsTweaks')
  return (
    <div
      className="group relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 hover:bg-white/[0.03]"
      style={{
        animation: 'stagger-fade 0.35s ease-out both',
        animationDelay: `${index * 30}ms`,
      }}
      onClick={() => onToggle(tweak.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle(tweak.id)
      }}
      role="button"
      tabIndex={0}
    >
      {/* Colored accent bar */}
      <div
        className="absolute left-0 top-[6px] h-[calc(100%-12px)] w-[2.5px] rounded-r-full opacity-0 transition-all duration-200 group-hover:opacity-100"
        style={{
          background: `linear-gradient(180deg, ${accentColor}, ${accentColor}88)`,
          boxShadow: `0 0 6px ${accentGlow}`,
        }}
      />

      {/* Checkbox */}
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
          selected
            ? 'border-cyan-500 bg-cyan-500'
            : applied
              ? 'border-green-700 bg-green-900/30'
              : 'border-zinc-700 group-hover:border-zinc-500'
        }`}
      >
        {selected ? (
          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        ) : applied ? (
          <CircleCheckBig className="h-3.5 w-3.5 text-green-400" />
        ) : null}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-200 transition-colors group-hover:text-white">
            {tweak.name}
          </span>
          {tweak.experimental && (
            <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
              {t('experimental')}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-400 transition-colors group-hover:text-zinc-300">
          {tweak.description}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-600">
          {tweak.hive}\\{tweak.path} • {tweak.key}
        </div>
      </div>

      {/* Value + Level */}
      <div className="text-right">
        <div
          className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-all"
          style={{
            color: selected ? accentColor : applied ? '#4ade80' : 'var(--text-dim)',
            background: selected ? `${accentGlow}` : applied ? 'rgba(34,197,94,0.08)' : 'transparent',
          }}
        >
          {tweak.kind === 'DWord' ? String(tweak.optimizedValue) : (tweak.optimizedValue as string)}
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-600">{tweak.level}</div>
      </div>
    </div>
  )
})
