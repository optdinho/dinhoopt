import { AnimatePresence, motion } from 'framer-motion'
import { Keyboard } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Shortcut {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation('common')
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const groups: ShortcutGroup[] = [
    {
      title: t('shortcutsNavigation'),
      shortcuts: [
        { keys: ['Ctrl', 'K'], label: t('shortcutsCommandPalette') },
        { keys: ['Ctrl', '1-4'], label: t('shortcutsNavigateSections') },
      ],
    },
    {
        title: t('shortcutsActions'),
        shortcuts: [{ keys: ['?'], label: t('shortcutsShowHelp') }],
      },
      {
        title: t('shortcutsGeneral'),
        shortcuts: [{ keys: ['Esc'], label: t('shortcutsCloseModal') }],
      },
  ]

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}
            onClick={onClose}
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
            aria-labelledby="kbd-dialog-title"
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
            <div className="mb-5 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: 'var(--accent-muted-bg)' }}
              >
                <Keyboard className="h-5 w-5" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
              </div>
              <h3 id="kbd-dialog-title" className="text-[16px] font-semibold text-white">
                {t('shortcutsTitle')}
              </h3>
            </div>

            <div className="space-y-5">
              {groups.map((group) => (
                <div key={group.title}>
                  <p
                    className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {group.title}
                  </p>
                  <div className="space-y-1.5">
                    {group.shortcuts.map((shortcut) => (
                      <div key={shortcut.label} className="flex items-center justify-between py-1">
                        <span className="text-[13px] text-zinc-300">{shortcut.label}</span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key, i) => (
                            <span key={`${shortcut.label}-${key}`}>
                              <kbd
                                className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md px-1.5 text-[11px] font-medium text-zinc-300"
                                style={{
                                  background: 'var(--bg-subtle)',
                                  border: '1px solid var(--border-medium)',
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                }}
                              >
                                {key}
                              </kbd>
                              {i < shortcut.keys.length - 1 && (
                                <span className="mx-0.5 text-[10px] text-zinc-600">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors hover:bg-white/[0.04]"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('cancel')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
