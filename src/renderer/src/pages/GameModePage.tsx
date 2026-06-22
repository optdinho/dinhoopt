import { GameModeAudit } from '@/components/game-mode/GameModeAudit'
import { GameModeAutoDetect } from '@/components/game-mode/GameModeAutoDetect'
import { GameModeCategoryCard } from '@/components/game-mode/GameModeCategoryCard'
import { GameModeHero } from '@/components/game-mode/GameModeHero'
import { GameModeProfiles } from '@/components/game-mode/GameModeProfiles'
import { CATEGORIES, OPTIMIZATIONS, formatElapsed } from '@/components/game-mode/constants'
import { PageHeader } from '@/components/layout/PageHeader'
import { useGameModeStore } from '@/stores/game-mode-store'
import type { GameModeOptimizationId } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, AlertTriangle, CheckCircle2, Radar, Shield, Timer, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function GameModePage() {
  const { t } = useTranslation('gameMode')
  const store = useGameModeStore
  const active = useGameModeStore((s) => s.active)
  const activatedAt = useGameModeStore((s) => s.activatedAt)
  const pendingRestore = useGameModeStore((s) => s.pendingRestore)
  const status = useGameModeStore((s) => s.status)
  const progress = useGameModeStore((s) => s.progress)
  const lastResult = useGameModeStore((s) => s.lastResult)
  const config = useGameModeStore((s) => s.config)
  const detectedGame = useGameModeStore((s) => s.detectedGame)
  const auditReport = useGameModeStore((s) => s.auditReport)
  const auditPhase = useGameModeStore((s) => s.auditPhase)

  const [elapsed, setElapsed] = useState(0)
  const [customInput, setCustomInput] = useState('')
  const [gameInput, setGameInput] = useState('')
  const [showAuditModal, setShowAuditModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const [profileGameName, setProfileGameName] = useState('')
  const [profileProcessName, setProfileProcessName] = useState('')
  const [profileOpts, setProfileOpts] = useState<GameModeOptimizationId[]>([])
  const progressCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      progressCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (!active || !activatedAt) {
      setElapsed(0)
      return
    }
    const start = new Date(activatedAt).getTime()
    const tick = () => setElapsed(Date.now() - start)
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [active, activatedAt])

  useEffect(() => {
    if (!lastResult) return
    const timer = setTimeout(() => store.getState().setLastResult(null), 8000)
    return () => clearTimeout(timer)
  }, [lastResult, store])

  const isBusy = status !== 'idle'

  const handleActivate = useCallback(async () => {
    if (config.enabledOptimizations.length === 0) {
      toast.error(t('noOptimizationsSelected'))
      return
    }
    store.getState().setStatus('activating')
    store.getState().setLastResult(null)
    progressCleanupRef.current =
      window.dinho?.onGameModeProgress?.((data) => {
        useGameModeStore.getState().setProgress(data)
      }) ?? null
    try {
      const result = await window.dinho.gameModeActivate(config)
      if (result.succeeded > 0) {
        store.getState().setActive(true, result.snapshot?.activatedAt ?? new Date().toISOString())
      }
      store.getState().setLastResult({ type: 'activate', succeeded: result.succeeded, failed: result.failed })
      if (result.succeeded === 0 && result.failed > 0) {
        toast.error(result.errors[0]?.reason ?? t('toastAllFailed'))
      } else if (result.failed > 0) {
        toast.warning(t('toastSomeFailed', { count: result.failed }))
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      toast.error(e?.message ?? t('toastActivationFailed'))
    } finally {
      store.getState().setStatus('idle')
      store.getState().setProgress(null)
      progressCleanupRef.current?.()
      progressCleanupRef.current = null
    }
  }, [config, t, store])

  const handleDeactivate = useCallback(async () => {
    store.getState().setStatus('deactivating')
    store.getState().setLastResult(null)
    progressCleanupRef.current =
      window.dinho?.onGameModeProgress?.((data) => {
        useGameModeStore.getState().setProgress(data)
      }) ?? null
    try {
      const result = await window.dinho.gameModeDeactivate()
      store.getState().setActive(false, null)
      store.getState().setPendingRestore(result.failed > 0)
      if (result.failed > 0) {
        toast.warning(t('toastRestoreFailed', { count: result.failed }))
      }
      store.getState().setLastResult({ type: 'deactivate', succeeded: result.restored, failed: result.failed })
    } catch (err: unknown) {
      const e = err as { message?: string }
      toast.error(e?.message ?? t('toastDeactivationFailed'))
    } finally {
      store.getState().setStatus('idle')
      store.getState().setProgress(null)
      progressCleanupRef.current?.()
      progressCleanupRef.current = null
    }
  }, [store, t])

  const handleAddCustomProcess = useCallback(() => {
    const name = customInput.trim()
    if (!name || name.length > 100 || config.customProcessKillList.includes(name)) return
    if (!/^[A-Za-z0-9._\- ]+$/.test(name)) {
      toast.error(t('validationProcessName'))
      return
    }
    store.getState().setCustomProcessKillList([...config.customProcessKillList, name])
    setCustomInput('')
  }, [customInput, config.customProcessKillList, store, t])

  const handleRemoveCustomProcess = useCallback(
    (name: string) => {
      store.getState().setCustomProcessKillList(config.customProcessKillList.filter((n) => n !== name))
    },
    [config.customProcessKillList, store],
  )

  const handleAddGameProcess = useCallback(() => {
    const name = gameInput.trim()
    if (!name || name.length > 100 || (config.customGameProcesses ?? []).includes(name)) return
    if (!/^[A-Za-z0-9._\- ]+$/.test(name)) {
      toast.error(t('validationProcessName'))
      return
    }
    store.getState().setCustomGameProcesses([...(config.customGameProcesses ?? []), name])
    setGameInput('')
  }, [gameInput, config.customGameProcesses, store, t])

  const handleRemoveGameProcess = useCallback(
    (name: string) => {
      store.getState().setCustomGameProcesses((config.customGameProcesses ?? []).filter((n) => n !== name))
    },
    [config.customGameProcesses, store],
  )

  const handleRunAudit = useCallback(async () => {
    await store.getState().runAudit('pre-activation')
    setShowAuditModal(true)
  }, [store])

  const enabledSet = new Set(config.enabledOptimizations)
  const enabledCount = config.enabledOptimizations.length
  const serviceCount = OPTIMIZATIONS.filter((o) => o.category === 'services' && enabledSet.has(o.id)).length

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      <div className="flex-1 space-y-5 px-6 pb-8">
        <GameModeHero
          active={active}
          activatedAt={activatedAt}
          isBusy={isBusy}
          enabledCount={enabledCount}
          elapsed={elapsed}
          activeLabel={t('activeLabel')}
          inactiveLabel={t('inactiveLabel')}
          activateButtonLabel={t('activateButton')}
          deactivateButtonLabel={t('deactivateButton')}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
        />

        <AnimatePresence>
          {active && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              {[
                { icon: Zap, label: t('statOptimizationsActive'), value: String(enabledCount), color: 'var(--accent)' },
                {
                  icon: Activity,
                  label: t('statServicesDisabled'),
                  value: String(serviceCount),
                  color: 'var(--accent-hover)',
                },
                { icon: Timer, label: t('statSessionTimer'), value: formatElapsed(elapsed), color: '#22c55e' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
                >
                  <stat.icon className="h-4 w-4 shrink-0" style={{ color: stat.color }} strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="truncate text-[10px] text-zinc-500">{stat.label}</div>
                    <div className="font-mono text-sm font-semibold tabular-nums" style={{ color: stat.color }}>
                      {stat.value}
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isBusy && progress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden rounded-xl"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--accent-muted-border)' }}
            >
              <div className="px-5 py-4">
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: 'var(--accent) transparent var(--accent) var(--accent)' }}
                  />
                  <span className="text-[13px] text-zinc-300">
                    {progress.phase === 'activating' ? t('activatingProgress') : t('deactivatingProgress')}
                  </span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      backgroundImage: 'linear-gradient(90deg, var(--accent), var(--accent-hover), var(--accent))',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 2s linear infinite',
                    }}
                    animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-zinc-500">
                  {progress.currentLabel} ({progress.current}/{progress.total})
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {lastResult && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 rounded-xl px-5 py-3.5"
              style={{
                background: lastResult.failed > 0 ? 'var(--accent-muted-bg)' : 'rgba(34,197,94,0.08)',
                border: `1px solid ${lastResult.failed > 0 ? 'var(--accent-muted-border)' : 'rgba(34,197,94,0.15)'}`,
              }}
            >
              {lastResult.failed > 0 ? (
                <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
              )}
              <span
                className="text-[13px]"
                style={{ color: lastResult.failed > 0 ? 'var(--accent-hover)' : '#86efac' }}
              >
                {lastResult.type === 'activate'
                  ? t('resultActivated', { count: lastResult.succeeded })
                  : t('resultDeactivated', { count: lastResult.succeeded })}
                {lastResult.failed > 0 && ` \u2022 ${t('resultErrors', { count: lastResult.failed })}`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {active && (
          <div
            className="flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-[12px]"
            style={{
              background: 'var(--accent-muted-bg)',
              border: '1px solid var(--accent-muted-border)',
              color: 'var(--accent)',
            }}
          >
            <Shield className="h-3.5 w-3.5 shrink-0" />
            {t('configLockedWhileActive')}
          </div>
        )}

        {!active && pendingRestore && (
          <div
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-[12px]"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t('pendingRestoreMessage')}</span>
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={isBusy}
              className="shrink-0 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(245,158,11,0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.3)',
              }}
            >
              {isBusy ? t('retrying') : t('retryCleanup')}
            </button>
          </div>
        )}

        <AnimatePresence>
          {detectedGame && active && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-[12px]"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)', color: '#22c55e' }}
            >
              <Radar className="h-3.5 w-3.5 shrink-0" />
              {t('autoDetectedBanner', { name: detectedGame })}
            </motion.div>
          )}
        </AnimatePresence>

        <GameModeAudit
          auditReport={auditReport}
          auditPhase={auditPhase}
          showModal={showAuditModal}
          onRunAudit={handleRunAudit}
          onOpenModal={() => setShowAuditModal(true)}
          onCloseModal={() => setShowAuditModal(false)}
        />

        <GameModeAutoDetect
          autoDetect={config.autoDetect}
          autoDeactivate={config.autoDeactivate}
          customGameProcesses={config.customGameProcesses ?? []}
          gameInput={gameInput}
          onToggleAutoDetect={() => store.getState().setAutoDetect(!config.autoDetect)}
          onToggleAutoDeactivate={() => store.getState().setAutoDeactivate(!config.autoDeactivate)}
          onAddGameProcess={handleAddGameProcess}
          onRemoveGameProcess={handleRemoveGameProcess}
          onGameInputChange={setGameInput}
        />

        <GameModeProfiles
          profileGameName={profileGameName}
          profileProcessName={profileProcessName}
          profileOpts={profileOpts}
          editingProfile={editingProfile}
          onProfileGameNameChange={setProfileGameName}
          onProfileProcessNameChange={setProfileProcessName}
          onProfileOptsChange={setProfileOpts}
          onStartNewProfile={() => {
            setProfileGameName('')
            setProfileProcessName('')
            setProfileOpts([...config.enabledOptimizations])
            setEditingProfile('__new__')
          }}
          onStartEditProfile={(key, gameName, processName, opts) => {
            setProfileGameName(gameName)
            setProfileProcessName(processName)
            setProfileOpts(opts)
            setEditingProfile(key)
          }}
          onCancelProfile={() => setEditingProfile(null)}
        />

        {CATEGORIES.map((cat, catIndex) => (
          <GameModeCategoryCard
            key={cat.id}
            cat={cat}
            catIndex={catIndex}
            enabledSet={enabledSet}
            customInput={customInput}
            active={active}
            onCustomInputChange={setCustomInput}
            onAddCustomProcess={handleAddCustomProcess}
            onRemoveCustomProcess={handleRemoveCustomProcess}
          />
        ))}

        <div className="h-4" />
      </div>
    </div>
  )
}
