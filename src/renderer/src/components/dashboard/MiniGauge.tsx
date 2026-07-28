import type { LucideIcon } from 'lucide-react'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'

export function MiniGauge({
  icon: Icon,
  label,
  percent,
  detail,
  accentColor,
}: {
  icon: LucideIcon
  label: string
  percent: number
  detail: string
  accentColor?: string
}) {
  const animatedPct = Math.round(useAnimatedCounter(percent))
  const color = accentColor ?? (percent >= 85 ? '#ef4444' : percent >= 60 ? '#f59e0b' : '#22c55e')

  return (
    <div className="glass-card glass-card-hover group relative flex flex-col items-center gap-2 overflow-hidden rounded-xl px-2 py-3 sm:px-3 sm:py-4 transition-shadow duration-300 hover:shadow-[0_0_32px_rgba(139,92,246,0.12)]">
      <div
        className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_12px]"
        style={{
          background: `${color}18`,
          border: `1px solid ${color}30`,
          boxShadow: `0 0 8px ${color}30`,
          transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        }}
      >
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color }} strokeWidth={1.8} />
      </div>
      <p className="text-sm font-semibold text-zinc-200">{label}</p>
      <p className="truncate text-xs font-medium" style={{ color: 'var(--text-dim)' }}>
        {animatedPct}% &middot; {detail}
      </p>
      <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-700 animate-shimmer"
          style={{
            width: `${animatedPct}%`,
            backgroundImage: `linear-gradient(90deg, ${color}, ${color}cc, ${color})`,
            backgroundSize: '200% 100%',
          }}
        />
      </div>
    </div>
  )
}
