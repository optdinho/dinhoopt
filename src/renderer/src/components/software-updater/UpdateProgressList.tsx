import { CircleCheckBig, Loader2, CircleX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdateProgress } from '@shared/types'

export interface UpdateProgressListProps {
  progress: UpdateProgress | null
  updateResult: {
    succeeded: number
    failed: number
    errors: Array<{ appId: string; name: string; reason: string }>
  } | null
  packageManagerName: string | null
}

export function UpdateProgressList({ progress, updateResult, packageManagerName }: UpdateProgressListProps) {
  const { t } = useTranslation('updates')

  return (
    <>
      {progress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid var(--accent-muted-bg)',
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {t('softwareUpdater.updatingProgress', {
                  app: progress.currentApp,
                  current: progress.current,
                  total: progress.total,
                })}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {progress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.percent}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
              }}
            />
          </div>
          {progress.status === 'failed' && (
            <p className="mt-2 text-[11px] text-red-400">
              {t('softwareUpdater.failedToUpdate', { app: progress.currentApp })}
            </p>
          )}
        </div>
      )}

      {updateResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background: updateResult.failed === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${updateResult.failed === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          {updateResult.failed === 0 ? (
            <CircleCheckBig className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          ) : (
            <CircleX className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {updateResult.succeeded > 0 && (
              <span className="text-green-400">
                {updateResult.succeeded !== 1
                  ? t('softwareUpdater.updateResultAppsUpdatedPlural', { count: updateResult.succeeded })
                  : t('softwareUpdater.updateResultAppsUpdated', { count: updateResult.succeeded })}
              </span>
            )}
            {updateResult.succeeded > 0 && updateResult.failed > 0 && <span> — </span>}
            {updateResult.failed > 0 && (
              <span className="text-red-400">
                {t('softwareUpdater.updateResultFailed', { count: updateResult.failed })}
              </span>
            )}
            {updateResult.errors.length > 0 && (
              <div className="mt-2">
                {updateResult.errors.map((e) => {
                  const isInstallerChange = e.reason.toLowerCase().includes('installer type changed')
                  return (
                    <div key={e.appId} className="mt-1.5">
                      <span style={{ color: 'var(--text-muted)' }} className="text-[12px]">
                        {e.name}: {e.reason}
                      </span>
                      {isInstallerChange && packageManagerName && (
                        <div
                          className="mt-1.5 rounded-lg px-3 py-2 font-mono text-[11px] text-zinc-300 select-all cursor-text"
                          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-medium)' }}
                        >
                          {packageManagerName} uninstall {e.appId}
                          <br />
                          {packageManagerName} install {e.appId}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
