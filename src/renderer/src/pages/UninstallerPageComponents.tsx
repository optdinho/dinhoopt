import type { UninstallProgress, UninstallResult } from '@shared/types'
import { AlertTriangle, CheckCircle2, Loader2, Shield, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import { formatBytes } from '@/lib/utils'
import { useUninstallerStore, UNUSED_THRESHOLD_DAYS } from '@/stores/uninstaller-store'
import type { InstalledProgram } from '@shared/types'

export function UninstallProgressBanner({
  progress,
  t,
}: { progress: UninstallProgress; t: TFunction }) {
  return (
    <div
      className="mb-5 rounded-2xl p-4"
      style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
          <span className="text-[13px] font-medium text-zinc-200">
            {progress.phase === 'uninstalling'
              ? t('progressUninstalling', { programName: progress.currentProgram })
              : progress.phase === 'force-removing'
                ? t('progressForceRemoving', { programName: progress.currentProgram })
                : progress.phase === 'scanning-leftovers'
                  ? t('progressScanningLeftovers')
                  : progress.phase === 'cleaning-leftovers'
                    ? t('progressCleaningLeftovers')
                    : t('progressLoading')}
          </span>
        </div>
        <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {progress.progress}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress.progress}%`, background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)' }}
        />
      </div>
      <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
        {progress.detail}
      </p>
    </div>
  )
}

export function UninstallResultBanner({
  uninstallResult,
  lastFailedProgram,
  uninstalling,
  onForceRemove,
  t,
}: {
  uninstallResult: UninstallResult
  lastFailedProgram: InstalledProgram | null
  uninstalling: boolean
  onForceRemove: (program: InstalledProgram) => void
  t: TFunction
}) {
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-2xl p-4"
      style={{
        background: uninstallResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        border: `1px solid ${uninstallResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
      }}
    >
      {uninstallResult.success ? (
        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
      ) : (
        <Shield className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
      )}
      <div className="text-[13px] text-zinc-200">
        {uninstallResult.success ? (
          <p>
            {t('successfullyUninstalled')} <span className="font-medium">{uninstallResult.programName}</span>
            {uninstallResult.leftoversCleaned > 0 && (
              <span className="text-green-400">
                {' '}
                —{' '}
                {uninstallResult.leftoversCleaned !== 1
                  ? t('leftoversCleanedPlural', {
                      count: uninstallResult.leftoversCleaned,
                      size: formatBytes(uninstallResult.leftoversSize),
                    })
                  : t('leftoversCleaned', {
                      count: uninstallResult.leftoversCleaned,
                      size: formatBytes(uninstallResult.leftoversSize),
                    })}
              </span>
            )}
            {uninstallResult.leftoversFound === 0 && (
              <span style={{ color: 'var(--text-muted)' }}> — {t('noLeftoverFilesFound')}</span>
            )}
          </p>
        ) : (
          <p>
            {t('failedToUninstall')} <span className="font-medium">{uninstallResult.programName}</span>
            {uninstallResult.error && (
              <span style={{ color: 'var(--text-muted)' }}> — {uninstallResult.error}</span>
            )}
          </p>
        )}
      </div>
      {!uninstallResult.success && lastFailedProgram && lastFailedProgram.registryKey && (
        <button
          type="button"
          onClick={() => onForceRemove(lastFailedProgram)}
          disabled={uninstalling}
          className="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-amber-400 transition-all hover:bg-amber-500/10 disabled:opacity-30"
          style={{ border: '1px solid rgba(245,158,11,0.15)' }}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('forceRemoveButton')}
        </button>
      )}
    </div>
  )
}

export function UnusedProgramsBanner({
  unusedPrograms,
  unusedTotalSize,
  t,
}: {
  unusedPrograms: InstalledProgram[]
  unusedTotalSize: number
  t: TFunction
}) {
  return (
    <div
      className="mb-5 flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-colors hover:border-amber-500/20"
      style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
      onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
      onKeyDown={() => useUninstallerStore.getState().setFilterMode('unused')}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <div>
          <p className="text-[13px] font-medium text-zinc-200">
            {unusedPrograms.length !== 1
              ? t('unusedBannerTitlePlural', { count: unusedPrograms.length, days: UNUSED_THRESHOLD_DAYS })
              : t('unusedBannerTitle', { count: unusedPrograms.length, days: UNUSED_THRESHOLD_DAYS })}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {unusedTotalSize > 0
              ? t('unusedBannerDescriptionWithSize', { size: formatBytes(unusedTotalSize) })
              : t('unusedBannerDescriptionNoSize')}
          </p>
        </div>
      </div>
      <span
        className="rounded-full px-3 py-1 text-[11px] font-medium"
        style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-hover)' }}
      >
        {t('unusedBannerViewButton')}
      </span>
    </div>
  )
}

export function SafeUninstallNotice({ t }: { t: TFunction }) {
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
      style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.08)' }}
    >
      <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
      <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        <span className="font-semibold text-amber-500">{t('safeUninstallLabel')}</span> —{' '}
        {t('safeUninstallDescription')}
      </p>
    </div>
  )
}
