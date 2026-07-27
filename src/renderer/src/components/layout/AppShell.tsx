import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyboardShortcutsModal } from '@/components/shared/KeyboardShortcutsModal'
import { AdminBanner } from './AdminBanner'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const handleSkip = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault()
    const el = document.getElementById('main-content')
    if (el) {
      el.focus()
      el.scrollIntoView()
    }
  }, [])

  // ? key to open shortcuts modal (Shift+/)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        e.preventDefault()
        setShowShortcuts((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      <button type="button" className="skip-nav" onClick={handleSkip}>
        {t('skipToContent')}
      </button>
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Ambient background glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-[100px] left-[80px] h-[500px] w-[500px] rounded-full blur-[180px]"
            style={{ background: 'var(--glow-amber)' }}
          />
          <div
            className="absolute bottom-[0] right-[40px] h-[400px] w-[400px] rounded-full blur-[160px]"
            style={{ background: 'var(--glow-blue)' }}
          />
          {/* Noise texture overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.7%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/%3E%3C/svg%3E")',
            }}
          />
        </div>

        {/* Invisible drag region for moving window (top edge) */}
        <div className="drag-region h-8 shrink-0" />
        {/* Window controls float in top right */}
        <WindowControls />
        <AdminBanner />
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto px-4 lg:px-10 pb-10 pt-2 outline-none"
        >
          {children}
        </main>
      </div>
      <KeyboardShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}

function WindowControls() {
  const { t } = useTranslation('common')
  return (
    <div className="no-drag fixed right-0 top-0 z-50 flex" role="toolbar" aria-label={t('windowControls')}>
      <button
        type="button"
        onClick={() => window.dinho.windowMinimize()}
        aria-label={t('minimizeWindow')}
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => window.dinho.windowMaximize()}
        aria-label={t('maximizeWindow')}
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => window.dinho.windowClose()}
        aria-label={t('closeWindow')}
        className="flex h-8 w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-red-500 hover:text-white"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}
