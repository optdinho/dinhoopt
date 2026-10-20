import type { ClipsConfig, HotkeyBinding } from '@shared/types'
import { useCallback } from 'react'
import { toast } from 'sonner'
import logger from '@/lib/renderer-logger'
import { MODIFIER_KEYS } from './clips-utils'

interface ClipsActionDeps {
  config: ClipsConfig | null
  status: { running: boolean; capturing: boolean }
  selectedClips: Set<string>
  favorites: Set<string>
  setStarting: (v: boolean) => void
  setStopping: (v: boolean) => void
  setLoading: (v: boolean) => void
  setConfig: React.Dispatch<React.SetStateAction<ClipsConfig | null>>
  setFavorites: React.Dispatch<React.SetStateAction<Set<string>>>
  setRebindingId: (id: string | null) => void
  setPublishingPath: (path: string | null) => void
  setPublishProgress: (pct: number) => void
  setPublishResult: (r: { link: string } | null) => void
  setPublishedLink: (path: string, link: string) => void
  refreshClips: () => Promise<void>
  refreshConfig: () => Promise<void>
  refreshStatus: () => Promise<void>
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>
  t: (key: string) => string
}

/**
 * Tenta iniciar a captura até `maxAttempts` vezes, esperando `delayMs` entre tentativas.
 * Devolve o último resultado obtido (sucesso ou falha).
 */
async function startCaptureWithRetry(
  startCapture: () => Promise<{ success?: boolean; error?: string } | undefined>,
  maxAttempts = 3,
  delayMs = 2000,
): Promise<{ success?: boolean; error?: string } | undefined> {
  let result = await startCapture()
  for (let attempt = 1; attempt < maxAttempts && !result?.success; attempt++) {
    await new Promise((r) => setTimeout(r, delayMs))
    result = await startCapture()
  }
  return result
}

/**
 * Patch de config para o rebind em curso: `hk-ptt` acrescenta a pushToTalkKeys
 * (sem duplicados); os restantes ids atualizam vk/modificadores do hotkey com o
 * mesmo id. Devolve `null` quando não há nada a mudar (PTT já contém a tecla).
 */
function computeRebindPatch(
  config: ClipsConfig,
  rebindingId: string,
  vk: number,
  modifiers: HotkeyBinding['modifiers'],
): Partial<ClipsConfig> | null {
  if (rebindingId === 'hk-ptt') {
    if (config.pushToTalkKeys.includes(vk)) return null
    return { pushToTalkKeys: [...config.pushToTalkKeys, vk] }
  }
  return { hotkeys: config.hotkeys.map((h) => (h.id === rebindingId ? { ...h, vk, modifiers } : h)) }
}

/** Modificadores premissados (Ctrl/Shift/Alt) de um evento de teclado ou rato. */
function modifiersFromEvent(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): HotkeyBinding['modifiers'] {
  const modifiers: HotkeyBinding['modifiers'] = []
  if (e.ctrlKey) modifiers.push('Ctrl')
  if (e.shiftKey) modifiers.push('Shift')
  if (e.altKey) modifiers.push('Alt')
  return modifiers
}

