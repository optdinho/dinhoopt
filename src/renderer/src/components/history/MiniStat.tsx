import type { LucideIcon } from 'lucide-react'

export function MiniStat({
  icon: Icon,
  label,
  value,
  color,
}: { icon: LucideIcon; label: string; value: string; color: string }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.8} />
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <span className="text-[20px] font-bold tracking-tight text-zinc-100">{value}</span>
    </div>
  )
}
