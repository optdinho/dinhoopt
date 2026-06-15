import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-lg', className)}
      style={{
        background: 'var(--bg-subtle-2)',
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      aria-hidden="true"
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-2xl p-5', className)}
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-1 h-8 w-20" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      {Array.from({ length: cols }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  )
}

export function SkeletonGauge({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-2xl p-5', className)}
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-4 flex items-center justify-center">
        <Skeleton className="h-24 w-24 rounded-full" />
      </div>
      <Skeleton className="mx-auto mb-1 h-4 w-20" />
      <Skeleton className="mx-auto h-3 w-32" />
    </div>
  )
}
