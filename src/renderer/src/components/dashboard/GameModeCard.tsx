import { Gamepad2, Loader2, Play, Square } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGameModeStore } from '@/stores/game-mode-store'

export function GameModeCard({ gameModeActive }: { gameModeActive: boolean }) {
  const { t } = useTranslation('dashboard')
  const storeConfig = useGameModeStore((s) => s.config)
  const status = useGameModeStore((s) => s.status)
  const setStatus = useGameModeStore((s) => s.setStatus)
  const isTransitioning = status !== 'idle'

  const handleToggle = useCallback(async () => {
    if (isTransitioning) return
    setStatus(gameModeActive ? 'deactivating' : 'activating')
    try {
      if (gameModeActive) {
        await window.dinho?.gameModeDeactivate?.()
        useGameModeStore.getState().setActive(false, null)
      } else {
        await window.dinho?.gameModeActivate?.(storeConfig)
        const current = await window.dinho?.gameModeStatus?.()
        if (current) {
          useGameModeStore.getState().setActive(current.active, current.activatedAt)
        }
      }
    } catch {
      // silent
    } finally {
      setStatus('idle')
    }
  }, [isTransitioning, gameModeActive, storeConfig, setStatus])

  const glowColor = gameModeActive ? '#06b6d4' : 'transparent'

  return (
    <div
      className="glass-card depth-mid group relative flex flex-col items-center justify-center overflow-hidden rounded-2xl px-4 py-5 text-center transition-all duration-500"
      style={{
        background: gameModeActive
          ? 'linear-gradient(180deg, rgba(6,182,212,0.08) 0%, rgba(139,92,246,0.04) 100%)'
          : 'var(--card-bg)',
        borderColor: gameModeActive ? 'rgba(6,182,212,0.2)' : 'var(--border-default)',
        animation: gameModeActive ? 'game-mode-pulse 2.5s ease-in-out infinite' : undefined,
      }}
    >
      {gameModeActive && (
        <div
          className="pointer-events-none absolute rounded-full opacity-25 blur-3xl"
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
          background: gameModeActive ? 'linear-gradient(135deg, #06b6d4, #8b5cf6)' : 'var(--bg-hover)',
          border: `2px solid ${gameModeActive ? '#06b6d4' : 'var(--border-strong)'}`,
        }}
      >
        <Gamepad2
          className="h-6 w-6"
          style={{ color: gameModeActive ? '#fff' : 'var(--text-muted)' }}
          strokeWidth={2}
        />
      </div>

      <span
        className="mb-1 text-sm font-bold tracking-[0.2em]"
        style={{ color: gameModeActive ? '#06b6d4' : 'var(--text-muted)' }}
      >
        {t('gameModeReady')}
      </span>

      <button
        type="button"
        onClick={handleToggle}
        disabled={isTransitioning}
        className="mt-2 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all hover:scale-105 disabled:opacity-50"
        style={{
          background: gameModeActive ? 'rgba(239,68,68,0.15)' : 'rgba(6,182,212,0.15)',
          color: gameModeActive ? '#ef4444' : '#06b6d4',
          border: `1px solid ${gameModeActive ? 'rgba(239,68,68,0.3)' : 'rgba(6,182,212,0.3)'}`,
        }}
      >
        {isTransitioning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : gameModeActive ? (
          <Square className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {status === 'activating'
          ? t('gameModeStarting', 'Iniciando...')
          : status === 'deactivating'
            ? t('gameModeStopping', 'Encerrando...')
            : gameModeActive
              ? t('gameModeStop', 'Parar')
              : t('gameModeStart', 'Iniciar')}
      </button>
    </div>
  )
}
