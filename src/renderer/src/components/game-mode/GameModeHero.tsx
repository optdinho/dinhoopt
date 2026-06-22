import { motion } from 'framer-motion'
import { Gamepad2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatElapsed } from './constants'

const CYAN = '#06b6d4'
const PURPLE = '#8b5cf6'

function OrbitRing({
  radius,
  duration,
  delay,
  active,
}: { radius: number; duration: number; delay: number; active: boolean }) {
  return (
    <motion.div
      className="pointer-events-none absolute rounded-full"
      style={{
        width: radius * 2,
        height: radius * 2,
        top: '50%',
        left: '50%',
        marginTop: -radius,
        marginLeft: -radius,
        border: `1px solid ${active ? 'rgba(6,182,212,0.15)' : 'var(--grid-line)'}`,
      }}
      animate={active ? { scale: [1, 1.05, 1], opacity: [0.4, 0.8, 0.4] } : { scale: 1, opacity: 0.3 }}
      transition={active ? { duration, delay, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' } : { duration: 0.5 }}
    >
      {active && (
        <motion.div
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{ background: CYAN, boxShadow: `0 0 6px 2px ${CYAN}`, top: -3, left: '50%', marginLeft: -3 }}
          animate={{ rotate: 360 }}
          transition={{ duration: duration * 1.5, repeat: Number.POSITIVE_INFINITY, ease: 'linear', delay }}
        />
      )}
    </motion.div>
  )
}

function HexGrid({ active }: { active: boolean }) {
  const { t } = useTranslation('gameMode')
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
      style={{ opacity: active ? 0.6 : 0.2 }}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={t('ariaHexGrid')}>
        <title>{t('ariaHexGrid')}</title>
        <defs>
          <pattern id="hex-grid" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(0.5)">
            <path
              d="M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100"
              fill="none"
              stroke={active ? 'rgba(6,182,212,0.08)' : 'var(--grid-line)'}
              strokeWidth="0.5"
            />
            <path
              d="M28 0L56 16L56 50L28 66L0 50L0 16Z"
              fill="none"
              stroke={active ? 'rgba(6,182,212,0.08)' : 'var(--grid-line)'}
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex-grid)" />
      </svg>
    </div>
  )
}

interface GameModeHeroProps {
  active: boolean
  activatedAt: string | null
  isBusy: boolean
  enabledCount: number
  elapsed: number
  deactivateButtonLabel: string
  activateButtonLabel: string
  activeLabel: string
  inactiveLabel: string
  onActivate: () => void
  onDeactivate: () => void
}

export function GameModeHero({
  active,
  activatedAt,
  isBusy,
  elapsed,
  deactivateButtonLabel,
  activateButtonLabel,
  activeLabel,
  inactiveLabel,
  onActivate,
  onDeactivate,
}: GameModeHeroProps) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: active
          ? 'linear-gradient(180deg, rgba(6,182,212,0.05) 0%, rgba(139,92,246,0.03) 50%, rgba(6,182,212,0.02) 100%)'
          : 'var(--bg-subtle)',
        border: active ? 'none' : '1px solid var(--border-medium)',
      }}
    >
      {active && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            padding: '1px',
            backgroundImage: 'linear-gradient(90deg, #06b6d4, #8b5cf6, #ec4899, #8b5cf6, #06b6d4)',
            backgroundSize: '300% 100%',
            animation: 'game-mode-border-flow 3s linear infinite',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />
      )}
      <HexGrid active={active} />
      {active && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: 300,
            height: 300,
            background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, rgba(139,92,246,0.05) 40%, transparent 70%)',
          }}
        />
      )}
      <div className="relative flex flex-col items-center gap-5 py-10">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <OrbitRing radius={56} duration={3} delay={0} active={active} />
          <OrbitRing radius={72} duration={4} delay={0.5} active={active} />
          <OrbitRing radius={88} duration={5} delay={1} active={active} />
          <motion.button
            onClick={active ? onDeactivate : onActivate}
            disabled={isBusy}
            className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full transition-all disabled:opacity-50"
            style={{
              background: active ? `linear-gradient(135deg, ${CYAN}, ${PURPLE})` : 'var(--bg-subtle-2)',
              border: `2px solid ${active ? 'transparent' : 'var(--border-strong)'}`,
              boxShadow: active
                ? '0 0 30px 4px rgba(6,182,212,0.3), 0 0 80px 8px rgba(139,92,246,0.15), inset 0 0 20px rgba(255,255,255,0.1)'
                : '0 0 0 0 transparent',
              animation: active ? 'game-mode-pulse 2.5s ease-in-out infinite' : undefined,
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isBusy ? (
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
            ) : (
              <Gamepad2 className="h-9 w-9" style={{ color: active ? '#fff' : 'var(--text-dim)' }} strokeWidth={1.8} />
            )}
          </motion.button>
        </div>
        <div className="text-center">
          <motion.div
            className="text-xs font-bold tracking-[0.25em]"
            style={{ color: active ? CYAN : 'var(--text-dim)' }}
            animate={
              active
                ? {
                    textShadow: [
                      '0 0 8px rgba(6,182,212,0.4)',
                      '0 0 16px rgba(6,182,212,0.6)',
                      '0 0 8px rgba(6,182,212,0.4)',
                    ],
                  }
                : { textShadow: '0 0 0 transparent' }
            }
            transition={active ? { duration: 2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' } : {}}
          >
            {active ? activeLabel : inactiveLabel}
          </motion.div>
          {active && activatedAt && (
            <motion.div
              className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
              style={{ color: CYAN, textShadow: '0 0 20px rgba(6,182,212,0.3)' }}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {formatElapsed(elapsed)}
            </motion.div>
          )}
        </div>
        {!isBusy && (
          <motion.button
            onClick={active ? onDeactivate : onActivate}
            className="relative overflow-hidden rounded-lg px-6 py-2.5 text-xs font-bold tracking-widest transition-colors"
            style={{
              background: active ? 'rgba(239,68,68,0.1)' : 'rgba(6,182,212,0.1)',
              color: active ? '#ef4444' : CYAN,
              border: `1px solid ${active ? 'rgba(239,68,68,0.2)' : 'rgba(6,182,212,0.2)'}`,
            }}
            whileHover={{ boxShadow: active ? '0 0 20px rgba(239,68,68,0.15)' : '0 0 20px rgba(6,182,212,0.15)' }}
            whileTap={{ scale: 0.97 }}
          >
            {active ? deactivateButtonLabel : activateButtonLabel}
          </motion.button>
        )}
      </div>
    </div>
  )
}
