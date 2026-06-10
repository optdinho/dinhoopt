import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Globe,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Eye,
  Radio,
  Cpu,
  HardDrive,
  Server,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { useComplianceStore } from '@/stores/compliance-store'
import { useHistoryStore } from '@/stores/history-store'
import type { ComplianceCheck } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

interface CatDef {
  id: ComplianceCheck['category']
  labelKey: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

const CATEGORIES: CatDef[] = [
  { id: 'password', labelKey: 'category.password', icon: Lock, color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.15)' },
  { id: 'audit', labelKey: 'category.audit', icon: Eye, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.15)' },
  { id: 'network', labelKey: 'category.network', icon: Globe, color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.15)' },
  { id: 'update', labelKey: 'category.update', icon: RefreshCw, color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.15)' },
  { id: 'bitlocker', labelKey: 'category.bitlocker', icon: HardDrive, color: '#06b6d4', bg: 'rgba(6,182,212,0.08)', border: 'rgba(6,182,212,0.15)' },
  { id: 'firewall', labelKey: 'category.firewall', icon: ShieldAlert, color: '#14b8a6', bg: 'rgba(20,184,166,0.08)', border: 'rgba(20,184,166,0.15)' },
  { id: 'uac', labelKey: 'category.uac', icon: ShieldCheck, color: '#ec4899', bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.15)' },
]

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<string, CatDef>

function severityColor(sev: ComplianceCheck['severity']): string {
  switch (sev) {
    case 'critical': return '#ef4444'
    case 'warning': return '#f59e0b'
    case 'info': return '#3b82f6'
  }
}

export function CompliancePage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('compliance')
  const state = useComplianceStore((s) => s.state)
  const status = useComplianceStore((s) => s.status)
  const applyResult = useComplianceStore((s) => s.applyResult)
  const expandedCategories = useComplianceStore((s) => s.expandedCategories)
  const progress = useComplianceStore((s) => s.progress)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const scanningRef = useRef(false)

  // Subscribe to progress events
  useEffect(() => {
    const cleanup = window.dinho.onComplianceProgress((data) => {
      useComplianceStore.getState().setProgress(data)
    })
    return cleanup
  }, [])

  const runScan = useCallback(async () => {
    if (scanningRef.current) return
    scanningRef.current = true
    useComplianceStore.getState().setStatus('scanning')
    useComplianceStore.getState().setProgress(null)
    try {
      const compState = await window.dinho.complianceScan()
      useComplianceStore.getState().setState(compState)
      useComplianceStore.getState().setStatus('done')
      addEntry({
        id: `compliance-${Date.now()}`,
        type: 'compliance' as const,
        timestamp: new Date().toISOString(),
        duration: 0,
        totalItemsFound: compState.total,
        totalItemsCleaned: compState.compliant,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        errorCount: 0,
        categories: [],
      })
    } catch (err) {
      useComplianceStore.getState().setStatus('idle')
      toast.error(t('scanFailed') || 'Falha na auditoria', { description: String(err) })
    } finally {
      scanningRef.current = false
    }
  }, [addEntry, t])

  const runApply = useCallback(async (ids: string[]) => {
    useComplianceStore.getState().setStatus('applying')
    try {
      const result = await window.dinho.complianceApply(ids)
      const updated = await window.dinho.complianceScan()
      useComplianceStore.getState().setState(updated)
      useComplianceStore.getState().setApplyResult(result)
      useComplianceStore.getState().setStatus('done')
      if (result.succeeded > 0) toast.success(t('checksApplied', { count: result.succeeded }))
      if (result.failed > 0) toast.error(t('applyFailed'))
    } catch {
      useComplianceStore.getState().setStatus('done')
      toast.error(t('applyFailed'))
    }
  }, [t])

  const runRevert = useCallback(async (ids: string[]) => {
    useComplianceStore.getState().setStatus('applying')
    try {
      const result = await window.dinho.complianceRevert(ids)
      const updated = await window.dinho.complianceScan()
      useComplianceStore.getState().setState(updated)
      useComplianceStore.getState().setApplyResult(result)
      useComplianceStore.getState().setStatus('done')
      if (result.succeeded > 0) toast.success(t('checksReverted', { count: result.succeeded }))
    } catch {
      useComplianceStore.getState().setStatus('done')
    }
  }, [t])

  const checks = state?.checks ?? []
  const total = state?.total ?? 0
  const compliant = state?.compliant ?? 0
  const score = state?.score ?? 0
  const nonCompliant = total - compliant

  const checksByCategory = useMemo(() => {
    const map = new Map<ComplianceCheck['category'], ComplianceCheck[]>()
    for (const check of checks) {
      const arr = map.get(check.category) ?? []
      arr.push(check)
      map.set(check.category, arr)
    }
    return map
  }, [checks])

