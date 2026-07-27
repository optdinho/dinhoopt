import { TriangleAlert, CircleCheckBig, RefreshCw, ShieldAlert, CircleX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface RepairResult {
  success: boolean
  needsAdmin: boolean
  requiresReboot?: boolean
  summary: string
  log?: string
}

interface DiskRepairOptionProps {
  title: string
  subtitle: string
  description: string
  icon: React.ElementType
  running: boolean
  runningLabel: string
  result: RepairResult | null
  showLog: boolean
  onToggleLog: () => void
  onRun: () => void
}

export function DiskRepairOption({
  title,
  subtitle,
  description,
  icon: Icon,
  running,
  runningLabel,
  result,
  showLog,
  onToggleLog,
  onRun,
}: DiskRepairOptionProps) {
  const { t } = useTranslation()

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'rgba(245,158,11,0.1)' }}
          >
            <Icon className="h-5 w-5 text-amber-400" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-zinc-200">{title}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {description}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: 'var(--text-on-accent)',
          }}
        >
          {running ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" /> {runningLabel}
            </>
          ) : (
            <>
              <Icon className="h-4 w-4" strokeWidth={2} /> {t('runButton', 'Run')}
            </>
          )}
        </button>
      </div>
      {result && (
        <div
          className="mt-4 rounded-xl px-4 py-3"
          style={{
            background: result.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${result.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            {result.success ? (
              <CircleCheckBig className="h-4 w-4 shrink-0 text-green-500" strokeWidth={1.8} />
            ) : result.needsAdmin ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
            ) : (
              <CircleX className="h-4 w-4 shrink-0 text-red-400" strokeWidth={1.8} />
            )}
            <p className="text-[12px] text-zinc-300">{result.summary}</p>
          </div>
          {result.requiresReboot && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
              <TriangleAlert className="h-3 w-3" strokeWidth={2} /> {t('restartRecommended', 'Restart recommended')}
            </p>
          )}
          {result.log && (
            <button
              type="button"
              onClick={onToggleLog}
              className="mt-2 text-[11px] font-medium text-amber-500 hover:text-amber-400"
            >
              {showLog ? t('hideLog', 'Hide Log') : t('showLog', 'Show Log')}
            </button>
          )}
          {showLog && result.log && (
            <pre
              className="mt-2 max-h-48 overflow-auto rounded-lg p-3 font-mono text-[11px]"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
            >
              {result.log}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
