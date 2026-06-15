import { StatCard } from '@/components/shared/StatCard'
import { AlertTriangle, CheckCircle2, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function UpdateStats({
  totalCount,
  majorCount,
  minorCount,
  patchCount,
}: {
  totalCount: number
  majorCount: number
  minorCount: number
  patchCount: number
}) {
  const { t } = useTranslation('updates')
  return (
    <div className="grid grid-cols-4 gap-3 mb-5">
      <StatCard icon={Package} label={t('softwareUpdater.statOutdatedApps')} value={totalCount} variant="accent" />
      <StatCard
        icon={AlertTriangle}
        label={t('softwareUpdater.statMajorUpdates')}
        value={majorCount}
        variant="danger"
      />
      <StatCard
        icon={AlertTriangle}
        label={t('softwareUpdater.statMinorUpdates')}
        value={minorCount}
        variant="default"
      />
      <StatCard icon={CheckCircle2} label={t('softwareUpdater.statPatches')} value={patchCount} variant="success" />
    </div>
  )
}
