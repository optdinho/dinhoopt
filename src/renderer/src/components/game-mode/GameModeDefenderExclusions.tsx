import type { DefenderExclusionStatus } from '@shared/types'
import { motion } from 'framer-motion'
import { Plus, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const EMPTY_STATUS: DefenderExclusionStatus = { supported: false, tamperProtection: null, exclusions: [] }

export function GameModeDefenderExclusions() {
  const { t } = useTranslation('gameMode')
  const [status, setStatus] = useState<DefenderExclusionStatus>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.dinho?.defenderExclusionsStatus?.()
      if (result) setStatus(result)
    } catch (err) {
      console.error('[DefenderExclusions] status failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAdd = useCallback(async () => {
    const value = path.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const result = await window.dinho?.defenderExclusionsAdd?.(value)
      if (result?.success) {
        toast.success(t('defenderAdded'))
        setPath('')
        await refresh()
      } else {
        toast.error(result?.error ?? t('defenderAddFailed'))
      }
    } catch {
      toast.error(t('defenderAddFailed'))
    } finally {
      setBusy(false)
    }
  }, [path, busy, refresh, t])

  const handleRemove = useCallback(
    async (value: string) => {
      if (busy) return
      setBusy(true)
      try {
        const result = await window.dinho?.defenderExclusionsRemove?.(value)
        if (result?.success) {
          toast.success(t('defenderRemoved'))
          await refresh()
        } else {
          toast.error(result?.error ?? t('defenderRemoveFailed'))
        }
      } catch {
        toast.error(t('defenderRemoveFailed'))
      } finally {
        setBusy(false)
      }
    },
    [busy, refresh, t],
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08, duration: 0.3 }}
      className="overflow-hidden rounded-xl"
      style={{ border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(245,158,11,0.12)' }}
        >
          <ShieldAlert className="h-[18px] w-[18px]" style={{ color: '#f59e0b' }} strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-zinc-200">{t('defenderTitle')}</span>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
            >
              {t('defenderWarningBadge')}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t('defenderDesc')}</p>
        </div>
      </div>

      <div className="border-t border-white/[0.06] px-5 py-4">
        {loading ? (
          <p className="text-[11px] text-zinc-600">{t('defenderLoading')}</p>
        ) : !status.supported ? (
          <p className="text-[11px] text-zinc-500">{t('defenderUnsupported')}</p>
        ) : (
          <>
            {status.tamperProtection === true && (
              <p
                className="mb-3 rounded-lg px-3 py-2 text-[11px]"
                style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
              >
                {t('defenderTamper')}
              </p>
            )}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t('defenderAddPlaceholder')}
                className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-amber-500/30"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy || !path.trim()}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
              >
                <Plus className="h-3 w-3" />
                {t('defenderAdd')}
              </button>
            </div>
            {status.exclusions.length === 0 ? (
              <p className="text-[11px] text-zinc-600">{t('defenderEmpty')}</p>
            ) : (
              <div className="space-y-1">
                {status.exclusions.map((exclusion) => (
                  <div
                    key={exclusion}
                    className="flex items-center justify-between rounded-lg px-3 py-1.5"
                    style={{ background: 'var(--bg-subtle-2)' }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" style={{ color: '#22c55e' }} />
                      <span className="truncate text-[11px] text-zinc-400">{exclusion}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(exclusion)}
                      disabled={busy}
                      className="ml-2 shrink-0 rounded p-1 text-red-400 transition-colors hover:text-red-300 disabled:opacity-40"
                      aria-label={t('defenderRemove')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}