export function useClipsActions(deps: ClipsActionDeps) {
  const {
    config,
    status,
    selectedClips,
    favorites,
    setStarting,
    setStopping,
    setLoading,
    setConfig,
    setFavorites,
    setRebindingId,
    setPublishingPath,
    setPublishProgress,
    setPublishResult,
    setPublishedLink,
    refreshClips,
    refreshConfig,
    refreshStatus,
    setSelectedClips,
    t,
  } = deps

  const handleConfigUpdate = useCallback(
    async (partial: Partial<ClipsConfig>) => {
      setConfig((prev) => (prev ? { ...prev, ...partial } : prev))
      try {
        const result = await window.dinho?.clipsSetConfig(partial)
        if (result && result.success === false) {
          toast.error(result.error || t('configSyncFailed'))
          logger.error('clips', 'Config sync rejected by engine', result.error)
          await refreshConfig()
          return
        }
        await refreshConfig()
      } catch (err) {
        toast.error(t('configSyncFailed'))
        logger.error('clips', 'Config sync threw', err)
        await refreshConfig()
      }
    },
    [setConfig, refreshConfig, t],
  )

  const handleStartRecording = useCallback(async () => {
    setStarting(true)
    try {
      if (!status.running) {
        const engineResult = await window.dinho?.clipsStartEngine()
        if (!engineResult?.success) {
          toast.error(engineResult?.error || t('failedToStart'))
          return
        }
      }

      const captureResult = await startCaptureWithRetry(() => window.dinho?.clipsStartCapture())

      if (captureResult?.success) {
        toast.success(t('recordingStarted'))
        await refreshStatus()
      } else {
        toast.error(captureResult?.error || t('failedToStart'))
      }
    } catch (err) {
      toast.error(String(err))
      logger.error('clips', 'Failed to start recording', err)
    } finally {
      setStarting(false)
    }
  }, [status.running, setStarting, refreshStatus, t])

  const handleStopRecording = useCallback(async () => {
    setStopping(true)
    try {
      if (status.capturing) {
        await window.dinho?.clipsStopCapture()
      }
      await window.dinho?.clipsStopEngine()
      toast.success(t('recordingStopped'))
      await refreshStatus()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setStopping(false)
    }
  }, [status.capturing, setStopping, refreshStatus, t])

  const handleSaveClip = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.dinho?.clipsSaveClip()
      if (result?.success) {
        toast.success(t('clipSaved'))
        await refreshClips()
      } else {
        toast.error(result?.error || t('failedToSaveClip'))
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [setLoading, refreshClips, t])

  const handleDeleteClip = useCallback(
    async (name: string) => {
      if (!confirm(t('deleteConfirm'))) return
      try {
        const result = await window.dinho?.clipsDelete(name)
        if (result?.success) {
          await refreshClips()
        } else {
          toast.error(result?.error || t('failedToDeleteClip'))
        }
      } catch (err) {
        toast.error(String(err))
      }
    },
    [refreshClips, t],
  )

  const handleDeleteSelected = useCallback(async () => {
    const names = [...selectedClips]
    if (names.length === 0) return
    if (!confirm(t('deleteMultipleConfirm'))) return
    for (const name of names) {
      try {
        await window.dinho?.clipsDelete(name)
      } catch (err) {
        logger.error('clips', `Delete of "${name}" failed — continuing with the rest`, err)
      }
    }
    setSelectedClips(new Set())
    await refreshClips()
  }, [selectedClips, setSelectedClips, refreshClips, t])

  const handleRenameClip = useCallback(
    async (oldName: string, newName: string) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === oldName) return
      try {
        const result = await window.dinho?.clipsRename(oldName, trimmed)
        if (result?.success) {
          await refreshClips()
        } else {
          toast.error(result?.error || t('renameError'))
        }
      } catch (err) {
        toast.error(String(err))
      }
    },
    [refreshClips, t],
  )

  const handleOpenClip = useCallback(async (path: string) => {
    try {
      await window.dinho?.clipsOpen(path)
    } catch (err) {
      logger.error('clips', `Failed to open clip "${path}"`, err)
    }
  }, [])

  const handleSelectOutputDir = useCallback(async () => {
    const dir = await window.dinho?.clipsSelectOutputDir()
    if (dir) {
      await handleConfigUpdate({ outputDirectory: dir })
      toast.success(t('outputDirSelected'))
    }
  }, [handleConfigUpdate, t])

  const handlePublishClip = useCallback(
    async (_clipName: string, clipPath: string) => {
      setPublishingPath(clipPath)
      setPublishProgress(0)
      try {
        const result = await window.dinho?.clipsPublish(clipPath)
        const publishLink = result?.data?.link
        if (result?.success && publishLink) {
          setPublishResult({ link: publishLink })
          setPublishedLink(clipPath, publishLink)
        } else if (result?.code === 'ABORTED') {
          toast.info(t('publishCancelled'))
        } else {
          toast.error(result?.error || t('publishFailed'))
        }
      } catch (err) {
        toast.error(t('publishFailed') + (err instanceof Error ? `: ${err.message}` : ''))
      } finally {
        setPublishingPath(null)
        setPublishProgress(0)
      }
    },
    [setPublishingPath, setPublishProgress, setPublishResult, setPublishedLink, t],
  )

  const handleCancelPublish = useCallback(
    async (clipPath: string) => {
      const result = await window.dinho?.clipsPublishCancel(clipPath)
      if (!result?.success) {
        toast.error(result?.error || t('publishCancelFailed'))
      }
    },
    [t],
  )

  const toggleFavorite = useCallback(
    (name: string) => {
      const isFavorite = favorites.has(name)
      setFavorites((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      window.dinho
        ?.clipsSetFavorite?.(name, !isFavorite)
        .then((result) => {
          if (result && result.success === false) {
            setFavorites((prev) => {
              const next = new Set(prev)
              if (next.has(name)) next.delete(name)
              else next.add(name)
              return next
            })
            toast.error(result.error || t('favoriteFailed'))
          }
        })
        .catch(() => {
          setFavorites((prev) => {
            const next = new Set(prev)
            if (next.has(name)) next.delete(name)
            else next.add(name)
            return next
          })
          toast.error(t('favoriteFailed'))
        })
    },
    [favorites, setFavorites, t],
  )

  const addHotkey = useCallback(() => {
    if (!config) return
    const usedVks = new Set(config.hotkeys.map((h) => h.vk))
    let nextVk = 0x7c
    while (usedVks.has(nextVk)) nextVk++
    const newHk: HotkeyBinding = {
      id: `hk-${Date.now()}`,
      vk: nextVk,
      modifiers: [],
      action: 'saveClip',
      replayDurationSeconds: 60,
      enabled: true,
    }
    handleConfigUpdate({ hotkeys: [...config.hotkeys, newHk] })
  }, [config, handleConfigUpdate])

  const removeHotkey = useCallback(
    (id: string) => {
      if (!config) return
      handleConfigUpdate({ hotkeys: config.hotkeys.filter((h) => h.id !== id) })
    },
    [config, handleConfigUpdate],
  )

  const updateHotkey = useCallback(
    (id: string, patch: Partial<HotkeyBinding>) => {
      if (!config) return
      handleConfigUpdate({
        hotkeys: config.hotkeys.map((h) => (h.id === id ? { ...h, ...patch } : h)),
      })
    },
    [config, handleConfigUpdate],
  )

  // Hotkey rebinding effect — set up listeners when rebindingId is active
  const setupRebindingListeners = useCallback(
    (rebindingId: string | null) => {
      if (!rebindingId || !config) return () => {}
      const commitRebind = (vk: number, modifiers: HotkeyBinding['modifiers']) => {
        const patch = computeRebindPatch(config, rebindingId, vk, modifiers)
        if (patch) handleConfigUpdate(patch)
        setRebindingId(null)
      }
      const keyHandler = (e: KeyboardEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (MODIFIER_KEYS.has(e.keyCode)) return
        // Escape cancels the rebind without assigning itself as the hotkey.
        if (e.key === 'Escape' || e.keyCode === 27) {
          setRebindingId(null)
          return
        }
        commitRebind(e.keyCode, modifiersFromEvent(e))
      }
      const mouseHandler = (e: MouseEvent) => {
        const vk = e.button === 3 ? 0x05 : e.button === 4 ? 0x06 : null
        if (vk === null) return
        e.preventDefault()
        e.stopPropagation()
        commitRebind(vk, modifiersFromEvent(e))
      }
      window.addEventListener('keydown', keyHandler, true)
      window.addEventListener('mousedown', mouseHandler, true)
      return () => {
        window.removeEventListener('keydown', keyHandler, true)
        window.removeEventListener('mousedown', mouseHandler, true)
      }
    },
    [config, handleConfigUpdate, setRebindingId],
  )

  return {
    handleStartRecording,
    handleStopRecording,
    handleSaveClip,
    handleDeleteClip,
    handleDeleteSelected,
    handleOpenClip,
    handleRenameClip,
    handleConfigUpdate,
    handleSelectOutputDir,
    handlePublishClip,
    handleCancelPublish,
    toggleFavorite,
    addHotkey,
    removeHotkey,
    updateHotkey,
    setupRebindingListeners,
  }
}

export function formatClipsSize(bytes: number, t: (key: string) => string): string {
  if (bytes < 1024) return `${bytes} ${t('bytes')}`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('kilobytes')}`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('megabytes')}`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ${t('gigabytes')}`
}

export function formatClipsDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    logger.warn('clips', `formatClipsDate fell back to raw ISO for invalid date: ${iso}`)
    return iso
  }
}

export function formatClipsSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
