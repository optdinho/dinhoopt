import { AnimatePresence, motion } from 'framer-motion'
import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RenameDialogProps {
  open: boolean
  oldName: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export function RenameDialog({ open, oldName, onConfirm, onCancel }: RenameDialogProps) {
  const { t } = useTranslation(['clips', 'common'])
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(oldName)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setValue(oldName)
    previousFocusRef.current = document.activeElement as HTMLElement | null

    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    inputRef.current?.focus()
    inputRef.current?.select()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current()
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
  }, [open, oldName])

  const submit = () => {
    const newName = value.trim()
    if (newName && newName !== oldName) onConfirm(newName)
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}
            onClick={onCancel}
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
            aria-labelledby="rename-dialog-title"
            className="relative w-full max-w-md rounded-2xl p-6"
            style={{
              background: 'var(--card-bg)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 var(--glass-inset)',
            }}
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
          >
            <div className="mb-5 flex items-start gap-4">
              <div
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(59,130,246,0.1)' }}
              >
                <Pencil className="h-5 w-5" style={{ color: '#3b82f6' }} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="rename-dialog-title" className="text-[16px] font-semibold text-white">
                  {t('rename')}
                </h3>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                  className="mt-3 w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                  style={{
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors hover:bg-white/[0.04]"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!value.trim() || value.trim() === oldName}
                className="rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                  color: 'var(--text-on-accent)',
                  boxShadow: '0 0 16px rgba(245,158,11,0.2)',
                }}
              >
                {t('rename')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
