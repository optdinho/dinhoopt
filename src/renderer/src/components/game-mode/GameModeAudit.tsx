import type { GameModeAuditReport } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, CircleCheckBig, Shield, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const CYAN = '#06b6d4'
const CYAN_BORDER = 'rgba(6,182,212,0.15)'

interface GameModeAuditProps {
  auditReport: GameModeAuditReport | null
  auditPhase: string
  showModal: boolean
  onRunAudit: () => Promise<void>
  onOpenModal: () => void
  onCloseModal: () => void
}

export function GameModeAudit({
  auditReport,
  auditPhase,
  showModal,
  onRunAudit,
  onOpenModal,
  onCloseModal,
}: GameModeAuditProps) {
  const { t } = useTranslation('gameMode')
  const isRunning = auditPhase === 'running'

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.02, duration: 0.3 }}
        className="overflow-hidden rounded-xl"
        style={{
          border: `1px solid ${auditReport && auditReport.summary.errors > 0 ? 'rgba(239,68,68,0.2)' : 'var(--border-default)'}`,
          background: auditReport ? 'linear-gradient(135deg, rgba(6,182,212,0.04), transparent)' : 'var(--bg-subtle)',
        }}
      >
        <div className="flex items-center gap-4 px-5 py-4">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'rgba(6,182,212,0.12)' }}
          >
            <Shield className="h-[18px] w-[18px]" style={{ color: CYAN }} strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <span className="text-[14px] font-semibold text-zinc-200">{t('auditTitle', 'Audit')}</span>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {t('auditDesc', 'Verify Game Mode optimizations are applied safely')}
            </p>
          </div>
          <button
            type="button"
            onClick={onRunAudit}
            disabled={isRunning}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] font-semibold transition-colors disabled:opacity-40"
            style={{ background: `${CYAN}14`, color: CYAN, border: `1px solid ${CYAN_BORDER}` }}
          >
            {isRunning ? (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Activity className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            {isRunning ? t('auditRunning', 'Auditing…') : t('auditButton', 'Run Audit')}
          </button>
        </div>

        {auditReport && (
          <div className="flex items-center gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-3 text-[12px]">
              <span style={{ color: '#22c55e' }}>{auditReport.summary.passed} passed</span>
              {auditReport.summary.warnings > 0 && (
                <span style={{ color: '#f59e0b' }}>{auditReport.summary.warnings} warnings</span>
              )}
              {auditReport.summary.errors > 0 && (
                <span style={{ color: '#ef4444' }}>{auditReport.summary.errors} errors</span>
              )}
            </div>
            <button
              type="button"
              onClick={onOpenModal}
              className="ml-auto text-[11px] underline transition-colors"
              style={{ color: CYAN }}
            >
              {t('auditDetails', 'View details')}
            </button>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showModal && auditReport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={onCloseModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-medium)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between border-b px-6 py-4"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <h3 className="text-[15px] font-bold text-zinc-200">{t('auditModalTitle', 'Audit Report')}</h3>
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/[0.05]"
                >
                  <X className="h-4 w-4 text-zinc-500" />
                </button>
              </div>
              <div className="flex gap-4 border-b px-6 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-1.5 text-[12px]">
                  <CircleCheckBig className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
                  <span style={{ color: '#22c55e' }}>{auditReport.summary.passed}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[12px]">
                  <TriangleAlert className="h-3.5 w-3.5" style={{ color: '#f59e0b' }} />
                  <span style={{ color: '#f59e0b' }}>{auditReport.summary.warnings}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[12px]">
                  <TriangleAlert className="h-3.5 w-3.5" style={{ color: '#ef4444' }} />
                  <span style={{ color: '#ef4444' }}>{auditReport.summary.errors}</span>
                </div>
                <span className="ml-auto text-[11px] text-zinc-600">
                  {t(`auditPhase_${auditReport.phase}`, auditReport.phase)}
                </span>
              </div>
              <div className="px-6 py-3">
                {auditReport.checks.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-zinc-500">
                    {t('auditNoChecks', 'No checks were performed')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {auditReport.checks.map((check) => (
                      <div
                        key={check.id}
                        className="rounded-xl px-4 py-3"
                        style={{
                          background: check.passed
                            ? 'rgba(34,197,94,0.04)'
                            : check.severity === 'error'
                              ? 'rgba(239,68,68,0.04)'
                              : 'rgba(245,158,11,0.04)',
                          border: `1px solid ${check.passed ? 'rgba(34,197,94,0.1)' : check.severity === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)'}`,
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {check.passed ? (
                            <CircleCheckBig className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: '#22c55e' }} />
                          ) : (
                            <TriangleAlert
                              className="mt-0.5 h-3.5 w-3.5 shrink-0"
                              style={{ color: check.severity === 'error' ? '#ef4444' : '#f59e0b' }}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-zinc-300">{check.name}</span>
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                                style={{
                                  background: `${check.category === 'service' ? '#06b6d4' : check.category === 'anti-cheat' ? '#ef4444' : '#8b5cf6'}14`,
                                  color:
                                    check.category === 'service'
                                      ? '#06b6d4'
                                      : check.category === 'anti-cheat'
                                        ? '#ef4444'
                                        : '#8b5cf6',
                                }}
                              >
                                {check.category}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-zinc-500">{check.details}</p>
                            {check.remediation && (
                              <p className="mt-1 text-[11px]" style={{ color: '#f59e0b' }}>
                                {t('auditRemediation', 'Remediation')}: {check.remediation}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
