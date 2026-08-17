import { motion } from 'framer-motion'
import { Gauge, Shield, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function GameModeGpuTweaks() {
  const { t } = useTranslation('gameMode')
  const [vbsEnabled, setVbsEnabled] = useState(true)
  const [hagsEnabled, setHagsEnabled] = useState(true)
  const [vbsLoading, setVbsLoading] = useState(true)
  const [hagsLoading, setHagsLoading] = useState(true)

  useEffect(() => {
    window.dinho
      ?.gamingVbsGet?.()
      .then((r) => setVbsEnabled(r.enabled))
      .catch((e: unknown) => console.error('[GpuTweaks] vbs status failed:', e))
      .finally(() => setVbsLoading(false))
    window.dinho
      ?.gamingHagsGet?.()
      .then((r) => setHagsEnabled(r.enabled))
      .catch((e: unknown) => console.error('[GpuTweaks] hags status failed:', e))
      .finally(() => setHagsLoading(false))
  }, [])

  const handleToggleVbs = useCallback(async () => {
    const next = !vbsEnabled
    setVbsEnabled(next)
    try {
      const result = await window.dinho?.gamingVbsSet?.(next)
      if (result && !result.success) {
        setVbsEnabled(!next)
        toast.error(result.error ?? t('gpuTweaksApplyFailed'))
      }
    } catch {
      setVbsEnabled(!next)
      toast.error(t('gpuTweaksApplyFailed'))
    }
  }, [vbsEnabled, t])

  const handleToggleHags = useCallback(async () => {
    const next = !hagsEnabled
    setHagsEnabled(next)
    try {
      const result = await window.dinho?.gamingHagsSet?.(next)
      if (result && !result.success) {
        setHagsEnabled(!next)
        toast.error(result.error ?? t('gpuTweaksApplyFailed'))
      }
    } catch {
      setHagsEnabled(!next)
      toast.error(t('gpuTweaksApplyFailed'))
    }
  }, [hagsEnabled, t])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06, duration: 0.3 }}
      className="overflow-hidden rounded-xl"
      style={{
        border: '1px solid var(--border-default)',
        background: 'var(--bg-subtle)',
      }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(139,92,246,0.12)' }}
        >
          <Gauge className="h-[18px] w-[18px]" style={{ color: '#8b5cf6' }} strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <span className="text-[14px] font-semibold text-zinc-200">{t('gpuTweaksTitle')}</span>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t('gpuTweaksDesc')}</p>
        </div>
      </div>

      <div className="overflow-hidden" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: '1px solid var(--bg-subtle)' }}>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" style={{ color: '#8b5cf6' }} strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-zinc-300">{t('vbsLabel')}</span>
              <span
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
                style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
              >
                <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2.5} />
                {t('vbsWarningBadge')}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t('vbsDesc')}</p>
          </div>
          <button
            type="button"
            onClick={handleToggleVbs}
            disabled={vbsLoading}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40"
            style={{ background: vbsEnabled ? '#8b5cf6' : 'var(--bg-active)' }}
          >
            <motion.div
              className="absolute top-0.5 h-5 w-5 rounded-full"
              animate={{ left: vbsEnabled ? 22 : 2, background: vbsEnabled ? '#fff' : 'var(--text-muted)' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>

        <div className="flex items-center gap-4 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4" style={{ color: '#8b5cf6' }} strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <span className="text-[13px] font-medium text-zinc-300">{t('hagsLabel')}</span>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t('hagsDesc')}</p>
          </div>
          <button
            type="button"
            onClick={handleToggleHags}
            disabled={hagsLoading}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40"
            style={{ background: hagsEnabled ? '#8b5cf6' : 'var(--bg-active)' }}
          >
            <motion.div
              className="absolute top-0.5 h-5 w-5 rounded-full"
              animate={{ left: hagsEnabled ? 22 : 2, background: hagsEnabled ? '#fff' : 'var(--text-muted)' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
