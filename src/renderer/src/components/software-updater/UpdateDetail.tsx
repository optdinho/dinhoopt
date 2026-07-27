import { CircleCheckBig, Download, Package, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { StatCard } from '@/components/shared/StatCard'
import { useUpdaterStore } from '@/stores/updater-store'

export interface UpdateDetailProps {
  hasChecked: boolean
  packageManagerAvailable: boolean
  packageManagerName: string | null
  appsCount: number
  error: string | null
  majorCount: number
  minorCount: number
  patchCount: number
  allSelected: boolean
  selectedCount: number
  loading: boolean
  updating: boolean
  onUpdateSelected: () => void
}

export function UpdateDetail({
  hasChecked,
  packageManagerAvailable,
  packageManagerName,
  appsCount,
  error,
  majorCount,
  minorCount,
  patchCount,
  allSelected,
  selectedCount,
  loading,
  updating,
  onUpdateSelected,
}: UpdateDetailProps) {
  const { t } = useTranslation('updates')

  return (
    <>
      {hasChecked && !packageManagerAvailable && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.1)',
          }}
        >
          <TriangleAlert className="h-5 w-5 shrink-0 text-red-400" strokeWidth={1.8} />
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
      )}

      {error && (
        <ErrorAlert message={error} onDismiss={() => useUpdaterStore.getState().setError(null)} className="mb-5" />
      )}

      {hasChecked && packageManagerAvailable && appsCount > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard icon={Package} label={t('softwareUpdater.statOutdatedApps')} value={appsCount} variant="accent" />
          <StatCard
            icon={TriangleAlert}
            label={t('softwareUpdater.statMajorUpdates')}
            value={majorCount}
            variant="danger"
          />
          <StatCard
            icon={TriangleAlert}
            label={t('softwareUpdater.statMinorUpdates')}
            value={minorCount}
            variant="default"
          />
          <StatCard
            icon={CircleCheckBig}
            label={t('softwareUpdater.statPatches')}
            value={patchCount}
            variant="success"
          />
        </div>
      )}

      {hasChecked && appsCount > 0 && !loading && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const store = useUpdaterStore.getState()
              allSelected ? store.deselectAll() : store.selectAll()
            }}
            disabled={updating}
            className="flex items-center gap-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          >
            <div
              className="flex h-4 w-4 items-center justify-center rounded"
              style={{
                background: allSelected ? 'var(--accent)' : 'var(--bg-hover-2)',
                border: allSelected ? 'none' : '1px solid var(--border-stronger)',
              }}
            >
              {allSelected && (
                <CircleCheckBig className="h-3 w-3" style={{ color: 'var(--text-on-accent)' }} strokeWidth={3} />
              )}
            </div>
            {allSelected ? t('softwareUpdater.deselectAll') : t('softwareUpdater.selectAll')}
          </button>

          {selectedCount > 0 && (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('softwareUpdater.selectedCount', { count: selectedCount })}
            </span>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={onUpdateSelected}
            disabled={selectedCount === 0 || updating}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
            style={{
              background: selectedCount > 0 ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'var(--bg-hover)',
              color: selectedCount > 0 ? '#052e16' : 'var(--text-muted)',
              border: selectedCount > 0 ? 'none' : '1px solid var(--border-medium)',
            }}
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            {t('softwareUpdater.updateSelectedButton', { count: selectedCount })}
          </button>
        </div>
      )}
    </>
  )
}
