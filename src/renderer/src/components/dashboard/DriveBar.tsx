import { formatBytes } from '@/lib/utils'
import type { DriveInfo } from '@shared/types'
import { HardDrive } from 'lucide-react'

export function DriveBar({ drive, platform }: { drive: DriveInfo; platform: string }) {
  const usedPercent = (drive.usedSpace / drive.totalSize) * 100
  const barColor = usedPercent > 90 ? '#ef4444' : usedPercent > 75 ? '#f59e0b' : '#22c55e'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.6} />
          <span className="max-w-[180px] truncate text-sm font-medium text-zinc-300" title={platform === 'win32' ? `${drive.letter}: ${drive.label}` : `${drive.letter} ${drive.label}`}>
            {platform === 'win32' ? `${drive.letter}: ${drive.label}` : `${drive.letter} ${drive.label}`}
          </span>
        </div>
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {formatBytes(drive.usedSpace)} / {formatBytes(drive.totalSize)}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${usedPercent}%`,
            background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`,
            boxShadow: `0 0 8px ${barColor}30`,
          }}
        />
      </div>
    </div>
  )
}
