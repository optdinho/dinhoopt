import { usePolling } from '@/hooks/usePolling'
import { Clapperboard, Loader2, Square, Play } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ClipsEngineStatus } from '@shared/types'

const CLIPS_POLL_INTERVAL = 5000

export function GameClipsCard() {
  const { t } = useTranslation('dashboard')
  const { data: status } = usePolling<ClipsEngineStatus>(
    () =>
      window.dinho?.clipsGetStatus?.() ??
      Promise.resolve({ running: false, capturing: false, uptime: 0, fps: 60, replayTimeSeconds: 60 }),
    CLIPS_POLL_INTERVAL,
  )

  const capturing = status?.capturing ?? false
  const running = status?.engineRunning ?? status?.running ?? false
  const [toggling, setToggling] = useState(false)
  const isActive = capturing || running
  const glowColor = capturing ? '#ef4444' : running ? '#22c55e' : 'transparent'

  const handleToggle = useCallback(async () => {
    if (toggling) return
    setToggling(true)
    try {
      if (capturing) {
        await window.dinho?.clipsStopCapture?.()
      } else {
        await window.dinho?.clipsStartCapture?.()
      }
    } catch {
      // silent
    } finally {
      setToggling(false)
    }
  }, [toggling, capturing])

  return (
    <div
      className="glass-card depth-mid group relative flex flex-col items-center justify-center overflow-hidden rounded-2xl px-4 py-5 text-center transition-all duration-500"
      style={{
        background: capturing
          ? 'linear-gradient(180deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.02) 100%)'
          : running
            ? 'linear-gradient(180deg, rgba(34,197,94,0.06) 0%, transparent 100%)'
            : 'var(--card-bg)',
        borderColor: capturing ? 'rgba(239,68,68,0.2)' : running ? 'rgba(34,197,94,0.15)' : 'var(--border-default)',
        animation: capturing ? 'game-mode-pulse 2.5s ease-in-out infinite' : undefined,
      }}
    >
      {isActive && (
        <div
          className="pointer-events-none absolute rounded-full opacity-15 blur-3xl"
          style={{
            width: 200,
            height: 200,
            backgroundColor: glowColor,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          background: `linear-gradient(135deg, ${capturing ? '#ef4444' : running ? '#22c55e' : 'var(--text-muted)'}20, transparent)`,
          border: `2px solid ${capturing ? '#ef4444' : running ? '#22c55e' : 'var(--border-strong)'}`,
        }}
      >
        <Clapperboard
          className="h-6 w-6"
          style={{ color: capturing ? '#ef4444' : running ? '#22c55e' : 'var(--text-muted)' }}
          strokeWidth={2}
        />
      </div>

      <span
        className="mb-1 text-sm font-bold tracking-[0.2em]"
        style={{ color: capturing ? '#ef4444' : running ? '#22c55e' : 'var(--text-muted)' }}
      >
        {t('gameClipsCardTitle')}
      </span>

      {capturing && status?.currentGame && (
        <span className="mb-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {status.currentGame}
        </span>
      )}

      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling}
        className="mt-2 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all hover:scale-105 disabled:opacity-50"
        style={{
          background: capturing ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
          color: capturing ? '#ef4444' : '#22c55e',
          border: `1px solid ${capturing ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
        }}
      >
        {toggling ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : capturing ? (
          <Square className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {capturing ? t('gameClipsCardStop') : t('gameClipsCardStart')}
      </button>
    </div>
  )
}
