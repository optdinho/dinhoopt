import { PageHeader } from '@/components/layout/PageHeader'
import type {
  AudioSessionInfo,
  ClipInfo,
  ClipsConfig,
  ClipsEngineStatus,
  HotkeyBinding,
  MicDeviceInfo,
} from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  CircleStop,
  Clapperboard,
  Cpu,
  Download,
  Film,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Mic,
  Microscope,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const VK_MAP: Record<number, string> = {
  0x05: 'Mouse4',
  0x06: 'Mouse5',
  0x08: 'Backspace',
  0x09: 'Tab',
  0x0c: 'Clear',
  0x0d: 'Enter',
  0x13: 'Pause',
  0x14: 'CapsLock',
  0x1b: 'Esc',
  0x20: 'Space',
  0x21: 'PageUp',
  0x22: 'PageDown',
  0x23: 'End',
  0x24: 'Home',
  0x25: '←',
  0x26: '↑',
  0x27: '→',
  0x28: '↓',
  0x2c: 'PrintScreen',
  0x2d: 'Insert',
  0x2e: 'Delete',
  0x30: '0',
  0x31: '1',
  0x32: '2',
  0x33: '3',
  0x34: '4',
  0x35: '5',
  0x36: '6',
  0x37: '7',
  0x38: '8',
  0x39: '9',
  0x41: 'A',
  0x42: 'B',
  0x43: 'C',
  0x44: 'D',
  0x45: 'E',
  0x46: 'F',
  0x47: 'G',
  0x48: 'H',
  0x49: 'I',
  0x4a: 'J',
  0x4b: 'K',
  0x4c: 'L',
  0x4d: 'M',
  0x4e: 'N',
  0x4f: 'O',
  0x50: 'P',
  0x51: 'Q',
  0x52: 'R',
  0x53: 'S',
  0x54: 'T',
  0x55: 'U',
  0x56: 'V',
  0x57: 'W',
  0x58: 'X',
  0x59: 'Y',
  0x5a: 'Z',
  0x5b: 'Win',
  0x5c: 'Win',
  0x5d: 'Menu',
  0x60: 'Num0',
  0x61: 'Num1',
  0x62: 'Num2',
  0x63: 'Num3',
  0x64: 'Num4',
  0x65: 'Num5',
  0x66: 'Num6',
  0x67: 'Num7',
  0x68: 'Num8',
  0x69: 'Num9',
  0x6a: 'Num*',
  0x6b: 'Num+',
  0x6d: 'Num-',
  0x6e: 'Num.',
  0x6f: 'Num/',
  0x70: 'F1',
  0x71: 'F2',
  0x72: 'F3',
  0x73: 'F4',
  0x74: 'F5',
  0x75: 'F6',
  0x76: 'F7',
  0x77: 'F8',
  0x78: 'F9',
  0x79: 'F10',
  0x7a: 'F11',
  0x7b: 'F12',
  0x7c: 'F13',
  0x7d: 'F14',
  0x7e: 'F15',
  0x7f: 'F16',
  0x80: 'F17',
  0x81: 'F18',
  0x82: 'F19',
  0x83: 'F20',
  0x84: 'F21',
  0x85: 'F22',
  0x86: 'F23',
  0x87: 'F24',
  0x90: 'NumLock',
  0x91: 'ScrollLock',
  0xa0: 'LShift',
  0xa1: 'RShift',
  0xa2: 'LCtrl',
  0xa3: 'RCtrl',
  0xa4: 'LAlt',
  0xa5: 'RAlt',
  0xba: ';',
  0xbb: '=',
  0xbc: ',',
  0xbd: '-',
  0xbe: '.',
  0xbf: '/',
  0xc0: '`',
  0xdb: '[',
  0xdc: '\\',
  0xdd: ']',
  0xde: "'",
  0xe2: '\\',
}
const MODIFIER_KEYS = new Set([0x11, 0x10, 0x12]) // Ctrl, Shift, Alt
const MODIFIER_MAP: Record<number, 'Ctrl' | 'Shift' | 'Alt'> = { 0x11: 'Ctrl', 0x10: 'Shift', 0x12: 'Alt' }
const REPLAY_DURATIONS = [30, 60, 120, 300, 600] // 30s, 1min, 2min, 5min, 10min

function formatUptime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatKey(vk: number, modifiers: string[]): string {
  const parts = [
    ...modifiers.sort((a) => (a === 'Ctrl' ? -1 : a === 'Shift' ? 0 : 1)),
    VK_MAP[vk] || `0x${vk.toString(16)}`,
  ]
  return parts.join('+')
}

type FilterTab = 'all' | 'today' | 'week' | 'favorites'

