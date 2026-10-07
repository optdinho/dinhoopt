import type { RegistryBackupInfo } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive, Clock, Database, FileWarning, FolderClock, History, Loader2, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatBytes } from '@/lib/utils'

interface RestoreBackupDialogProps {
  open: boolean
  onClose: () => void
}

const KIND_ICONS: Record<RegistryBackupInfo['kind'], typeof Archive> = {
  targeted: FileWarning,
  full: Archive,
  hive: Database,
  shell: FolderClock,
  tasks: Clock,
}

function formatTimestamp(timestamp: string): string {
  return timestamp
    .replace('T', ' ')
    .replace(/-000Z$/, '')
    .slice(0, 16)
}

export function RestoreBackupDialog({ open, onClose }: RestoreBackupDialogProps) {
  const { t } = useTranslation('registry')
  const dialogRef = useRef<HTMLDivElement>(null)
  const [backups, setBackups] = useState<RegistryBackupInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [selected, setSelected] = useState<RegistryBackupInfo | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    previousFocusRef.current = document.activeElement as HTMLElement | null
    setLoading(true)
    window.dinho
      .registryRestoreList()
      .then((list) => setBackups(Array.isArray(list) ? list : []))
      .catch(() => setBackups([]))
      .finally(() => setLoading(false))

    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    dialog.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open])

  const confirm = async () => {
    if (!selected || restoring) return
    setRestoring(true)
    try {
      const result = await window.dinho.registryRestore(selected.name)
      if (result.ok) {
        toast.success(t('restoreSuccessTitle'), { description: t('restoreSuccessDescription') })
        onClose()
      } else {
        toast.error(t('restoreFailedTitle'), {
          description: result.message ?? t('restoreFailedDescription'),
          duration: 6000,
        })
      }
    } catch {
      toast.error(t('restoreFailedTitle'), { description: t('restoreFailedDescription'), duration: 6000 })
    } finally {
      setRestoring(false)
    }
  }

  const renderRow = (item: RegistryBackupInfo) => {
    const Icon = KIND_ICONS[item.kind]
    const isTasks = item.kind === 'tasks'
    const isActive = selected?.name === item.name
    return (
      <button
        key={item.name}
        type="button"
        onClick={() => setSelected(item)}
        data-testid={`restore-entry-${item.kind}`}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45"
        style={{
          background: isActive ? 'var(--bg-hover)' : undefined,
          border: `1px solid ${isActive ? 'var(--border-strong)' : 'var(--border-default)'}`,
        }}
        disabled={isTasks || restoring}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--bg-subtle-2)' }}
        >
          <Icon className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} strokeWidth={1.8} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-zinc-200">{item.name.replace(/\.reg$/, '')}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t(`restoreKind${item.kind.charAt(0).toUpperCase()}${item.kind.slice(1)}`)} ·{' '}
            {formatTimestamp(item.timestamp)} · {formatBytes(item.size)}
            {isTasks ? ` — ${t('restoreTasksNotSupported')}` : ''}
          </p>
        </div>
      </button>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}
            onClick={() => {
              if (!restoring) onClose()
            }}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-dialog-title"
            className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl p-6"
            style={{
              background: 'var(--card-bg)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 var(--glass-inset)',
            }}
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
          >
            <div className="mb-4 flex items-start gap-4">
              <div
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(245,158,11,0.1)' }}
              >
                <History className="h-5 w-5" style={{ color: '#f59e0b' }} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="restore-dialog-title" className="text-[16px] font-semibold text-white">
                  {t('restoreDialogTitle')}
                </h3>
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {t('restoreDialogDescription')}
                </p>
              </div>
            </div>

            <div
              className="mb-4 flex items-start gap-2.5 rounded-xl px-4 py-3"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.8} aria-hidden="true" />
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {t('restoreWarning')}
              </p>
            </div>

            <div className="mb-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {loading && (
                <div className="flex items-center gap-2 py-6 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> {t('restoreLoading')}
                </div>
              )}
              {!loading && backups.length === 0 && (
                <p className="py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {t('restoreNoBackups')}
                </p>
              )}
              {!loading && backups.map((b) => renderRow(b))}
            </div>

            <div
              className="flex items-center justify-between gap-2.5 border-t pt-4"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <button
                type="button"
                data-autofocus
                onClick={onClose}
                disabled={restoring}
                className="rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors hover:bg-white/[0.04]"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('restoreCancelLabel')}
              </button>
              {selected && (
                <div className="flex min-w-0 items-center gap-2.5">
                  <p className="truncate text-[11px] max-w-[220px]" style={{ color: 'var(--text-muted)' }}>
                    {t('restoreConfirmDescription', { name: selected.name })}
                  </p>
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={restoring}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                      color: 'var(--text-on-accent)',
                      boxShadow: '0 0 16px rgba(245,158,11,0.2)',
                    }}
                  >
                    {restoring && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t('restoreConfirmLabel')}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
