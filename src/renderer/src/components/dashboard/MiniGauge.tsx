import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import type { LucideIcon } from 'lucide-react'

export function MiniGauge({
  icon: Icon,
  label,
  percent,
  detail,
}: {
  icon: LucideIcon
  label: string
  percent: number
  detail: string
}) {
  const animatedPct = Math.round(useAnimatedCounter(percent))
  const color = percent >= 85 ? '#ef4444' : percent >= 60 ? '#f59e0b' : '#22c55e'

  return (
    <div className="glass-card glass-card-hover group relative flex flex-col items-center gap-2 overflow-hidden rounded-xl px-3 py-4 transition-shadow duration-300 hover:shadow-[0_0_24px_rgba(139,92,246,0.06)]">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_12px]"
        style={{
          background: `${color}18`,
          border: `1px solid ${color}30`,
          boxShadow: `0 0 0px ${color}00`,
          transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        }}
      >
        <Icon className="h-5 w-5" style={{ color }} strokeWidth={1.8} />
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
