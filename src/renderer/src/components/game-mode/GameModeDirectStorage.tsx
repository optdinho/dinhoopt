import type { DirectStorageStatus } from '@shared/types'
import { motion } from 'framer-motion'
import { CircleCheckBig, CircleHelp, CircleX, HardDrive, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function GameModeDirectStorage() {
  const { t } = useTranslation('gameMode')
  const [status, setStatus] = useState<DirectStorageStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const checkStatus = useCallback(() => {
    setLoading(true)
    window.dinho
      ?.directstorageCheck?.()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  if (loading && !status) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="overflow-hidden rounded-xl"
        style={{ border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}
      >
        <div className="flex items-center gap-4 px-5 py-4">
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: '#06b6d4 transparent #06b6d4 #06b6d4' }}
          />
          <span className="text-[13px] text-zinc-400">{t('directStorageChecking')}</span>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.3 }}
      className="overflow-hidden rounded-xl"
      style={{ border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(6,182,212,0.12)' }}
        >
          <HardDrive className="h-[18px] w-[18px]" style={{ color: '#06b6d4' }} strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <span className="text-[14px] font-semibold text-zinc-200">{t('directStorageTitle')}</span>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t('directStorageDesc')}</p>
        </div>
        <button
          type="button"
          onClick={checkStatus}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/[0.04]"
          style={{ background: 'rgba(6,182,212,0.12)', color: '#06b6d4' }}
        >
          <Search className="h-3 w-3" />
          {t('directStorageRefresh')}
        </button>
      </div>

      <div className="overflow-hidden" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: '1px solid var(--bg-subtle)' }}>
          <div className="flex-1">
            <span className="text-[13px] font-medium text-zinc-300">{t('directStorageGameSupport')}</span>
          </div>
          {status?.supported ? (
            <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#22c55e' }}>
              <CircleCheckBig className="h-3.5 w-3.5" strokeWidth={2} />
              {t('directStorageSupported')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] text-zinc-500">
              <CircleX className="h-3.5 w-3.5" strokeWidth={2} />
              {t('directStorageNotSupported')}
            </span>
          )}
        </div>

        <div className="px-5 py-3.5">
          <span className="text-[13px] font-medium text-zinc-300">{t('nvmeHealth')}</span>
          {status?.nvmeDrives && status.nvmeDrives.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {status.nvmeDrives.map((drive) => (
                <div key={drive.model} className="flex items-center gap-3 text-[12px]">
                  {drive.health === 'Healthy' ? (
                    <CircleCheckBig className="h-3 w-3 shrink-0" style={{ color: '#22c55e' }} strokeWidth={2} />
                  ) : drive.health === 'Caution' ? (
                    <CircleHelp className="h-3 w-3 shrink-0" style={{ color: '#f59e0b' }} strokeWidth={2} />
                  ) : (
                    <CircleX className="h-3 w-3 shrink-0" style={{ color: '#ef4444' }} strokeWidth={2} />
                  )}
                  <span className="flex-1 truncate text-zinc-400">{drive.model}</span>
                  <span
                    className="font-medium"
                    style={{
                      color:
                        drive.health === 'Healthy' ? '#22c55e' : drive.health === 'Caution' ? '#f59e0b' : '#ef4444',
                    }}
                  >
                    {drive.health === 'Healthy'
                      ? t('nvmeHealthy')
                      : drive.health === 'Caution'
                        ? t('nvmeCaution')
                        : drive.health === 'Bad'
                          ? t('nvmeBad')
                          : t('nvmeUnknown')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] text-zinc-500">{t('nvmeNotFound')}</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