export function ClipsPage() {
  const { t } = useTranslation('clips')
  const [status, setStatus] = useState<ClipsEngineStatus>({
    running: false,
    capturing: false,
    uptime: 0,
    fps: 60,
    replayTimeSeconds: 60,
  })
  const [config, setConfig] = useState<ClipsConfig | null>(null)
  const [clips, setClips] = useState<ClipInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [rebindingId, setRebindingId] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [audioSessions, setAudioSessions] = useState<AudioSessionInfo[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [showProcPicker, setShowProcPicker] = useState(false)
  const [procSearch, setProcSearch] = useState('')
  const [processes, setProcesses] = useState<Array<{ name: string; pid: number }>>([])
  const [micDevices, setMicDevices] = useState<MicDeviceInfo[]>([])
  const [loadingMicDevices, setLoadingMicDevices] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('clips-favorites')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    localStorage.setItem('clips-favorites', JSON.stringify([...favorites]))
  }, [favorites])

  useEffect(() => {
    if (!rebindingId || !config) return
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
  }, [rebindingId, config])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.dinho?.clipsGetStatus()
      if (s) setStatus(s)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshConfig = useCallback(async () => {
    try {
      const c = await window.dinho?.clipsGetConfig()
      if (c) setConfig(c)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshClips = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await window.dinho?.clipsList()
      if (list) {
        setClips(list)
        setThumbnails({})
      }
    } catch {
      /* ignore */
    }
    setRefreshing(false)
  }, [])

  const loadMicDevices = useCallback(async () => {
    setLoadingMicDevices(true)
    let attempts = 0
    const maxAttempts = 8
    while (attempts < maxAttempts) {
      try {
        attempts++
        const devices = await window.dinho?.clipsGetMicDevices()
        if (devices && devices.length > 0) {
          setMicDevices(devices)
          setLoadingMicDevices(false)
          return
        }
        if (attempts < maxAttempts) await new Promise((r) => setTimeout(r, 800))
      } catch {
        /* ignore */
      }
    }
    console.log(`[clips-mic] all ${maxAttempts} attempts failed — no mic devices`)
    setLoadingMicDevices(false)
  }, [])

  useEffect(() => {
    if (status.running) loadMicDevices()
  }, [status.running, loadMicDevices])

  const loadThumbnail = useCallback(async (clipName: string) => {
    try {
      const dataUrl = await window.dinho?.clipsGetThumbnail(clipName)
      if (dataUrl) setThumbnails((prev) => ({ ...prev, [clipName]: dataUrl }))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (clips.length === 0) return
    const timer = setTimeout(() => {
      for (let i = 0; i < clips.length; i++) {
        setTimeout(() => loadThumbnail(clips[i].name), i * 200)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [clips, loadThumbnail])

  useEffect(() => {
    refreshStatus()
    refreshConfig()
    refreshClips()
  }, [refreshStatus, refreshConfig, refreshClips])

  useEffect(() => {
    const timer = setInterval(refreshStatus, 3000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  const handleStartRecording = async () => {
    setStarting(true)
    try {
      if (!status.running) {
        const engineResult = await window.dinho?.clipsStartEngine()
        if (!engineResult?.success) {
          toast.error(engineResult?.error || t('failedToStart'))
          setStarting(false)
          return
        }
      }
      const captureResult = await window.dinho?.clipsStartCapture()
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
  }

  const handleStopRecording = async () => {
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
  }

  const handleSaveClip = async () => {
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
  }

  const handleDeleteClip = async (name: string) => {
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
  }

  const handleDeleteSelected = async () => {
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
  }

  const handleOpenClip = async (path: string) => {
    try {
      await window.dinho?.clipsOpen(path)
    } catch {
      /* ignore */
    }
  }

  const handleConfigUpdate = async (partial: Partial<ClipsConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...partial } : prev))
    await window.dinho?.clipsSetConfig(partial)
    await refreshConfig()
  }

  const handleSelectOutputDir = async () => {
    const dir = await window.dinho?.clipsSelectOutputDir()
    if (dir) {
      await handleConfigUpdate({ outputDirectory: dir })
      toast.success(t('outputDirSelected'))
    }
  }

  const refreshAudioSessions = useCallback(async () => {
    try {
      const sessions = await window.dinho?.clipsGetAudioSessions()
      if (!sessions) return
      // Se retornou vazio mas já temos dados, ignora (pipe desconectou transitoriamente)
      if (sessions.length === 0) return
      setAudioSessions((prev) => {
        const updated = sessions.map((s) => ({
          ...s,
          isSelected: prev.find((p) => p.processId === s.processId)?.isSelected ?? s.isSelected,
        }))
        if (
          prev.length === updated.length &&
          prev.every(
            (s, i) =>
              s.processId === updated[i].processId &&
              s.processName === updated[i].processName &&
              s.displayName === updated[i].displayName &&
              s.isSelected === updated[i].isSelected,
          )
        )
          return prev
        return updated
      })
    } catch {
      toast.error(t('audioSessionRefreshError'))
    }
  }, [t])

  const handleToggleAudioSession = async (pid: number) => {
    const current = audioSessions.find((s) => s.processId === pid)
    if (!current) return
    const updated = audioSessions.map((s) => (s.processId === pid ? { ...s, isSelected: !s.isSelected } : s))
    setAudioSessions(updated)
    const selectedPids = updated.filter((s) => s.isSelected).map((s) => s.processId)
    const result = await window.dinho?.clipsSetAudioSessions(selectedPids)
    if (result?.success) {
      toast.success(t('audioSessionsUpdated'))
    }
  }

  const handleSelectAllAudioSessions = async () => {
    const noneSelected = audioSessions.every((s) => !s.isSelected)
    if (noneSelected) {
      // All-apps mode → select all (custom mode)
      const updated = audioSessions.map((s) => ({ ...s, isSelected: true }))
      setAudioSessions(updated)
      const result = await window.dinho?.clipsSetAudioSessions(updated.map((s) => s.processId))
      if (result?.success) toast.success(t('audioSessionsUpdated'))
    } else {
      // Custom mode → all-apps mode (deselect all)
      const updated = audioSessions.map((s) => ({ ...s, isSelected: false }))
      setAudioSessions(updated)
      const result = await window.dinho?.clipsSetAudioSessions([])
      if (result?.success) toast.success(t('audioSessionsUpdated'))
    }
  }

  const toggleFavorite = (name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  const filteredClips = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000

    return clips.filter((clip) => {
      if (filterTab === 'today') {
        const t = new Date(clip.createdAt).getTime()
        if (t < startOfToday) return false
      }
      if (filterTab === 'week') {
        const t = new Date(clip.createdAt).getTime()
        if (t < startOfWeek) return false
      }
      if (filterTab === 'favorites' && !favorites.has(clip.name)) return false
      if (searchQuery && !clip.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
  }, [clips, filterTab, searchQuery, favorites])

  const autoReplayTime = useMemo(() => {
    if (!config) return 60
    const maxDuration = Math.max(
      ...config.hotkeys
        .filter((h) => h.enabled && h.action === 'saveClip' && h.replayDurationSeconds)
        .map((h) => h.replayDurationSeconds!),
      60,
    )
    return maxDuration
  }, [config?.hotkeys])

  // Auto-filter audio sessions when gameAudioOnly is on and game changes
  const lastGameRef = useRef('')
  useEffect(() => {
    if (!config?.gameAudioOnly || !status.currentGame) return
    if (lastGameRef.current === status.currentGame) return
    lastGameRef.current = status.currentGame
    const gameProcessName = status.currentGame.toLowerCase().endsWith('.exe')
      ? status.currentGame
      : `${status.currentGame.toLowerCase()}.exe`
    // Busca sessions atualizadas do engine
    window.dinho?.clipsGetAudioSessions().then((sessions) => {
      if (!sessions) return
      const matching = sessions.filter((s) => s.processName.toLowerCase() === gameProcessName)
      if (matching.length > 0) {
        const selectedPids = matching.map((s) => s.processId)
        setAudioSessions(sessions.map((s) => ({ ...s, isSelected: selectedPids.includes(s.processId) })))
        window.dinho?.clipsSetAudioSessions(selectedPids)
      } else {
        // Nenhum processo do jogo encontrado nas sessions atuais
        setAudioSessions(sessions.map((s) => ({ ...s, isSelected: false })))
        window.dinho?.clipsSetAudioSessions([])
      }
    })
  }, [config?.gameAudioOnly, status.currentGame])

  // Carrega sessions ao montar e faz refresh periódico
  useEffect(() => {
    refreshAudioSessions()
    const interval = setInterval(refreshAudioSessions, config?.gameAudioOnly ? 5000 : 30000)
    return () => clearInterval(interval)
  }, [config?.gameAudioOnly, refreshAudioSessions])

  // Auto-increase buffer when a hotkey needs more than current, but never decrease (user's manual selection takes priority)
  useEffect(() => {
    if (!config || config.replayTimeSeconds >= autoReplayTime) return
    const timer = setTimeout(() => {
      handleConfigUpdate({ replayTimeSeconds: autoReplayTime })
    }, 500)
    return () => clearTimeout(timer)
  }, [autoReplayTime])

  const estimatedRamMB = useMemo(() => {
    if (!config) return 0
    return Math.round(((config.bitrateKbps * (config.replayTimeSeconds || status.replayTimeSeconds)) / 8 / 1024) * 1.05)
  }, [config, status.replayTimeSeconds])

  const addHotkey = () => {
    if (!config) return
    const usedVks = new Set(config.hotkeys.map((h) => h.vk))
    let nextVk = 0x7c // F13
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
  }

  const removeHotkey = (id: string) => {
    if (!config) return
    handleConfigUpdate({ hotkeys: config.hotkeys.filter((h) => h.id !== id) })
  }

  const updateHotkey = (id: string, patch: Partial<HotkeyBinding>) => {
    if (!config) return
    handleConfigUpdate({
      hotkeys: config.hotkeys.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    })
  }

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'all' },
    { key: 'today', label: 'today' },
    { key: 'week', label: 'week' },
    { key: 'favorites', label: 'favorites' },
  ]

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowConfig(!showConfig)}
          className="mt-1 shrink-0 rounded-lg p-2 transition-colors hover:bg-white/[0.06]"
          style={{ color: showConfig ? 'var(--accent)' : 'var(--text-dim)' }}
          title={showConfig ? 'Hide Settings' : 'Settings'}
        >
          <motion.div animate={{ rotate: showConfig ? 90 : 0 }} transition={{ duration: 0.25, ease: 'easeInOut' }}>
            <Settings className="h-5 w-5" />
          </motion.div>
        </motion.button>
      </div>

      <div className="mt-6 flex gap-6">
        <div className="min-w-0 flex-1 space-y-6">
          {/* ── Recording Status ── */}
          <div
            className="rounded-xl border p-5"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('recordingStatus')}
            </h3>
            <div className="mt-3 flex flex-wrap gap-3">
              {(() => {
                if (status.running && status.capturing) {
                  return (
                    <div
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                      style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                    >
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      {t('recording')}
                    </div>
                  )
                }
                if (status.running) {
                  return (
                    <div
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                      style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
                    >
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      {t('idle')}
                    </div>
                  )
                }
                return (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: 'rgba(113,113,122,0.12)', color: '#71717a' }}
                  >
                    <span className="h-2 w-2 rounded-full bg-zinc-500" />
                    {t('stopped')}
                  </div>
                )
              })()}
              {status.running && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
                >
                  <span>
                    {t('fps')}: {status.fps}
                  </span>
                  <span className="mx-1">·</span>
                  <span>
                    {t('replayTime')}: {Math.floor(status.replayTimeSeconds / 60)}min
                  </span>
                </div>
              )}
              {status.running && status.captureBackend && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
                >
                  <Cpu className="h-3 w-3" />
                  <span>{status.captureBackend}</span>
                  {status.encoder && (
                    <>
                      <span className="mx-1">·</span>
                      <span>{status.encoder}</span>
                    </>
                  )}
                </div>
              )}
              {status.running && status.currentGame && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
                >
                  <Gamepad2 className="h-3 w-3" />
                  <span>{status.currentGame}</span>
                </div>
              )}
              {status.running && status.estimatedRamMB && status.estimatedRamMB > 0 && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
                >
                  <HardDrive className="h-3 w-3" />
                  <span>~{status.estimatedRamMB}MB</span>
                </div>
              )}
              {status.lastCrashRecovered && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
                >
                  <Microscope className="h-3 w-3" />
                  <span>{t('crashRecovered')}</span>
                </div>
              )}
              {status.audioFallback && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span title={t('audioFallbackDesc')}>{t('audioFallbackWarning')}</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {status.running && status.capturing ? (
                <>
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                  >
                    <CircleStop className="h-4 w-4" />
                    {t('stopRecording')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveClip}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    <Download className="h-4 w-4" />
                    {loading ? '...' : t('saveClip')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={starting}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Video className="h-4 w-4" />
                  {starting ? '...' : t('startRecording')}
                </button>
              )}
            </div>
          </div>

          {/* ── Clips ── */}
          <div
            className="rounded-xl border p-5"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                <Film className="mr-2 inline-block h-4 w-4" />
                {t('clips')}
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
                  {t('clipCount', { count: filteredClips.length })}
                </span>
              </h3>
              <button
                type="button"
                onClick={refreshClips}
                disabled={refreshing}
                className="rounded-lg p-1.5 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                  style={{ color: 'var(--text-dim)' }}
                />
              </button>
            </div>

            {/* Filter tabs + search */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {filterTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterTab(tab.key)}
                  className="rounded-lg px-3 py-1 text-xs font-medium transition-all"
                  style={{
                    background: filterTab === tab.key ? 'var(--accent)' : 'rgba(113,113,122,0.1)',
                    color: filterTab === tab.key ? '#fff' : 'var(--text-dim)',
                  }}
                >
                  {t(tab.label)}
                </button>
              ))}
              <div className="relative ml-auto">
                <Search
                  className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                  style={{ color: 'var(--text-dim)' }}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search')}
                  className="w-36 rounded-lg py-1.5 pl-7 pr-2 text-xs outline-none"
                  style={{ background: 'rgba(113,113,122,0.1)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* Multi-select toolbar */}
            {filteredClips.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filteredClips.length > 0 && filteredClips.every((c) => selectedClips.has(c.name))}
                    onChange={() => {
                      if (filteredClips.every((c) => selectedClips.has(c.name))) {
                        setSelectedClips(new Set())
                      } else {
                        setSelectedClips(new Set(filteredClips.map((c) => c.name)))
                      }
                    }}
                    className="h-3.5 w-3.5 rounded"
                  />
                  <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    {selectedClips.size > 0 ? t('selectedCount', { count: selectedClips.size }) : t('selectAll')}
                  </span>
                </label>
                {selectedClips.size > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all hover:bg-red-500/15"
                    style={{ color: '#ef4444' }}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('deleteSelected')}
                  </button>
                )}
              </div>
            )}

            {/* Clip grid */}
            {filteredClips.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--text-dim)' }}>
                {searchQuery || filterTab !== 'all' ? t('noClips') : t('noClips')}
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <AnimatePresence>
                  {filteredClips.map((clip, index) => (
                    <motion.div
                      key={clip.name}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ delay: index * 0.03 }}
                      className="group relative rounded-xl border overflow-hidden transition-colors hover:bg-white/5"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {/* Selection checkbox (visible on hover or when checked) */}
                      <div
                        className="absolute left-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ opacity: selectedClips.has(clip.name) ? 1 : undefined }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedClips.has(clip.name)}
                          onChange={() => {
                            setSelectedClips((prev) => {
                              const next = new Set(prev)
                              if (next.has(clip.name)) next.delete(clip.name)
                              else next.add(clip.name)
                              return next
                            })
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded"
                        />
                      </div>

                      {/* Thumbnail */}
                      <div
                        className="flex aspect-video items-center justify-center overflow-hidden"
                        style={{ background: 'rgba(113,113,122,0.08)' }}
                      >
                        {thumbnails[clip.name] ? (
                          <img src={thumbnails[clip.name]} alt={clip.name} className="h-full w-full object-cover" />
                        ) : (
                          <Clapperboard className="h-8 w-8" style={{ color: 'var(--text-dim)', opacity: 0.4 }} />
                        )}
                      </div>

                      {/* Info */}
                      <div className="p-2.5">
                        <p className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {clip.name}
                        </p>
                        <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                          {formatDate(clip.createdAt)} · {formatSize(clip.size)}
                        </p>
                      </div>

                      {/* Favorites star (right side, won't overlap checkbox) */}
                      <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => toggleFavorite(clip.name)}
                          className="rounded-lg p-1 transition-colors hover:bg-black/20"
                        >
                          <Star
                            className="h-3.5 w-3.5"
                            style={{
                              color: favorites.has(clip.name) ? '#facc15' : 'rgba(255,255,255,0.7)',
                              fill: favorites.has(clip.name) ? '#facc15' : 'none',
                            }}
                          />
                        </button>
                      </div>

                      {/* Bottom actions */}
                      <div className="flex border-t px-2.5 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenClip(clip.path)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/10"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          <FolderOpen className="h-3 w-3" />
                          {t('open')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClip(clip.name)}
                          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-red-500/10"
                          style={{ color: '#ef4444' }}
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('delete')}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* ── Sidebar: Config ── */}
        <AnimatePresence>
          {showConfig && config && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden shrink-0"
            >
              <div className="w-[380px] space-y-3">
                {/* ── Output Directory (always visible, compact) ── */}
                <div
                  className="rounded-xl border px-4 py-3"
                  style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <HardDrive className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-dim)' }} />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[11px]"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {config.outputDirectory}
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectOutputDir}
                      className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {t('chooseOutputDir')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenClip(config.outputDirectory)}
                      className="shrink-0 rounded-md p-1 transition-colors hover:bg-white/10"
                      title={t('openFolder')}
                    >
                      <FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-dim)' }} />
                    </button>
                  </div>
                </div>

                {/* ── Collapsible Config Section ── */}
                {[
                  {
                    id: 'quality',
                    icon: Video,
                    label: t('recordingQuality'),
                    defaultOpen: true,
                    content: (
                      <div className="space-y-3">
                        {/* Replay Time */}
                        <div>
                          <p
                            className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            {t('replayTime')}
                          </p>
                          <div className="flex gap-1">
                            {[60, 180, 300, 600].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleConfigUpdate({ replayTimeSeconds: s })}
                                className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                                style={{
                                  background:
                                    s === config.replayTimeSeconds ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                                  color: s === config.replayTimeSeconds ? '#fff' : 'var(--text-primary)',
                                }}
                              >
                                {Math.floor(s / 60)}min
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* FPS */}
                        <div>
                          <p
                            className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            FPS
                          </p>
                          <div className="flex gap-1">
                            {[30, 60, 75, 120].map((f) => (
                              <button
                                key={f}
                                type="button"
                                onClick={() => handleConfigUpdate({ fps: f })}
                                className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                                style={{
                                  background: f === config.fps ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                                  color: f === config.fps ? '#fff' : 'var(--text-primary)',
                                }}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Resolution + Bitrate side by side */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p
                              className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                              style={{ color: 'var(--text-dim)' }}
                            >
                              {t('resolution')}
                            </p>
                            <div className="flex gap-1">
                              {[
                                { w: 1280, h: 720, l: '720p' },
                                { w: 1920, h: 1080, l: '1080p' },
                              ].map((r) => (
                                <button
                                  key={r.l}
                                  type="button"
                                  onClick={() => handleConfigUpdate({ width: r.w, height: r.h })}
                                  className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                                  style={{
                                    background: r.w === config.width ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                                    color: r.w === config.width ? '#fff' : 'var(--text-primary)',
                                  }}
                                >
                                  {r.l}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p
                              className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                              style={{ color: 'var(--text-dim)' }}
                            >
                              {t('bitrate')}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {[10000, 20000, 30000, 50000].map((b) => (
                                <button
                                  key={b}
                                  type="button"
                                  onClick={() => handleConfigUpdate({ bitrateKbps: b })}
                                  className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
                                  style={{
                                    background: b === config.bitrateKbps ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                                    color: b === config.bitrateKbps ? '#fff' : 'var(--text-primary)',
                                  }}
                                >
                                  {b >= 1000 ? `${(b / 1000).toFixed(0)}M` : `${b}K`}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        {/* Force Software Encoding */}
                        <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                                {t('forceSoftware')}
                              </span>
                              <span className="group relative inline-flex">
                                <span
                                  className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full text-[9px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                >
                                  ?
                                </span>
                                <span
                                  className="absolute left-1/2 z-20 mt-1 w-44 -translate-x-1/2 rounded-md border bg-[#1a1a2e] p-1.5 text-[9px] leading-tight opacity-0 shadow-lg transition-opacity group-hover:opacity-100 top-full"
                                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
                                >
                                  {t('forceSoftwareTooltip')}
                                </span>
                              </span>
                            </div>
                            <TogglePill
                              enabled={config.forceSoftware}
                              accent="amber"
                              onToggle={() => handleConfigUpdate({ forceSoftware: !config.forceSoftware })}
                            />
                          </div>
                        </div>

                        {/* RAM Estimate */}
                        {estimatedRamMB > 0 && (
                          <div>
                            <div className="mb-1 flex justify-between text-[10px]">
                              <span style={{ color: 'var(--text-dim)' }}>RAM {t('clips')}</span>
                              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                ~{estimatedRamMB} MB
                              </span>
                            </div>
                            <div
                              className="h-1.5 w-full overflow-hidden rounded-full"
                              style={{ background: 'rgba(113,113,122,0.12)' }}
                            >
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min((estimatedRamMB / 6000) * 100, 100)}%`,
                                  background:
                                    estimatedRamMB > 3000 ? '#ef4444' : estimatedRamMB > 1500 ? '#f59e0b' : '#3b82f6',
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Hotkeys */}
                        <CollapsibleMini label={t('hotkeys')} defaultOpen={false}>
                          <div className="space-y-1.5">
                            {config.hotkeys.map((hk) => (
                              <div
                                key={hk.id}
                                className="rounded-lg px-2 py-1.5"
                                style={{
                                  background: 'rgba(113,113,122,0.06)',
                                  opacity: hk.enabled ? 1 : 0.4,
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setRebindingId(hk.id)}
                                    disabled={!!rebindingId}
                                    className="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-all disabled:opacity-60"
                                    style={{
                                      borderColor: rebindingId === hk.id ? 'var(--accent)' : 'var(--border-medium)',
                                      color: rebindingId === hk.id ? 'var(--accent)' : 'var(--text-primary)',
                                    }}
                                  >
                                    {rebindingId === hk.id ? '...' : formatKey(hk.vk, hk.modifiers)}
                                  </button>
                                  <select
                                    value={hk.action}
                                    onChange={(e) =>
                                      updateHotkey(hk.id, { action: e.target.value as HotkeyBinding['action'] })
                                    }
                                    className="rounded-md border bg-transparent px-1 py-0.5 text-[10px] outline-none"
                                    style={{
                                      borderColor: 'var(--border-medium)',
                                      color: 'var(--text-primary)',
                                      colorScheme: 'dark',
                                    }}
                                  >
                                    <option value="saveClip">Replay</option>
                                    <option value="toggleCapture">Captura</option>
                                    <option value="toggleMic">Microfone</option>
                                    <option value="pushToTalk">PTT</option>
                                  </select>
                                  {hk.action === 'saveClip' && (
                                    <select
                                      value={hk.replayDurationSeconds || 60}
                                      onChange={(e) =>
                                        updateHotkey(hk.id, { replayDurationSeconds: Number(e.target.value) })
                                      }
                                      className="rounded-md border bg-transparent px-1 py-0.5 text-[10px] outline-none"
                                      style={{
                                        borderColor: 'var(--border-medium)',
                                        color: 'var(--text-primary)',
                                        colorScheme: 'dark',
                                      }}
                                    >
                                      {REPLAY_DURATIONS.map((d) => (
                                        <option key={d} value={d}>
                                          {d < 60 ? `${d}s` : `${d / 60}min`}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <div className="ml-auto flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => updateHotkey(hk.id, { enabled: !hk.enabled })}
                                      className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${
                                        hk.enabled ? 'bg-green-500/15 text-green-500' : 'bg-zinc-500/15 text-zinc-500'
                                      }`}
                                    >
                                      {hk.enabled ? 'ON' : 'OFF'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeHotkey(hk.id)}
                                      className="rounded p-0.5 transition-colors hover:bg-red-500/10"
                                    >
                                      <X className="h-2.5 w-2.5" style={{ color: '#ef4444' }} />
                                    </button>
                                  </div>
                                </div>
                                {/* Action description */}
                                <p
                                  className="mt-1 px-0.5 text-[9px] leading-tight"
                                  style={{ color: 'var(--text-dim)', opacity: 0.7 }}
                                >
                                  {hk.action === 'saveClip' && t('saveClipDesc')}
                                  {hk.action === 'toggleCapture' && t('toggleCaptureDesc')}
                                  {hk.action === 'toggleMic' && t('toggleMicDesc')}
                                  {hk.action === 'pushToTalk' && t('pushToTalkDesc')}
                                </p>
                              </div>
                            ))}
                            <div className="flex items-center justify-between pt-1">
                              <button
                                type="button"
                                onClick={addHotkey}
                                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all"
                                style={{ background: 'var(--accent)', color: '#fff' }}
                              >
                                <Plus className="h-3 w-3" />
                                {t('addHotkey')}
                              </button>
                              <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>
                                Buffer: {autoReplayTime < 60 ? `${autoReplayTime}s` : `${autoReplayTime / 60}min`} (
                                {t('autoBuffer')})
                              </span>
                            </div>
                          </div>
                        </CollapsibleMini>
                      </div>
                    ),
                  },
                  {
                    id: 'audio',
                    icon: Mic,
                    label: t('audio'),
                    defaultOpen: true,
                    content: (
                      <div className="space-y-3">
                        {/* Mic + Loopback side by side */}
                        <div className="grid grid-cols-2 gap-2">
                          <ToggleItem
                            label={t('micEnabled')}
                            enabled={config.micEnabled}
                            accent="green"
                            onToggle={() => handleConfigUpdate({ micEnabled: !config.micEnabled })}
                          />
                          <ToggleItem
                            label={t('audioLoopback')}
                            enabled={config.audioLoopback}
                            accent="green"
                            onToggle={() => handleConfigUpdate({ audioLoopback: !config.audioLoopback })}
                          />
                        </div>

                        {/* Push-to-Talk */}
                        <CollapsibleMini
                          label={
                            <span className="flex items-center gap-1.5">
                              {t('pushToTalk')}
                              <span className="group relative inline-flex">
                                <span
                                  className="inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full text-[8px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                >
                                  ?
                                </span>
                                <span
                                  className="absolute bottom-full left-1/2 z-20 mb-1 w-48 -translate-x-1/2 rounded-md border bg-[#1a1a2e] p-1.5 text-[9px] leading-tight opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
                                >
                                  {t('pushToTalkTooltip')}
                                </span>
                              </span>
                            </span>
                          }
                          defaultOpen={false}
                        >
                          <div className="space-y-2">
                            <div className="flex gap-1">
                              {(['off', 'hold', 'toggle'] as const).map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => handleConfigUpdate({ pushToTalk: mode })}
                                  className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
                                  style={{
                                    background: config.pushToTalk === mode ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                                    color: config.pushToTalk === mode ? '#fff' : 'var(--text-primary)',
                                  }}
                                >
                                  {t(`ptt${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                                </button>
                              ))}
                            </div>
                            {config.pushToTalk !== 'off' && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                                  {t('pttKey')}:
                                </span>
                                {config.pushToTalkKeys.map((vk, i) => (
                                  <span
                                    key={`${vk}-${i}`}
                                    className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium"
                                    style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
                                  >
                                    {VK_MAP[vk] || `0x${vk.toString(16)}`}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (config.pushToTalkKeys.length > 1) {
                                          handleConfigUpdate({
                                            pushToTalkKeys: config.pushToTalkKeys.filter((k) => k !== vk),
                                          })
                                        }
                                      }}
                                      className="rounded p-0.5 leading-none transition-colors hover:bg-white/10"
                                      style={{ color: 'var(--text-dim)', fontSize: '10px' }}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  disabled={!!rebindingId}
                                  onClick={() => setRebindingId('hk-ptt')}
                                  className="rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors hover:bg-white/5 disabled:opacity-60"
                                  style={{
                                    borderColor: rebindingId === 'hk-ptt' ? 'var(--accent)' : 'var(--border-medium)',
                                    color: rebindingId === 'hk-ptt' ? 'var(--accent)' : 'var(--text-dim)',
                                  }}
                                >
                                  {rebindingId === 'hk-ptt' ? '...' : '+ ' + t('pttKey')}
                                </button>
                              </div>
                            )}
                          </div>
                        </CollapsibleMini>

                        {/* Volume Sliders */}
                        <div className="space-y-2">
                          <VolumeSlider
                            label={t('gameVolume')}
                            value={config.gameVolume ?? 1}
                            onChange={(v) => handleConfigUpdate({ gameVolume: v })}
                          />
                          <VolumeSlider
                            label={t('micVolume')}
                            value={config.micVolume ?? 1}
                            onChange={(v) => handleConfigUpdate({ micVolume: v })}
                          />
                        </div>

                        {/* Per-App Audio */}
                        <CollapsibleMini label={t('appAudio')} defaultOpen={false}>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={refreshAudioSessions}
                                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10"
                                style={{ color: 'var(--text-dim)' }}
                              >
                                <RefreshCw className="h-3 w-3" />
                                {t('refreshAudioSessions')}
                              </button>
                              <button
                                type="button"
                                onClick={handleSelectAllAudioSessions}
                                className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
                                  audioSessions.length > 0 && !audioSessions.some((s) => s.isSelected)
                                    ? 'bg-blue-500/15 text-blue-500'
                                    : 'bg-zinc-500/15 text-zinc-500'
                                }`}
                              >
                                {t('selectAllApps')}
                              </button>
                            </div>
                            <div className="max-h-28 space-y-0.5 overflow-y-auto">
                              {audioSessions.length === 0 ? (
                                <p className="py-1 text-[10px]" style={{ color: 'var(--text-dim)', opacity: 0.6 }}>
                                  {t('noAudioSessions')}
                                </p>
                              ) : (
                                audioSessions.map((session) => (
                                  <button
                                    key={session.processId}
                                    type="button"
                                    onClick={() => handleToggleAudioSession(session.processId)}
                                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-[10px] transition-all ${
                                      session.isSelected ? 'bg-green-500/10' : 'hover:bg-white/5'
                                    }`}
                                    style={{ color: session.isSelected ? '#22c55e' : 'var(--text-primary)' }}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                        session.isSelected ? 'bg-green-500' : 'bg-zinc-500'
                                      }`}
                                    />
                                    <span className="truncate">{session.displayName || session.processName}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        </CollapsibleMini>

                        {/* Game Audio Only */}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                              {t('gameAudioOnly')}
                            </span>
                            {status.currentGame && config.gameAudioOnly && (
                              <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-500">
                                {status.currentGame}
                              </span>
                            )}
                          </div>
                          <TogglePill
                            enabled={config.gameAudioOnly}
                            accent="green"
                            onToggle={() => {
                              const newVal = !config.gameAudioOnly
                              handleConfigUpdate({
                                gameAudioOnly: newVal,
                                ...(newVal ? { micEnabled: true, audioLoopback: true } : {}),
                              })
                            }}
                          />
                        </div>

                        {/* Microphone Device Selector */}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                            {t('micDevice')}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {status.running ? (
                              loadingMicDevices ? (
                                <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                                  {t('loadingMicDevices')}
                                </span>
                              ) : micDevices.length === 0 ? (
                                <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                                  {t('noMicDevices')}
                                </span>
                              ) : (
                                <select
                                  value={config.micDeviceId || ''}
                                  onChange={(e) => handleConfigUpdate({ micDeviceId: e.target.value })}
                                  className="rounded-md border bg-transparent px-2 py-1 text-[10px] outline-none"
                                  style={{
                                    borderColor: 'var(--border-medium)',
                                    color: 'var(--text-primary)',
                                  }}
                                >
                                  <option value="">{t('defaultMic')}</option>
                                  {micDevices.map((d) => (
                                    <option key={d.id} value={d.id} style={{ color: '#000' }}>
                                      {d.name}
                                      {d.isDefault ? ` (${t('defaultMic')})` : ''}
                                    </option>
                                  ))}
                                </select>
                              )
                            ) : (
                              <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                                {t('startRecording')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    id: 'game',
                    icon: Gamepad2,
                    label: t('gameDetection'),
                    defaultOpen: true,
                    content: (
                      <div className="space-y-2.5">
                        {/* Game Detection toggle */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                            {t('gameDetection')}
                          </span>
                          <TogglePill
                            enabled={config.gameDetection}
                            onToggle={() => handleConfigUpdate({ gameDetection: !config.gameDetection })}
                          />
                        </div>
                        {/* Auto-start capture */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                              {t('autoStartCapture')}
                            </span>
                            <span className="text-[9px] opacity-50" style={{ color: 'var(--text-dim)' }}>
                              {t('autoStartCaptureDesc')}
                            </span>
                          </div>
                          <TogglePill
                            enabled={config.autoStartCapture ?? false}
                            onToggle={() => handleConfigUpdate({ autoStartCapture: !config.autoStartCapture })}
                          />
                        </div>
                        {/* Jogo detectado pelo engine */}
                        {status.running && status.currentGame && (
                          <div
                            className="flex items-center justify-between rounded-lg px-2 py-1.5"
                            style={{ background: 'rgba(34,197,94,0.08)' }}
                          >
                            <div className="flex items-center gap-1.5">
                              <Gamepad2 className="h-3 w-3" style={{ color: '#22c55e' }} />
                              <span className="text-xs font-medium" style={{ color: '#22c55e' }}>
                                {status.currentGame}
                              </span>
                            </div>
                          </div>
                        )}
                        {/* Custom Game */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                            {config.customGameProcess || (
                              <span style={{ color: 'var(--text-dim)' }}>{t('noGameDetected')}</span>
                            )}
                          </span>
                          <GamePickerBtn
                            config={config}
                            onClear={() => handleConfigUpdate({ customGameProcess: '' })}
                            onOpenPicker={async () => {
                              const list = await window.dinho?.clipsGetRunningProcesses()
                              if (list && list.length > 0) setProcesses(list)
                              setShowProcPicker(true)
                            }}
                          />
                        </div>
                      </div>
                    ),
                  },
                ].map((section) => (
                  <ConfigSection key={section.id} {...section} />
                ))}

                {/* ── Process Picker Modal ── */}
                {showProcPicker && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                    onClick={() => setShowProcPicker(false)}
                  >
                    <div
                      className="w-80 max-h-96 rounded-xl border p-4 shadow-xl"
                      style={{
                        background: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('selectProcess')}
                      </div>
                      <div className="relative mb-3">
                        <Search
                          className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2"
                          style={{ color: 'var(--text-dim)' }}
                        />
                        <input
                          type="text"
                          value={procSearch}
                          onChange={(e) => setProcSearch(e.target.value)}
                          className="w-full rounded-lg border bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none"
                          style={{
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)',
                          }}
                          placeholder={t('searchProcess')}
                          autoFocus
                        />
                      </div>
                      <div className="max-h-60 overflow-y-auto space-y-0.5">
                        {processes
                          .filter((p) => !procSearch || p.name.toLowerCase().includes(procSearch.toLowerCase()))
                          .slice(0, 100)
                          .map((p) => (
                            <button
                              key={p.pid}
                              type="button"
                              onClick={() => {
                                handleConfigUpdate({ customGameProcess: p.name })
                                setShowProcPicker(false)
                                setProcSearch('')
                              }}
                              className="w-full rounded px-2 py-1 text-left text-xs transition-all hover:bg-white/5"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              <span className="font-medium">{p.name}</span>
                              <span className="ml-2" style={{ color: 'var(--text-dim)' }}>
                                PID {p.pid}
                              </span>
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ── Helper Components ── */

function ConfigSection({
  icon: Icon,
  label,
  defaultOpen,
  content,
}: {
  icon: React.ElementType
  label: string
  defaultOpen: boolean
  content: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className="rounded-xl border overflow-hidden transition-all"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold transition-colors hover:bg-white/[0.03]"
        style={{ color: 'var(--text-primary)' }}
      >
        <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-dim)' }} />
        <span className="flex-1 text-left">{label}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--text-dim)' }} />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{content}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function VolumeSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[10px] shrink-0" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={200}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(113,113,122,0.2) ${pct}%)`,
          accentColor: 'var(--accent)',
        }}
      />
      <span className="w-8 text-right text-[10px] font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {pct}%
      </span>
    </div>
  )
}

function ToggleItem({
  label,
  enabled,
  accent,
  onToggle,
}: {
  label: string
  enabled: boolean
  accent: 'green' | 'amber' | 'blue'
  onToggle: () => void
}) {
  const colorMap = { green: '#22c55e', amber: '#f59e0b', blue: '#3b82f6' }
  const bgMap = { green: 'rgba(34,197,94,0.12)', amber: 'rgba(245,158,11,0.12)', blue: 'rgba(59,130,246,0.12)' }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[10px] font-medium transition-all hover:bg-white/[0.03]"
      style={{
        background: enabled ? bgMap[accent] : 'rgba(113,113,122,0.06)',
        color: enabled ? colorMap[accent] : 'var(--text-dim)',
      }}
    >
      <span>{label}</span>
      <span
        className="ml-2 rounded-full px-2 py-0.5 text-[8px] font-semibold"
        style={{ background: enabled ? `${colorMap[accent]}22` : 'rgba(113,113,122,0.15)' }}
      >
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

function TogglePill({
  enabled,
  accent = 'blue',
  onToggle,
}: {
  enabled: boolean
  accent?: 'green' | 'amber' | 'blue'
  onToggle: () => void
}) {
  const colorMap = { green: '#22c55e', amber: '#f59e0b', blue: '#3b82f6' }
  const c = colorMap[accent]
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all"
      style={{
        background: enabled ? `${c}22` : 'rgba(113,113,122,0.1)',
        color: enabled ? c : 'var(--text-dim)',
      }}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
  )
}

function CollapsibleMini({
  label,
  defaultOpen,
  children,
}: {
  label: React.ReactNode
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg" style={{ background: 'rgba(113,113,122,0.04)' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium transition-colors hover:bg-white/[0.02]"
        style={{ color: 'var(--text-dim)' }}
      >
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="h-3 w-3" />
        </motion.div>
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mini-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function GamePickerBtn({
  config,
  onClear,
  onOpenPicker,
}: {
  config: ClipsConfig
  onClear: () => void
  onOpenPicker: () => void
}) {
  const { t } = useTranslation('clips')
  if (config.customGameProcess) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPicker}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500/25"
        >
          {t('change')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium text-red-400 hover:text-red-300 transition-all hover:bg-red-500/10"
        >
          {t('clear')}
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpenPicker}
      className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500/25"
    >
      {t('choose')}
    </button>
  )
}
