import type { HostsEntry, HostsFileData, HostsWriteRequest } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import {
  Ban,
  Eye,
  FileText,
  Lock,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Checkbox } from '@/components/shared/Checkbox'
import { EmptyState } from '@/components/shared/EmptyState'
import { RECOMMENDATION_PACKS } from '@/lib/hosts-recommendations'
import { useHostsEditorStore } from '@/stores/hosts-editor-store'

export function HostsEditorPage() {
  const { t } = useTranslation('hostsEditor')
  const entries = useHostsEditorStore((s) => s.entries)
  const headerComment = useHostsEditorStore((s) => s.headerComment)
  const status = useHostsEditorStore((s) => s.status)
  const originalEntries = useHostsEditorStore((s) => s.originalEntries)
  const originalHeaderComment = useHostsEditorStore((s) => s.originalHeaderComment)

  const busy = status === 'reading' || status === 'writing' || status === 'flushing'
  const hasData = entries.length > 0 || headerComment.length > 0
  const hasChanges =
    originalEntries.length > 0 &&
    (headerComment !== originalHeaderComment ||
      entries.length !== originalEntries.length ||
      entries.some(
        (e, i) =>
          !originalEntries[i] ||
          e.ip !== originalEntries[i].ip ||
          e.hostname !== originalEntries[i].hostname ||
          e.comment !== originalEntries[i].comment ||
          e.enabled !== originalEntries[i].enabled,
      ))
  const [addingPack, setAddingPack] = useState<string | null>(null)
  const [expandedPack, setExpandedPack] = useState<string | null>(null)

  const packIcons: Record<string, LucideIcon> = { Eye, Ban, Radio, Shield, Lock }

  const handleRead = useCallback(async () => {
    const store = useHostsEditorStore.getState()
    store.setStatus('reading')
    store.setError(null)
    try {
      const result: HostsFileData = await window.dinho.hostsRead()
      store.setReadResult(result)
      store.setEntries(result.entries)
      store.setHeaderComment(result.headerComment)
      store.setOriginal(result.entries, result.headerComment)
      store.setStatus('complete')
      toast.success(t('toastReadSuccess'))
    } catch (err) {
      store.setStatus('error')
      store.setError(err instanceof Error ? err.message : t('toastReadFailed'))
      toast.error(t('toastReadFailed'))
    }
  }, [t])

  const handleSave = useCallback(async () => {
    const store = useHostsEditorStore.getState()
    store.setStatus('writing')
    store.setError(null)
    try {
      const request: HostsWriteRequest = { headerComment: store.headerComment, entries: store.entries }
      const result = await window.dinho.hostsWrite(request)
      store.setWriteResult(result)
      if (result.success) {
        store.setStatus('complete')
        toast.success(t('toastWriteSuccess'))
      } else {
        store.setStatus('error')
        store.setError(result.error ?? t('toastWriteFailed'))
        toast.error(result.error ?? t('toastWriteFailed'))
      }
    } catch (err) {
      store.setStatus('error')
      store.setError(err instanceof Error ? err.message : t('toastWriteFailed'))
      toast.error(t('toastWriteFailed'))
    }
  }, [t])

  const handleFlushDns = useCallback(async () => {
    const store = useHostsEditorStore.getState()
    store.setStatus('flushing')
    store.setError(null)
    try {
      const result = await window.dinho.hostsFlushDns()
      store.setFlushResult(result)
      if (result.success) {
        store.setStatus('complete')
        toast.success(t('toastFlushSuccess'))
      } else {
        store.setStatus('error')
        store.setError(result.error ?? t('toastFlushFailed'))
        toast.error(result.error ?? t('toastFlushFailed'))
      }
    } catch (err) {
      store.setStatus('error')
      store.setError(err instanceof Error ? err.message : t('toastFlushFailed'))
      toast.error(t('toastFlushFailed'))
    }
  }, [t])

  const handleRevert = useCallback(() => {
    const store = useHostsEditorStore.getState()
    store.revert()
    toast.success(t('toastRevertSuccess'))
  }, [t])

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleRead}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <FileText className="h-4 w-4" strokeWidth={1.8} />
              {busy && status === 'reading' ? t('readingButton') : t('readButton')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasData || busy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <Save className="h-4 w-4" strokeWidth={2} />
              {t('saveButton')}
            </button>
            {hasChanges && (
              <button
                type="button"
                onClick={handleRevert}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
              >
                <Undo2 className="h-4 w-4" strokeWidth={1.8} />
                {t('revertButton')}
              </button>
            )}
            <button
              type="button"
              onClick={handleFlushDns}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
              {t('flushDnsButton')}
            </button>
          </div>
        }
      />

      {/* Recommendation packs */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
          <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {t('recommendationsLabel')}
          </span>
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {t('recommendationsDescription')}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {RECOMMENDATION_PACKS.map((pack) => {
            const Icon = packIcons[pack.icon] || Sparkles
            const isAdding = addingPack === pack.id
            const isExpanded = expandedPack === pack.id
            return (
              <div
                key={pack.id}
                className="relative flex flex-col rounded-2xl transition-all overflow-hidden"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-medium)',
                }}
              >
                {/* Card body — click to expand/collapse and preview */}
                <button
                  type="button"
                  onClick={() => setExpandedPack(isExpanded ? null : pack.id)}
                  className="flex flex-col items-start gap-2 p-4 text-left transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex items-center justify-center w-8 h-8 rounded-xl transition-colors"
                      style={{ background: 'var(--bg-subtle)' }}
                    >
                      <Icon className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                    </div>
                    <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      {t(pack.labelKey)}
                    </span>
                    <span className="text-[11px] ml-auto opacity-60" style={{ color: 'var(--text-muted)' }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                  <span className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {t(pack.descKey)}
                  </span>
                </button>

                {/* Expanded hostname preview list */}
                {isExpanded && (
                  <div
                    className="mx-3 px-3 py-2 rounded-xl max-h-40 overflow-y-auto mb-2"
                    style={{ background: 'var(--bg-subtle)' }}
                  >
                    {pack.entries.map((entry) => (
                      <div
                        key={`${entry.ip}-${entry.hostname}`}
                        className="flex items-center gap-2 py-1 text-[12px] font-mono"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span className="shrink-0">{entry.ip}</span>
                        <span className="opacity-40">→</span>
                        <span className="truncate">{entry.hostname}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Apply button — always visible, separate action */}
                <div className="px-4 pb-3">
                  <button
                    type="button"
                    onClick={async () => {
                      if (isAdding) return
                      setAddingPack(pack.id)
                      const store = useHostsEditorStore.getState()
                      store.setBulkEntries(pack.entries as HostsEntry[])
                      setAddingPack(null)
                      toast.success(t('addedToast', { count: pack.entries.length, pack: t(pack.labelKey) }))
                    }}
                    disabled={isAdding}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold transition-all disabled:opacity-40"
                    style={{
                      background: 'var(--bg-subtle)',
                      color: 'var(--accent)',
                    }}
                  >
                    {isAdding ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    )}
                    {t('addRecommendation')} · {pack.entries.length}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {!hasData && status === 'idle' && (
        <EmptyState
          icon={FileText}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleRead}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <FileText className="h-4 w-4" strokeWidth={1.8} />
              {t('startRead')}
            </button>
          }
        />
      )}

      {hasData && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
          {/* Header comment area */}
          <div
            className="p-4"
            style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-default)' }}
          >
            <label
              htmlFor="hosts-header-comment"
              className="block text-[12px] font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('headerCommentLabel')}
            </label>
            <textarea
              id="hosts-header-comment"
              value={headerComment}
              onChange={(e) => useHostsEditorStore.getState().setHeaderComment(e.target.value)}
              rows={3}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] font-mono transition-colors resize-none"
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-muted)',
              }}
              placeholder={t('placeholderHeader')}
            />
          </div>

          {/* Entries table header */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {t('entriesLabel', { count: entries.length })}
            </span>
            <button
              type="button"
              onClick={() => useHostsEditorStore.getState().addEntry()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              {t('addEntryButton')}
            </button>
          </div>

          {/* Entries list */}
          {entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {t('noEntries')}
              </p>
            </div>
          )}

          {entries.map((entry, idx) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 px-5 py-2.5 transition-colors"
              style={{
                background: idx % 2 === 0 ? 'transparent' : 'var(--bg-subtle)',
                borderBottom: idx < entries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                opacity: entry.enabled ? 1 : 0.45,
              }}
            >
              {/* Enabled checkbox */}
              <Checkbox checked={entry.enabled} onChange={() => useHostsEditorStore.getState().toggleEntry(entry.id)} />

              {/* IP */}
              <input
                value={entry.ip}
                onChange={(e) => useHostsEditorStore.getState().updateEntry(entry.id, { ip: e.target.value })}
                placeholder="127.0.0.1"
                className="w-28 rounded-lg px-3 py-1.5 text-[12px] font-mono transition-colors"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                }}
              />

              {/* Hostname */}
              <input
                value={entry.hostname}
                onChange={(e) => useHostsEditorStore.getState().updateEntry(entry.id, { hostname: e.target.value })}
                placeholder="example.com"
                className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-[12px] font-mono transition-colors"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                }}
              />

              {/* Comment */}
              <input
                value={entry.comment}
                onChange={(e) => useHostsEditorStore.getState().updateEntry(entry.id, { comment: e.target.value })}
                placeholder="# comment"
                className="w-40 rounded-lg px-3 py-1.5 text-[12px] transition-colors"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-muted)',
                }}
              />

              {/* Delete */}
              <button
                type="button"
                onClick={() => useHostsEditorStore.getState().removeEntry(entry.id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10"
                style={{ color: 'var(--text-muted)' }}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(status === 'reading' || status === 'flushing') && (
        <div
          className="mt-5 flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <RefreshCw className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
          <span className="text-[13px] text-zinc-300">
            {status === 'reading' ? t('readingProgress') : t('flushingProgress')}
          </span>
        </div>
      )}
    </div>
  )
}
