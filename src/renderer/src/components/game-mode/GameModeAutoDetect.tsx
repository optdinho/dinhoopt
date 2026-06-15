import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Radar, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface GameModeAutoDetectProps {
  autoDetect: boolean
  autoDeactivate: boolean
  customGameProcesses: string[]
  gameInput: string
  onToggleAutoDetect: () => void
  onToggleAutoDeactivate: () => void
  onAddGameProcess: () => void
  onRemoveGameProcess: (name: string) => void
  onGameInputChange: (value: string) => void
}

export function GameModeAutoDetect({
  autoDetect,
  autoDeactivate,
  customGameProcesses,
  gameInput,
  onToggleAutoDetect,
  onToggleAutoDeactivate,
  onAddGameProcess,
  onRemoveGameProcess,
  onGameInputChange,
}: GameModeAutoDetectProps) {
  const { t } = useTranslation('gameMode')

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02, duration: 0.3 }}
      className="overflow-hidden rounded-xl"
      style={{
        border: `1px solid ${autoDetect ? 'rgba(34,197,94,0.15)' : 'var(--border-default)'}`,
        background: autoDetect ? 'linear-gradient(135deg, rgba(34,197,94,0.06), transparent)' : 'var(--bg-subtle)',
      }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(34,197,94,0.12)' }}
        >
          <Radar className="h-[18px] w-[18px]" style={{ color: '#22c55e' }} strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <span className="text-[14px] font-semibold text-zinc-200">{t('autoDetectTitle')}</span>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t('autoDetectDesc')}</p>
        </div>
        <button
          type="button"
          onClick={onToggleAutoDetect}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          style={{ background: autoDetect ? '#22c55e' : 'var(--bg-active)' }}
        >
          <motion.div
            className="absolute top-0.5 h-5 w-5 rounded-full"
            animate={{ left: autoDetect ? 22 : 2, background: autoDetect ? '#fff' : 'var(--text-muted)' }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      <AnimatePresence>
        {autoDetect && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: '1px solid var(--bg-subtle)' }}>
              <div className="flex-1">
                <span className="text-[13px] font-medium text-zinc-300">{t('autoDeactivateLabel')}</span>
                <p className="mt-0.5 text-[11px] text-zinc-500">{t('autoDeactivateDesc')}</p>
              </div>
              <button
                type="button"
                onClick={onToggleAutoDeactivate}
                className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                style={{ background: autoDeactivate ? '#22c55e' : 'var(--bg-active)' }}
              >
                <motion.div
                  className="absolute top-0.5 h-5 w-5 rounded-full"
                  animate={{ left: autoDeactivate ? 22 : 2, background: autoDeactivate ? '#fff' : 'var(--text-muted)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            <div className="px-5 py-3.5">
              <div className="mb-2">
                <span className="text-[13px] font-medium text-zinc-300">{t('customGameProcessesLabel')}</span>
                <p className="mt-0.5 text-[11px] text-zinc-500">{t('customGameProcessesDesc')}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={gameInput}
                  onChange={(e) => onGameInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onAddGameProcess()}
                  placeholder={t('customGamePlaceholder')}
                  className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-emerald-500/30"
                />
                <button
                  type="button"
                  onClick={onAddGameProcess}
                  disabled={!gameInput.trim()}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                  style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                >
                  <Plus className="h-3 w-3" />
                  {t('customGameAdd')}
                </button>
              </div>
              {customGameProcesses.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {customGameProcesses.map((name) => (
                    <span
                      key={name}
                      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
                      style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
                    >
                      {name}
                      <button type="button" onClick={() => onRemoveGameProcess(name)} className="hover:text-red-400">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-zinc-600">{t('customGameEmpty')}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
