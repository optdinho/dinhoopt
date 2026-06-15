import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import type { DriveInfo } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { DriveBar } from './DriveBar'

export function StorageOverview({
  drives,
  platform,
}: {
  drives: DriveInfo[]
  platform: string
}) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="glass-card depth-mid rounded-2xl p-5">
      <h3 className="mb-5 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {t('storageOverviewHeading')}
      </h3>
      <StaggerContainer className="space-y-5">
        {drives.length === 0 && (
          <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('storageOverviewEmpty')}
          </p>
        )}
        {drives.map((drive) => (
          <StaggerItem key={drive.letter}>
            <DriveBar drive={drive} platform={platform} />
          </StaggerItem>
        ))}
      </StaggerContainer>
    </div>
  )
}
