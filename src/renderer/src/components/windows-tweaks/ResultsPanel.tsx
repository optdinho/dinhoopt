import { CircleCheckBig, CircleX, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TweakResult {
  succeeded: number
  failed: number
  errors: { id: string; name: string; reason: string }[]
  rebootRequired: { id: string; name: string }[]
  logoffRequired: { id: string; name: string }[]
}

interface ResultsPanelProps {
  lastResult: TweakResult | null
  revertResult: Pick<TweakResult, 'succeeded' | 'failed' | 'errors'> | null
}

export function ResultsPanel({ lastResult, revertResult }: ResultsPanelProps) {
  const { t } = useTranslation('windowsTweaks')

  if (!lastResult && !revertResult) return null

  return (
    <>
      {lastResult && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-green-800 bg-green-900/10 px-4 py-3 text-sm text-green-400">
            <CircleCheckBig className="h-4 w-4 shrink-0" />
            {t('tweaksAppliedResult', { count: lastResult.succeeded })}
            {lastResult.failed > 0 && `, ${t('tweaksFailedResult', { count: lastResult.failed })}`}
          </div>
          {lastResult.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-800 bg-red-900/10 px-4 py-3 text-sm">
              {lastResult.errors.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-red-400">
                  <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <span className="font-medium">{e.name}</span>
                    <span className="ml-2 text-red-300/80">{e.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {lastResult.rebootRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-800 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-400">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-medium">{t('restartRequired', 'Restart required')}</span>
                <ul className="mt-1 list-inside list-disc text-yellow-300/80">
                  {lastResult.rebootRequired.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {lastResult.logoffRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-800 bg-blue-900/10 px-4 py-3 text-sm text-blue-400">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-medium">{t('relogRequired', 'Re-login required')}</span>
                <ul className="mt-1 list-inside list-disc text-blue-300/80">
                  {lastResult.logoffRequired.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
      {revertResult && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-yellow-800 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-400">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {t('tweaksRevertedResult', { count: revertResult.succeeded })}
            {revertResult.failed > 0 && `, ${t('tweaksFailedResult', { count: revertResult.failed })}`}
          </div>
          {revertResult.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-800 bg-red-900/10 px-4 py-3 text-sm">
              {revertResult.errors.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-red-400">
                  <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <span className="font-medium">{e.name}</span>
                    <span className="ml-2 text-red-300/80">{e.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
