import { memo } from 'react'

const DetailStat = memo(function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-subtle)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-[16px] font-semibold text-zinc-200">{value}</p>
    </div>
  )
})

export { DetailStat }
