import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Trash2,
  RotateCcw,
  Shield,
  ShieldOff,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
  FileText
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import type { RestorePointInfo } from '@shared/types'

type PageStatus = 'idle' | 'loading' | 'creating' | 'deleting' | 'restoring' | 'enabling' | 'error'

export function RestorePointPage() {
  const { t } = useTranslation('restorePoint')
  const [points, setPoints] = useState<RestorePointInfo[]>([])
  const [status, setStatus] = useState<PageStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [showCreateConfirm, setShowCreateConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RestorePointInfo | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<RestorePointInfo | null>(null)
  const [createDesc, setCreateDesc] = useState('')
  const [showCreateInput, setShowCreateInput] = useState(false)

  const loadPoints = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const result = await window.dinho.restorePointList()
      if (result.success) {
        setPoints(result.points)
      } else {
        setError(result.error || t('loadError'))
      }
    } catch {
      setError(t('loadError'))
    }
    setStatus('idle')
  }, [t])

  useEffect(() => {
    loadPoints()
  }, [loadPoints])

  const handleCreate = useCallback(async () => {
    setShowCreateConfirm(false)
    setStatus('creating')
    setError(null)
    setSuccessMsg(null)
    try {
      const desc = createDesc.trim() || `DiNho Optimizer — ${new Date().toLocaleString()}`
      const result = await window.dinho.createRestorePoint(desc)
      if (result.success) {
        setSuccessMsg(t('createSuccess'))
        setCreateDesc('')
        setShowCreateInput(false)
        await loadPoints()
      } else {
        setError(result.error || t('createError'))
      }
    } catch {
      setError(t('createError'))
    }
    setStatus('idle')
  }, [createDesc, t, loadPoints])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    setStatus('deleting')
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await window.dinho.restorePointDelete(target.sequenceNumber)
      if (result.success) {
        setSuccessMsg(t('deleteSuccess'))
        await loadPoints()
      } else {
        setError(result.error || t('deleteError'))
      }
    } catch {
      setError(t('deleteError'))
    }
    setStatus('idle')
  }, [deleteTarget, t, loadPoints])

  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return
    const target = restoreTarget
    setRestoreTarget(null)
    setStatus('restoring')
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await window.dinho.restorePointRestore(target.sequenceNumber)
      if (result.success) {
        setSuccessMsg(t('restoreSuccess'))
      } else {
        setError(result.error || t('restoreError'))
      }
    } catch {
      setError(t('restoreError'))
    }
    setStatus('idle')
  }, [restoreTarget, t])

  const handleEnableProtection = useCallback(async () => {
    setStatus('enabling')
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await window.dinho.enableSystemProtection()
      if (result.success) {
        setSuccessMsg('Proteção do Sistema ativada na unidade C:!')
        await loadPoints()
      } else {
        setError(result.error || 'Falha ao ativar a Proteção do Sistema.')
      }
    } catch {
      setError('Falha ao ativar a Proteção do Sistema.')
    }
    setStatus('idle')
  }, [loadPoints])

  const isBusy = status === 'loading' || status === 'creating' || status === 'deleting' || status === 'restoring' || status === 'enabling'

  const typeLabels: Record<string, string> = {
    '0': t('typeApplicationInstall'),
    '1': t('typeApplicationUninstall'),
    '10': t('typeDeviceInstall'),
    '12': t('typeModifySettings'),
    '13': t('typeCancelledOperation'),
    '14': t('typeSystemRestore'),
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
      />

      <div className="flex flex-wrap items-center gap-3">
        {!showCreateInput ? (
          <button
            onClick={() => setShowCreateInput(true)}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {status === 'creating' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t('createButton')}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder={t('createPlaceholder')}
              className="h-10 rounded-xl border bg-transparent px-4 text-sm outline-none transition-colors w-80"
              style={{ borderColor: 'var(--border-medium)' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setShowCreateConfirm(true)
                if (e.key === 'Escape') setShowCreateInput(false)
              }}
              autoFocus
            />
            <button
              onClick={() => setShowCreateConfirm(true)}
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('confirmButton')}
            </button>
            <button
              onClick={() => { setShowCreateInput(false); setCreateDesc('') }}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
            >
              {t('cancelButton')}
            </button>
          </div>
        )}
        <button
          onClick={loadPoints}
          disabled={isBusy}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
        >
          <RotateCcw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
          {t('refreshButton')}
        </button>
      </div>

      {successMsg && (
        <div className="flex items-center gap-3 rounded-xl px-5 py-3 text-sm" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {successMsg}
        </div>
      )}

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {isBusy && points.length === 0 && status === 'loading' && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      )}

      {!isBusy && points.length === 0 && (
        <div className="space-y-4">
          <EmptyState
            icon={ShieldOff}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
          <div className="flex justify-center">
            <button
              onClick={handleEnableProtection}
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 0 20px rgba(34,197,94,0.2)' }}
            >
              {status === 'enabling' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
              Ativar Proteção do Sistema (C:)
            </button>
          </div>
        </div>
      )}

      {points.length > 0 && (
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-medium)' }}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                <th className="px-5 py-3 font-medium" style={{ color: 'var(--text-dim)' }}>{t('colDescription')}</th>
                <th className="px-5 py-3 font-medium" style={{ color: 'var(--text-dim)' }}>{t('colDate')}</th>
                <th className="px-5 py-3 font-medium" style={{ color: 'var(--text-dim)' }}>{t('colType')}</th>
                <th className="px-5 py-3 font-medium text-right" style={{ color: 'var(--text-dim)' }}>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.sequenceNumber} className="border-t transition-colors hover:opacity-80" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="flex items-center gap-3 px-5 py-4">
                    <FileText className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span>{p.description || `#${p.sequenceNumber}`}</span>
                  </td>
                  <td className="px-5 py-4" style={{ color: 'var(--text-muted)' }}>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(p.creationTime).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-5 py-4" style={{ color: 'var(--text-muted)' }}>
                    {typeLabels[p.restorePointType] || p.restorePointType}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setRestoreTarget(p)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:scale-[1.05] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
                        title={t('restoreTooltip')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('restoreButton')}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:scale-[1.05] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                        title={t('deleteTooltip')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('deleteButton')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={showCreateConfirm}
        onConfirm={handleCreate}
        onCancel={() => setShowCreateConfirm(false)}
        title={t('confirmCreateTitle')}
        description={t('confirmCreateMessage', { description: createDesc.trim() || t('defaultDescription') })}
        confirmLabel={t('confirmCreateLabel')}
        variant="default"
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        title={t('confirmDeleteTitle')}
        description={t('confirmDeleteMessage', { description: deleteTarget?.description || `#${deleteTarget?.sequenceNumber}` })}
        confirmLabel={t('confirmDeleteLabel')}
        variant="danger"
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        onConfirm={handleRestore}
        onCancel={() => setRestoreTarget(null)}
        title={t('confirmRestoreTitle')}
        description={t('confirmRestoreMessage', { description: restoreTarget?.description || `#${restoreTarget?.sequenceNumber}` })}
        confirmLabel={t('confirmRestoreLabel')}
        variant="danger"
      />
    </div>
  )
}
