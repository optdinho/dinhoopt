import { formatBytes } from '@/lib/utils'
import { CircleCheckBig } from 'lucide-react'

interface InstallResult {
  installed: number
  failed: number
  rebootRequired: boolean
}

interface CleanResult {
  removed: number
  failed: number
  spaceRecovered: number
}

export interface ScanResultCardProps {
  installResult: InstallResult | null
  cleanResult: CleanResult | null
  t: (key: string, options?: Record<string, unknown>) => string
}

function ResultBanner({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-2xl p-4"
      style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
    >
      {icon}
      <div className="text-[13px] text-zinc-200">{children}</div>
    </div>
  )
}

export function ScanResultCard({ installResult, cleanResult, t }: ScanResultCardProps) {
  return (
    <>
      {installResult && (
        <ResultBanner icon={<CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />}>
          <p>
            {installResult.installed !== 1
              ? t('driverManager.installedDriverUpdatesPlural', { count: installResult.installed })
              : t('driverManager.installedDriverUpdates', { count: installResult.installed })}
            {installResult.failed > 0 && (
              <span className="text-red-400"> {t('driverManager.failedCount', { count: installResult.failed })}</span>
            )}
          </p>
          {installResult.rebootRequired && (
            <p className="mt-1 text-[12px] text-amber-400">{t('driverManager.rebootRequired')}</p>
          )}
        </ResultBanner>
      )}

      {cleanResult && (
        <ResultBanner icon={<CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />}>
          <p>
            {cleanResult.removed !== 1
              ? t('driverManager.removedStalePackagesPlural', { count: cleanResult.removed })
              : t('driverManager.removedStalePackages', { count: cleanResult.removed })}
            {cleanResult.spaceRecovered > 0 && (
              <span className="text-green-400">
                {' '}
                — {t('driverManager.spaceRecovered', { size: formatBytes(cleanResult.spaceRecovered) })}
              </span>
            )}
            {cleanResult.failed > 0 && (
              <span className="text-red-400"> {t('driverManager.failedCount', { count: cleanResult.failed })}</span>
            )}
          </p>
        </ResultBanner>
      )}
    </>
  )
}
