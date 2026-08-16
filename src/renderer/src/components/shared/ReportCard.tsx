import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes, formatNumber } from '@/lib/utils'

const REPORT_STORAGE_KEY = 'dinho:last-cleanup-report'

export interface ReportCategory {
  name: string
  found: number
  cleaned: number
  space: number
}

export interface ReportData {
  timestamp: string
  spaceBefore: number
  spaceAfter: number
  spaceFreed: number
  filesDeleted: number
  duration: number
  categories: ReportCategory[]
}

function AnimatedNumber({ value, formatter }: { value: number; formatter: (n: number) => string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      {formatter(value)}
    </motion.span>
  )
}

export function saveReport(report: ReportData): void {
  try {
    localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(report))
  } catch {
    /* ignore */
  }
}

export function loadReport(): ReportData | null {
  try {
    const raw = localStorage.getItem(REPORT_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ReportData
  } catch {
    /* ignore */
  }
  return null
}

export function ReportCard({
  report,
  icon,
  showGenerateButton,
}: {
  report: ReportData | null
  icon?: LucideIcon
  showGenerateButton?: boolean
}) {
  const { t } = useTranslation('cleaner')
  const Icon = icon ?? FileText

  if (!report && showGenerateButton) {
    return null
  }

  if (!report) return null

  const durationSec = Math.round(report.duration / 1000)
  const durationStr =
    durationSec < 60
      ? t('summaryDuration', { duration: `${durationSec}s` })
      : t('summaryDuration', { duration: `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` })

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="rounded-2xl p-5"
        style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.06) 0%, rgba(34,197,94,0.02) 100%)',
          border: '1px solid rgba(34,197,94,0.12)',
          boxShadow: '0 0 24px rgba(34,197,94,0.06)',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(34,197,94,0.1)' }}
          >
            <Icon className="h-4.5 w-4.5 text-green-500" strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-zinc-200">{t('reportTitle')}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {durationStr}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('reportBefore')}
            </p>
            <p className="text-[16px] font-bold text-zinc-200">
              <AnimatedNumber value={report.spaceBefore} formatter={formatBytes} />
            </p>
          </div>
          <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('reportAfter')}
            </p>
            <p className="text-[16px] font-bold text-zinc-200">
              <AnimatedNumber value={report.spaceAfter} formatter={formatBytes} />
            </p>
          </div>
          <div
            className="rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.12)' }}
          >
            <p className="text-[11px] font-medium text-green-500">{t('reportFreed')}</p>
            <p className="text-[16px] font-bold text-green-500">
              <AnimatedNumber value={report.spaceFreed} formatter={formatBytes} />
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {t('reportFiles')}
          </span>
          <span className="text-[13px] font-semibold text-zinc-300">
            <AnimatedNumber value={report.filesDeleted} formatter={formatNumber} />
          </span>
        </div>

        {report.categories.length > 0 && (
          <div className="pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <p className="mb-2 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('reportBreakdown')}
            </p>
            <div className="space-y-1.5">
              {report.categories
                .filter((c) => c.cleaned > 0)
                .map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between">
                    <span className="text-[12px] text-zinc-400">{cat.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {formatNumber(cat.cleaned)} {t('reportItems')}
                      </span>
                      <span className="text-[11px] font-mono text-green-500">{formatBytes(cat.space)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
