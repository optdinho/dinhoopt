import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function PackageManagerWarning({ packageManagerName }: { packageManagerName: string }) {
  const { t } = useTranslation('updates')
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
      style={{
        background: 'rgba(239,68,68,0.04)',
        border: '1px solid rgba(239,68,68,0.1)',
      }}
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" strokeWidth={1.8} />
      <p className="text-[12px] text-zinc-400">
        {packageManagerName === 'brew' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.brewNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.brewRequired')}{' '}
            <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.brewSite')}</span>.
          </>
        ) : packageManagerName === 'winget' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.wingetNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.wingetRequired')}{' '}
            <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.wingetStore')}</span>{' '}
            {t('softwareUpdater.packageManagerNotFound.wingetSearchTerm')}
          </>
        ) : packageManagerName === 'choco' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.chocoNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.chocoRequired')}{' '}
            <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.chocoSite')}</span>.
          </>
        ) : packageManagerName === 'scoop' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.scoopNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.scoopRequired')}{' '}
            <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.scoopSite')}</span>.
          </>
        ) : packageManagerName === 'apt' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.aptNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.aptRequired')}
          </>
        ) : packageManagerName === 'dnf' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.dnfNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.dnfRequired')}
          </>
        ) : packageManagerName === 'pacman' ? (
          <>
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.pacmanNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.pacmanRequired')}
          </>
        ) : (
          <span className="font-semibold text-red-400">
            {t('softwareUpdater.packageManagerNotFound.noPackageManager')}
          </span>
        )}
      </p>
    </div>
  )
}
