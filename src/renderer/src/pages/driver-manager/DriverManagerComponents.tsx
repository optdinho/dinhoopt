import type { DriverPackage, DriverUpdate } from '@shared/types'
import { CircleArrowUp, CircleCheckBig, Cpu, TriangleAlert } from 'lucide-react'
import { Checkbox } from '@/components/shared/Checkbox'
import { formatBytes } from '@/lib/utils'

export function UpdateItemRow({
  upd,
  t,
  onToggle,
}: {
  upd: DriverUpdate
  t: (key: string, options?: Record<string, unknown>) => string
  onToggle: (id: string) => void
}) {
  return (
    <div
      onClick={() => onToggle(upd.id)}
      onKeyDown={() => onToggle(upd.id)}
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
        <CircleArrowUp className="h-5 w-5" style={{ color: '#3b82f6' }} strokeWidth={1.8} />
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
          {upd.provider} — {upd.currentVersion ? `v${upd.currentVersion}` : t('driverManager.versionUnknown')} → v
          {upd.availableVersion}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {upd.downloadSize && <span className="text-[12px] font-medium text-zinc-400">{upd.downloadSize}</span>}
        {upd.availableDate && (
          <div className="mt-0.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {upd.availableDate}
          </div>
        )}
      </div>
    </div>
  )
}

export function StaleItemRow({ pkg, onToggle }: { pkg: DriverPackage; onToggle: (id: string) => void }) {
  return (
    <div
      onClick={() => onToggle(pkg.id)}
      onKeyDown={() => onToggle(pkg.id)}
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
        <TriangleAlert className="h-5 w-5" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
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

export function InstalledDriverRow({
  drv,
  t,
}: {
  drv: DriverUpdate
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const isUpToDate = drv.isUpToDate !== false
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-5 py-3"
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: isUpToDate ? 'rgba(34,197,94,0.08)' : 'rgba(59,130,246,0.08)' }}
      >
        {isUpToDate ? (
          <CircleCheckBig className="h-4 w-4 text-green-500" strokeWidth={1.8} />
        ) : (
          <Cpu className="h-4 w-4 text-blue-400" strokeWidth={1.8} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[12px] font-medium text-zinc-400 truncate">{drv.deviceName}</span>
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
            style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa' }}
          >
            {drv.className}
          </span>
        </div>
        <span className="text-[10px] truncate block" style={{ color: 'var(--text-muted)' }}>
          {drv.provider}
        </span>
      </div>
      <span className="text-[11px] font-mono text-zinc-600 shrink-0">{drv.currentVersion || '—'}</span>
      {isUpToDate ? (
        <span
          className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
          style={{ background: 'rgba(34,197,94,0.06)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.1)' }}
        >
          {t('driverManager.currentBadge')}
        </span>
      ) : (
        <span
          className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
          style={{ background: 'rgba(59,130,246,0.08)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.12)' }}
        >
          {t('driverManager.updateAvailableBadge')}
        </span>
      )}
    </div>
  )
}
