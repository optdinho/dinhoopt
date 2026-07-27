import { Skeleton } from '@/components/shared/Skeleton'
import { useDashboardStore } from '@/stores/dashboard-store'

export const CLEANER_SCAN_FNS = useDashboardStore.getState().cleanerFns

export function MiniGaugeSkeleton() {
  return (
    <div className="glass-card flex flex-col items-center gap-2 rounded-xl px-3 py-4">
      <Skeleton className="h-10 w-10 rounded-lg" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}
