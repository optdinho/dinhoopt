import { Checkbox } from '@/components/shared/Checkbox'
import { formatBytes } from '@/lib/utils'
import { useDriverStore } from '@/stores/driver-store'
import type { DriverPackage, DriverUpdate } from '@shared/types'
import { AlertTriangle, ArrowUpCircle } from 'lucide-react'

export function DriverUpdateItem({ upd }: { upd: DriverUpdate }) {
  return (
    <div
      onClick={() => useDriverStore.getState().toggleUpdate(upd.id)}
      onKeyDown={() => useDriverStore.getState().toggleUpdate(upd.id)}
      role="button"
      tabIndex={0}
      className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors cursor-pointer"
      style={{
        background: upd.selected ? 'rgba(59,130,246,0.04)' : 'var(--bg-subtle)',
        border: `1px solid ${upd.selected ? 'rgba(59,130,246,0.1)' : 'var(--border-subtle)'}`,
      }}
    >
      <Checkbox checked={upd.selected} />
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'rgba(59,130,246,0.1)' }}
      >
        <ArrowUpCircle className="h-5 w-5" style={{ color: '#3b82f6' }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-zinc-200">{upd.deviceName}</span>
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-medium"
            style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}
          >
            {upd.className}
          </span>
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {upd.provider} — {upd.currentVersion ? `v${upd.currentVersion}` : 'Unknown'}{' '}
          → v{upd.availableVersion}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {upd.downloadSize && (
          <span className="text-[12px] font-medium text-zinc-400">{upd.downloadSize}</span>
        )}
        {upd.availableDate && (
          <div className="mt-0.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {upd.availableDate}
          </div>
        )}
      </div>
    </div>
  )
}

export function DriverStalePackageItem({ pkg }: { pkg: DriverPackage }) {
  return (
    <div
      onClick={() => useDriverStore.getState().togglePackage(pkg.id)}
      onKeyDown={() => useDriverStore.getState().togglePackage(pkg.id)}
      role="button"
      tabIndex={0}
      className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors cursor-pointer"
      style={{
        background: pkg.selected ? 'rgba(245,158,11,0.04)' : 'var(--bg-subtle)',
        border: `1px solid ${pkg.selected ? 'rgba(245,158,11,0.1)' : 'var(--border-subtle)'}`,
      }}
    >
      <Checkbox checked={pkg.selected} />
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: 'rgba(245,158,11,0.1)' }}
      >
        <AlertTriangle className="h-5 w-5" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-zinc-200">{pkg.originalName}</span>
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-medium"
            style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa' }}
          >
            {pkg.className}
          </span>
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {pkg.provider} — v{pkg.version}
          {pkg.date ? ` — ${pkg.date}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-[12px] font-medium text-zinc-400">{formatBytes(pkg.size)}</span>
        <div className="mt-0.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {pkg.publishedName}
        </div>
      </div>
    </div>
  )
}
