import type { ClipsConfig, HotkeyBinding } from '@shared/types'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { MODIFIER_KEYS } from './clips-utils'

interface ClipsActionDeps {
  config: ClipsConfig | null
  status: { running: boolean; capturing: boolean }
  selectedClips: Set<string>
  favorites: Set<string>
  setStarting: (v: boolean) => void
  setLoading: (v: boolean) => void
  setConfig: React.Dispatch<React.SetStateAction<ClipsConfig | null>>
  setFavorites: React.Dispatch<React.SetStateAction<Set<string>>>
  setRebindingId: (id: string | null) => void
  refreshClips: () => Promise<void>
  refreshConfig: () => Promise<void>
  refreshStatus: () => Promise<void>
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>
  t: (key: string) => string
}

export function useClipsActions(deps: ClipsActionDeps) {
  const {
    config,
    status,
    selectedClips,
    favorites,
    setStarting,
    setLoading,
    setConfig,
    setFavorites,
    setRebindingId,
    refreshClips,
    refreshConfig,
    refreshStatus,
    setSelectedClips,
    t,
  } = deps

  const handleConfigUpdate = useCallback(
    async (partial: Partial<ClipsConfig>) => {
      setConfig((prev) => (prev ? { ...prev, ...partial } : prev))
      await window.dinho?.clipsSetConfig(partial)
      await refreshConfig()
    },
    [setConfig, refreshConfig],
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

      let captureResult = await window.dinho?.clipsStartCapture()
      if (!captureResult?.success) {
        await new Promise((r) => setTimeout(r, 2000))
        captureResult = await window.dinho?.clipsStartCapture()
      }
      if (!captureResult?.success) {
        await new Promise((r) => setTimeout(r, 2000))
        captureResult = await window.dinho?.clipsStartCapture()
      }

      if (captureResult?.success) {
        toast.success(t('recordingStarted'))
        await refreshStatus()
      } else {
        toast.error(captureResult?.error || t('failedToStart'))
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setStarting(false)
    }
  }, [status.running, setStarting, refreshStatus, t])

  const handleStopRecording = useCallback(async () => {
    try {
      if (status.capturing) {
        await window.dinho?.clipsStopCapture()
      }
      await window.dinho?.clipsStopEngine()
      toast.success(t('recordingStopped'))
      await refreshStatus()
    } catch (err) {
      toast.error(String(err))
    }
  }, [status.capturing, refreshStatus, t])

  const handleSaveClip = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.dinho?.clipsSaveClip()
      if (result?.success) {
        toast.success(t('clipSaved'))
        await refreshClips()
      } else {
        toast.error(result?.error || 'Failed to save clip')
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
          toast.error(result?.error || 'Failed to delete clip')
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
      } catch {
        /* ignore */
      }
    }
    setSelectedClips(new Set())
    await refreshClips()
  }, [selectedClips, setSelectedClips, refreshClips, t])

  const handleRenameClip = useCallback(
    async (oldName: string) => {
      const newName = window.prompt(t('renamePrompt'), oldName)
      if (!newName || newName === oldName) return
      try {
        const result = await window.dinho?.clipsRename(oldName, newName)
        if (result?.success) {
          await refreshClips()
        } else {
          toast.error(result?.error || 'Failed to rename clip')
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
    } catch {
      /* ignore */
    }
  }, [])

  const handleSelectOutputDir = useCallback(async () => {
    const dir = await window.dinho?.clipsSelectOutputDir()
    if (dir) {
      await handleConfigUpdate({ outputDirectory: dir })
      toast.success(t('outputDirSelected'))
    }
  }, [handleConfigUpdate, t])

  const toggleFavorite = useCallback(
    (name: string) => {
      const isFavorite = favorites.has(name)
      setFavorites((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      window.dinho?.clipsSetFavorite(name, !isFavorite).catch(() => {})
    },
    [favorites, setFavorites],
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
      const keyHandler = (e: KeyboardEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (MODIFIER_KEYS.has(e.keyCode)) return
        if (rebindingId === 'hk-ptt') {
          const keys = config.pushToTalkKeys
          if (!keys.includes(e.keyCode)) {
            handleConfigUpdate({ pushToTalkKeys: [...keys, e.keyCode] })
          }
          setRebindingId(null)
          return
        }
        const modifiers: HotkeyBinding['modifiers'] = []
        if (e.ctrlKey) modifiers.push('Ctrl')
        if (e.shiftKey) modifiers.push('Shift')
        if (e.altKey) modifiers.push('Alt')
        const updated = config.hotkeys.map((h) => (h.id === rebindingId ? { ...h, vk: e.keyCode, modifiers } : h))
        handleConfigUpdate({ hotkeys: updated })
        setRebindingId(null)
      }
      const mouseHandler = (e: MouseEvent) => {
        const vk = e.button === 3 ? 0x05 : e.button === 4 ? 0x06 : null
        if (vk === null) return
        e.preventDefault()
        e.stopPropagation()
        if (rebindingId === 'hk-ptt') {
          const keys = config.pushToTalkKeys
          if (!keys.includes(vk)) {
            handleConfigUpdate({ pushToTalkKeys: [...keys, vk] })
          }
          setRebindingId(null)
          return
        }
        const modifiers: HotkeyBinding['modifiers'] = []
        if (e.ctrlKey) modifiers.push('Ctrl')
        if (e.shiftKey) modifiers.push('Shift')
        if (e.altKey) modifiers.push('Alt')
        const updated = config.hotkeys.map((h) => (h.id === rebindingId ? { ...h, vk, modifiers } : h))
        handleConfigUpdate({ hotkeys: updated })
        setRebindingId(null)
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
    toggleFavorite,
    addHotkey,
    removeHotkey,
    updateHotkey,
    setupRebindingListeners,
  }
}

export function formatClipsSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatClipsDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function formatClipsSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
