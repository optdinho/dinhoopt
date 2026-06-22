import { cn } from '@/lib/utils'
import { Gamepad2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { formatGmElapsed } from './constants'

export function GameModeCard({
  gameModeActive,
  gameModeActivatedAt,
  gmElapsed,
}: {
  gameModeActive: boolean
  gameModeActivatedAt: string | null
  gmElapsed: number
}) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => navigate('/game-mode')}
      className={cn(
        'glass-card glass-card-hover depth-emphasis group relative flex flex-col items-center justify-center rounded-2xl px-4 py-5 sm:px-6 sm:py-6 text-center transition-all duration-500',
      )}
      style={{
        background: gameModeActive
          ? 'linear-gradient(180deg, rgba(6,182,212,0.08) 0%, rgba(139,92,246,0.04) 100%)'
          : 'var(--card-bg)',
        borderColor: gameModeActive ? 'rgba(6,182,212,0.2)' : 'var(--border-default)',
        animation: gameModeActive ? 'game-mode-pulse 2.5s ease-in-out infinite' : undefined,
        transition: 'background 0.5s ease, border-color 0.5s ease',
      }}
      aria-label={gameModeActive ? t('gameModeActive') : t('gameModeReady')}
    >
      <div
        className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full transition-all duration-500"
        style={{
          background: gameModeActive ? 'linear-gradient(135deg, #06b6d4, #8b5cf6)' : 'var(--bg-hover)',
          border: `2px solid ${gameModeActive ? '#06b6d4' : 'var(--border-strong)'}`,
          transition: 'background 0.5s ease, border-color 0.5s ease',
        }}
      >
        <Gamepad2
          className="h-6 w-6"
          style={{ color: gameModeActive ? '#fff' : 'var(--text-muted)' }}
          strokeWidth={2}
        />
      </div>
      <span
        className="mt-3 text-[11px] font-bold tracking-[0.2em]"
        style={{ color: gameModeActive ? '#06b6d4' : 'var(--text-muted)' }}
      >
        {gameModeActive ? t('gameModeActive') : t('gameModeReady')}
      </span>
      {gameModeActive && gameModeActivatedAt && (
        <span className="mt-1 font-mono text-lg font-semibold tabular-nums" style={{ color: '#06b6d4' }}>
          {formatGmElapsed(gmElapsed)}
        </span>
      )}
      {!gameModeActive && (
        <span className="mt-1 text-[11px] text-zinc-600 group-hover:text-zinc-400 transition-colors">
          {t('gameModeClickToOpen')}
        </span>
      )}
    </button>
  )
}