  const nonCompliantIds = useMemo(() =>
    checks.filter((c) => !c.compliant).map((c) => c.id),
    [checks],
  )

  if (!state && status === 'idle') {
    return (
      <div className="flex flex-col gap-6 p-6">
        {!embedded && <PageHeader title={t('pageTitle')} description={t('pageDescription')} />}
        <EmptyState
          icon={ShieldCheck}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              onClick={runScan}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all hover:opacity-80"
              style={{ background: 'var(--accent)', color: '#0a0600' }}
            >
              <ShieldCheck className="h-4 w-4" />
              {t('scanButton')}
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {!embedded && <PageHeader title={t('pageTitle')} description={t('pageDescription')} />}

      {/* Scan / Fix toolbar */}
      <div className="flex items-center gap-3">
        <button
          onClick={runScan}
          disabled={status === 'scanning' || status === 'applying'}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0a0600' }}
        >
          {status === 'scanning' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {t('scanButton')}
        </button>
        {nonCompliantIds.length > 0 && status === 'done' && (
          <button
            onClick={() => runApply(nonCompliantIds)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all hover:opacity-80"
            style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
          >
            <ShieldAlert className="h-4 w-4" />
            {t('fixSelected', { count: nonCompliantIds.length })}
          </button>
        )}
      </div>

      {/* Progress */}
      {progress && (
        <div className="flex items-center gap-3 rounded-lg px-4 py-3 text-[13px]" style={{ background: 'var(--bg-subtle)' }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>{progress.currentLabel}</span>
          <span className="ml-auto text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {progress.current}/{progress.total}
          </span>
        </div>
      )}

      {/* Score card */}
      {state && (
        <div
          className="rounded-xl p-6"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-medium)',
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t('complianceScore')}
              </p>
              <p className="mt-1 text-[28px] font-bold" style={{ color: score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444' }}>
                {score}%
              </p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {score >= 80 ? t('scoreExcellent') : score >= 50 ? t('scoreNeedsImprovement') : t('scoreCritical')}
              </p>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-[22px] font-bold" style={{ color: '#22c55e' }}>{compliant}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t('compliant')}</p>
              </div>
              <div>
                <p className="text-[22px] font-bold" style={{ color: '#ef4444' }}>{nonCompliant}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t('noncompliant')}</p>
              </div>
              <div>
                <p className="text-[22px] font-bold" style={{ color: 'var(--text-primary)' }}>{total}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t('total')}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Categories */}
      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const catChecks = checksByCategory.get(cat.id)
          if (!catChecks || catChecks.length === 0) return null
          const catCompliant = catChecks.filter((c) => c.compliant).length
          const isExpanded = expandedCategories.has(cat.id)

          return (
            <div key={cat.id}>
              <button
                onClick={() => useComplianceStore.getState().toggleCategory(cat.id)}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-[13px] font-medium transition-all hover:opacity-80"
                style={{ background: cat.bg, border: `1px solid ${cat.border}` }}
              >
                <cat.icon className="h-4 w-4" style={{ color: cat.color }} />
                <span style={{ color: cat.color }}>{t(cat.labelKey)}</span>
                <span className="ml-auto text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  {catCompliant}/{catChecks.length}
                </span>
              </button>

              {isExpanded && (
                <div className="ml-4 mt-2 space-y-2">
                  {catChecks.map((check) => (
                    <div
                      key={check.id}
                      className="rounded-lg px-4 py-3"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {check.compliant ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
                            ) : (
                              <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: severityColor(check.severity) }} />
                            )}
                            <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                              {check.label}
                            </span>
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                background: `${severityColor(check.severity)}20`,
                                color: severityColor(check.severity),
                              }}
                            >
                              {t(`severity.${check.severity}`)}
                            </span>
                            {check.requiresAdmin && (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                                {t('adminBadge')}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                            {check.description}
                          </p>
                          <div className="mt-1 flex gap-4 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                            <span>
                              {t('complianceScore')}: {check.value}
                            </span>
                            <span>
                              {t('compliantBadge')}: {check.expected}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {!check.compliant && check.reversible && (
                            <button
                              onClick={() => runApply([check.id])}
                              disabled={status === 'applying'}
                              className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all hover:opacity-80 disabled:opacity-40"
                              style={{ background: 'var(--accent)', color: '#0a0600' }}
                            >
                              {t('fixSelected', { count: 0 }).replace(/\(0\)/, '')}
                            </button>
                          )}
                          {check.compliant && check.reversible && (
                            <button
                              onClick={() => runRevert([check.id])}
                              disabled={status === 'applying'}
                              className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all hover:opacity-80 disabled:opacity-40"
                              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                            >
                              {t('revertSelected', { count: 0 }).replace(/\(0\)/, '')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
