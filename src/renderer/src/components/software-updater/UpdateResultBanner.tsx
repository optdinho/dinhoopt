import type { UpdateResult } from '@shared/types'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function UpdateResultBanner({
  result,
  packageManagerName,
}: {
  result: UpdateResult
  packageManagerName: string | undefined
}) {
  const { t } = useTranslation('updates')
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-2xl p-4"
      style={{
        background: result.failed === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        border: `1px solid ${result.failed === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
      }}
    >
      {result.failed === 0 ? (
        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
      ) : (
        <XCircle className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
      )}
      <div className="text-[13px] text-zinc-200">
        {result.succeeded > 0 && (
          <span className="text-green-400">
            {result.succeeded !== 1
              ? t('softwareUpdater.updateResultAppsUpdatedPlural', { count: result.succeeded })
              : t('softwareUpdater.updateResultAppsUpdated', { count: result.succeeded })}
          </span>
        )}
        {result.succeeded > 0 && result.failed > 0 && <span> — </span>}
        {result.failed > 0 && (
          <span className="text-red-400">{t('softwareUpdater.updateResultFailed', { count: result.failed })}</span>
        )}
        {result.errors.length > 0 && (
          <div className="mt-2">
            {result.errors.map((e) => {
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
  )
}
