import { PageHeader } from '@/components/layout/PageHeader'
import { ClipEditorModal } from '@/components/clips/ClipEditorModal'
import type {
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
  Combine,
  Cpu,
  Download,
  Film,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Loader2,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const InfoTip = ({ text }: { text: string }) => (
  <span
    title={text}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 14,
      height: 14,
      borderRadius: '50%',
      fontSize: 8,
      fontWeight: 700,
      cursor: 'help',
      marginLeft: 4,
      verticalAlign: 'middle',
      background: 'rgba(113,113,122,0.15)',
      color: 'var(--text-dim)',
    }}
  >
    ?
  </span>
)

const VK_MAP: Record<number, string> = {
  5: 'Mouse4',
  6: 'Mouse5',
  8: 'Backspace',
  9: 'Tab',
  12: 'Clear',
  13: 'Enter',
  19: 'Pause',
  20: 'CapsLock',
  27: 'Esc',
  32: 'Space',
  33: 'PageUp',
  34: 'PageDown',
  35: 'End',
  36: 'Home',
  37: '←',
  38: '↑',
  39: '→',
  40: '↓',
  44: 'PrintScreen',
  45: 'Insert',
  46: 'Delete',
  48: '0',
  49: '1',
  50: '2',
  51: '3',
  52: '4',
  53: '5',
  54: '6',
  55: '7',
  56: '8',
  57: '9',
  65: 'A',
  66: 'B',
  67: 'C',
  68: 'D',
  69: 'E',
  70: 'F',
  71: 'G',
  72: 'H',
  73: 'I',
  74: 'J',
  75: 'K',
  76: 'L',
  77: 'M',
  78: 'N',
  79: 'O',
  80: 'P',
  81: 'Q',
  82: 'R',
  83: 'S',
  84: 'T',
  85: 'U',
  86: 'V',
  87: 'W',
  88: 'X',
  89: 'Y',
  90: 'Z',
  91: 'Win',
  92: 'Win',
  93: 'Menu',
  96: 'Num0',
  97: 'Num1',
  98: 'Num2',
  99: 'Num3',
  100: 'Num4',
  101: 'Num5',
  102: 'Num6',
  103: 'Num7',
  104: 'Num8',
  105: 'Num9',
  106: 'Num*',
  107: 'Num+',
  109: 'Num-',
  110: 'Num.',
  111: 'Num/',
  112: 'F1',
  113: 'F2',
  114: 'F3',
  115: 'F4',
  116: 'F5',
  117: 'F6',
  118: 'F7',
  119: 'F8',
  120: 'F9',
  121: 'F10',
  122: 'F11',
  123: 'F12',
  124: 'F13',
  125: 'F14',
  126: 'F15',
  127: 'F16',
  128: 'F17',
  129: 'F18',
  130: 'F19',
  131: 'F20',
  132: 'F21',
  133: 'F22',
  134: 'F23',
  135: 'F24',
  144: 'NumLock',
  145: 'ScrollLock',
  160: 'LShift',
  161: 'RShift',
  162: 'LCtrl',
  163: 'RCtrl',
  164: 'LAlt',
  165: 'RAlt',
  186: ';',
  187: '=',
  188: ',',
  189: '-',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
  226: '\\',
}
const MODIFIER_KEYS = new Set([0x11, 0x10, 0x12]) // Ctrl, Shift, Alt
const MODIFIER_MAP: Record<number, 'Ctrl' | 'Shift' | 'Alt'> = { 17: 'Ctrl', 16: 'Shift', 18: 'Alt' }
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
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [showProcPicker, setShowProcPicker] = useState(false)
  const [procSearch, setProcSearch] = useState('')
  const [processes, setProcesses] = useState<Array<{ name: string; pid: number }>>([])
  const [micDevices, setMicDevices] = useState<MicDeviceInfo[]>([])
  const [loadingMicDevices, setLoadingMicDevices] = useState(false)
  const [gpuList, setGpuList] = useState<Array<{ index: number; name: string; vendorId: number }>>([])
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
  const [activeTip, setActiveTip] = useState<string | null>(null)
  const [editingClip, setEditingClip] = useState<ClipInfo | null>(null)
  const [mergeModePaths, setMergeModePaths] = useState<string[] | null>(null)

  const tooltipContent: Record<string, string> = useMemo(() => ({
    quality: 'Define a qualidade do vídeo. Maior qualidade = arquivos maiores. CQ controla a compressão (menor = melhor).',
    codec: 'Codec de vídeo. Auto detecta o melhor disponível. H.264/HEVC/AV1 usam aceleração gráfica. Software usa CPU.',
    gpu: 'Placa de vídeo usada para gravar. Selecione caso tenha mais de uma GPU no sistema.',
    resolution: 'Tamanho do vídeo gravado. Maior resolução = mais qualidade e mais espaço em disco.',
    fps: 'Quadros por segundo. 60 FPS é ideal para jogos. 30 FPS economiza espaço. 120+ requer monitor de alta taxa.',
    replay: 'Quanto tempo de jogo é mantido em memória para salvar o clipe. Mais tempo usa mais RAM.',
    'force-software': t('forceSoftwareTooltip'),
    mic: 'Grava o áudio do microfone junto com o vídeo do jogo.',
    loopback: 'Grava o áudio do sistema (jogo, Discord, navegador) junto com o vídeo.',
    ptt: t('pushToTalkTooltip'),
    'sample-rate': 'Taxa de amostragem do áudio. 48kHz é o padrão para vídeos. 96kHz para áudio de alta qualidade.',
    'game-audio': 'Grava apenas o áudio do jogo e do microfone, silenciando outros aplicativos (Discord, navegador, etc).',
    'noise-suppression': 'Reduz ruído de fundo do microfone usando filtros de áudio integrados (anlmdn/arnndn). Útil para eliminar barulhos de teclado, ventoinha ou ambiente.',
  }), [t])

  useEffect(() => {
    if (!activeTip) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveTip(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeTip])

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
    setLoadingMicDevices(false)
  }, [])

  useEffect(() => {
    if (status.running) loadMicDevices()
  }, [status.running, loadMicDevices])

  useEffect(() => {
    (async () => {
      try {
        const gpus = await window.dinho?.clipsGetGpus()
        if (gpus && gpus.length > 0) setGpuList(gpus)
      } catch { /* ignore */ }
    })()
  }, [status.running])

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

  useEffect(() => {
    const unsub = window.dinho?.clipsOnEngineStatus?.((s) => setStatus(s))
    return () => unsub?.()
  }, [])

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

  const toggleFavorite = (name: string) => {
    const isFavorite = favorites.has(name)
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    window.dinho?.clipsSetFavorite(name, !isFavorite).catch(() => {})
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

  const formatSeconds = (s: number): string => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
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
    const rate = config.maxrateKbps || 50000
    return Math.round(((rate * (config.replayTimeSeconds || status.replayTimeSeconds)) / 8 / 1024) * 1.05)
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
    <><div className="flex h-full flex-col p-6">
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
                  {status.uptime > 0 && (
                    <>
                      <span className="mx-1">·</span>
                      <span>{formatUptime(status.uptime)}</span>
                    </>
                  )}
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
              {status.running && (status.replayBufferBytes || estimatedRamMB > 0) && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
                >
                  <HardDrive className="h-3 w-3" />
                  <span>
                    {status.replayBufferBytes
                      ? `${Math.round(status.replayBufferBytes / 1024 / 1024)}MB`
                      : `~${estimatedRamMB}MB`}
                  </span>
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
              {status.diskSpaceOk === false && (
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
                >
                  <HardDrive className="h-3 w-3" />
                  <span>{t('diskSpaceLow')}</span>
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
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('saveClip')}
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
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('startRecording')}
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
                  <>
                  {selectedClips.size >= 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        const paths = filteredClips.filter((c) => selectedClips.has(c.name)).map((c) => c.path)
                        setMergeModePaths(paths)
                      }}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all hover:bg-blue-500/15"
                      style={{ color: '#3b82f6' }}
                    >
                      <Combine className="h-3 w-3" />
                      {t('merge')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all hover:bg-red-500/15"
                    style={{ color: '#ef4444' }}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('deleteSelected')}
                  </button>
                  </>
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
                           {formatSeconds(clip.duration)} · {formatDate(clip.createdAt)} · {formatSize(clip.size)}
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
                          onClick={() => setEditingClip(clip)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/10"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          <Film className="h-3 w-3" />
                          {t('edit')}
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
                    label: (
                      <span className="flex items-center gap-1">
                        {t('recordingQuality')}
                        <span className="relative inline-flex" data-tip="quality">
                          <span
                            className="inline-flex h-3 w-3 cursor-pointer items-center justify-center rounded-full text-[8px] font-bold"
                            style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                            onClick={() => setActiveTip(activeTip === 'quality' ? null : 'quality')}
                          >
                            ?
                          </span>
                        </span>
                      </span>
                    ),
                    defaultOpen: true,
                    content: (
                  <div className="space-y-3">
                    {/* ── Quick Preset ── */}
                    <div className="flex gap-1.5">
                      {[
                        {
                          id: 'muito-alta',
                          label: 'Muito Alta',
                          sub: 'CQ 16 · 1440p',
                          icon: '●●●',
                          config: {
                            cq: 16, maxrateKbps: 80000, bufsizeKbps: 160000,
                            encoderPreset: 'p5', bframes: 0, lookahead: 4,
                            bitrateKbps: 50000,
                            width: 2560, height: 1440,
                          },
                        },
                        {
                          id: 'alta',
                          label: 'Alta',
                          sub: 'CQ 18 · 1080p',
                          icon: '●●○',
                          config: {
                            cq: 18, maxrateKbps: 50000, bufsizeKbps: 100000,
                            encoderPreset: 'p4', bframes: 0, lookahead: 4,
                            bitrateKbps: 50000,
                            width: 1920, height: 1080,
                          },
                        },
                        {
                          id: 'boa',
                          label: 'Boa',
                          sub: 'CQ 20 · 720p',
                          icon: '●○○',
                          config: {
                            cq: 20, maxrateKbps: 30000, bufsizeKbps: 60000,
                            encoderPreset: 'p4', bframes: 0, lookahead: 2,
                            bitrateKbps: 30000,
                            width: 1280, height: 720,
                          },
                        },
                      ].map((p) => {
                        const active =
                          config.cq === p.config.cq &&
                          config.maxrateKbps === p.config.maxrateKbps
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleConfigUpdate(p.config)}
                                className={`group relative flex-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
                                  active
                                    ? 'border-transparent'
                                    : 'hover:border-white/10'
                                }`}
                                style={{
                                  background: active
                                    ? 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.1))'
                                    : 'rgba(113,113,122,0.06)',
                                  borderColor: active ? 'rgba(59,130,246,0.4)' : 'rgba(113,113,122,0.1)',
                                  boxShadow: active ? '0 0 12px rgba(59,130,246,0.15)' : 'none',
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span
                                    className="text-[11px] font-semibold"
                                    style={{
                                      color: active ? 'var(--accent)' : 'var(--text-primary)',
                                    }}
                                  >
                                    {p.label}
                                  </span>
                                  <span
                                    className="text-[9px] tracking-wider"
                                    style={{ color: active ? 'var(--accent)' : 'var(--text-dim)', opacity: 0.5 }}
                                  >
                                    {p.icon}
                                  </span>
                                </div>
                                <div
                                  className="mt-0.5 text-[9px]"
                                  style={{ color: active ? 'var(--accent)' : 'var(--text-dim)', opacity: 0.6 }}
                                >
                                  {p.sub}
                                </div>
                              </button>
                            )
                          })}
                        </div>

                        {/* Codec selector */}
                        <div>
                          <p
                            className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            Codec
                            <span className="relative inline-flex ml-1" data-tip="codec">
                              <span
                                className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                onClick={() => setActiveTip(activeTip === 'codec' ? null : 'codec')}
                              >
                                ?
                              </span>
                            </span>
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {[
                              { id: 'auto', label: 'Auto' },
                              { id: 'h264', label: 'H.264' },
                              { id: 'hevc', label: 'HEVC' },
                              { id: 'av1', label: 'AV1' },
                              { id: 'libx264', label: 'Software' },
                            ].map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handleConfigUpdate({ codec: c.id })}
                                className="rounded-lg py-1 px-2 text-[10px] font-medium transition-all"
                                style={{
                                  background: (config.codec ?? 'auto') === c.id
                                    ? 'var(--accent)'
                                    : 'rgba(113,113,122,0.08)',
                                  color: (config.codec ?? 'auto') === c.id ? '#fff' : 'var(--text-primary)',
                                }}
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* GPU selector */}
                        {gpuList.length > 0 && (
                          <div>
                            <p
                              className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                              style={{ color: 'var(--text-dim)' }}
                            >
                              GPU
                              <span className="relative inline-flex ml-1" data-tip="gpu">
                                <span
                                  className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                  onClick={() => setActiveTip(activeTip === 'gpu' ? null : 'gpu')}
                                >
                                  ?
                                </span>
                              </span>
                            </p>
                            <select
                              value={config.adapterIndex ?? -1}
                              onChange={(e) =>
                                handleConfigUpdate({ adapterIndex: Number(e.target.value) })
                              }
                              className="w-full rounded-lg px-2 py-1.5 text-[11px] transition-all"
                              style={{
                                background: 'rgba(113,113,122,0.08)',
                                color: 'var(--text-primary)',
                                border: '1px solid rgba(113,113,122,0.15)',
                              }}
                            >
                              <option value={-1}>Auto</option>
                              {gpuList.map((gpu) => (
                                <option key={gpu.index} value={gpu.index}>
                                  {gpu.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Resolution + FPS side by side */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p
                              className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                              style={{ color: 'var(--text-dim)' }}
                            >
                              {t('resolution')}
                              <span className="relative inline-flex ml-1" data-tip="resolution">
                                <span
                                  className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                  onClick={() => setActiveTip(activeTip === 'resolution' ? null : 'resolution')}
                                >
                                  ?
                                </span>
                              </span>
                            </p>
                            <div className="flex gap-1">
                              {[
                                { w: 640, h: 360, l: '360p' },
                                { w: 1280, h: 720, l: '720p' },
                                { w: 1920, h: 1080, l: '1080p' },
                                { w: 2560, h: 1440, l: '1440p' },
                              ].map((r) => (
                                <button
                                  key={r.l}
                                  type="button"
                                  onClick={() => handleConfigUpdate({ width: r.w, height: r.h })}
                                  className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                                  style={{
                                    background: r.w === config.width
                                      ? 'var(--accent)'
                                      : 'rgba(113,113,122,0.08)',
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
                              FPS
                              <span className="relative inline-flex ml-1" data-tip="fps">
                                <span
                                  className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                  onClick={() => setActiveTip(activeTip === 'fps' ? null : 'fps')}
                                >
                                  ?
                                </span>
                              </span>
                            </p>
                            <div className="flex gap-1">
                              {[30, 60, 75, 120, 144].map((f) => (
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
                        </div>

                        {/* Replay Time */}
                        <div>
                          <p
                            className="mb-1 text-[10px] font-medium tracking-wide uppercase"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            {t('replayTime')}
                            <span className="relative inline-flex ml-1" data-tip="replay">
                              <span
                                className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                onClick={() => setActiveTip(activeTip === 'replay' ? null : 'replay')}
                              >
                                ?
                              </span>
                            </span>
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

                        {/* Force Software Encoding */}
                        <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                                {t('forceSoftware')}
                              </span>
                              <span className="relative inline-flex" data-tip="force-software">
                                <span
                                  className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                  onClick={() => setActiveTip(activeTip === 'force-software' ? null : 'force-software')}
                                >
                                  ?
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

                        {/* Buffer Usage */}
                        {estimatedRamMB > 0 && (
                          <div>
                            <div className="mb-1 flex justify-between text-[10px]">
                              <span style={{ color: 'var(--text-dim)' }}>RAM {t('clips')}</span>
                              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {status.replayBufferBytes
                                  ? `${Math.round(status.replayBufferBytes / 1024 / 1024)} MB`
                                  : `~${estimatedRamMB} MB`}
                              </span>
                            </div>
                            <div
                              className="h-1.5 w-full overflow-hidden rounded-full"
                              style={{ background: 'rgba(113,113,122,0.12)' }}
                            >
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${
                                    status.replayBufferBytes
                                      ? Math.min((status.replayBufferBytes / 1024 / 1024 / estimatedRamMB) * 100, 100)
                                      : 0
                                  }%`,
                                  background:
                                    estimatedRamMB > 3000 ? '#ef4444' : estimatedRamMB > 1500 ? '#f59e0b' : '#3b82f6',
                                }}
                              />
                            </div>
                          </div>
                        )}

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
                            label={
                              <span className="flex items-center gap-1">
                                {t('micEnabled')}
                                <span className="relative inline-flex" data-tip="mic">
                                  <span
                                    className="inline-flex h-3 w-3 cursor-pointer items-center justify-center rounded-full text-[8px] font-bold"
                                    style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                    onClick={() => setActiveTip(activeTip === 'mic' ? null : 'mic')}
                                  >
                                    ?
                                  </span>
                                </span>
                              </span>
                            }
                            enabled={config.micEnabled}
                            accent="green"
                            onToggle={() => handleConfigUpdate({ micEnabled: !config.micEnabled })}
                          />
                          <ToggleItem
                            label={
                              <span className="flex items-center gap-1">
                                {t('audioLoopback')}
                                <span className="relative inline-flex" data-tip="loopback">
                                  <span
                                    className="inline-flex h-3 w-3 cursor-pointer items-center justify-center rounded-full text-[8px] font-bold"
                                    style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                    onClick={() => setActiveTip(activeTip === 'loopback' ? null : 'loopback')}
                                  >
                                    ?
                                  </span>
                                </span>
                              </span>
                            }
                            enabled={config.audioLoopback}
                            accent="green"
                            onToggle={() => {
                              const newVal = !config.audioLoopback
                              handleConfigUpdate({
                                audioLoopback: newVal,
                                ...(newVal ? { gameAudioOnly: false } : {}),
                              })
                            }}
                          />
                        </div>

                        {/* Noise Suppression */}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                              {t('noiseSuppression')}
                            </span>
                            <span className="relative inline-flex" data-tip="noise-suppression">
                              <span
                                className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                onClick={() => setActiveTip(activeTip === 'noise-suppression' ? null : 'noise-suppression')}
                              >
                                ?
                              </span>
                            </span>
                          </div>
                          <TogglePill
                            enabled={config.noiseSuppression ?? false}
                            accent="green"
                            onToggle={() => handleConfigUpdate({ noiseSuppression: !(config.noiseSuppression ?? false) })}
                          />
                        </div>

                        {/* Push-to-Talk */}
                        <CollapsibleMini
                          label={
                            <span className="flex items-center gap-1.5">
                              {t('pushToTalk')}
                              <span className="relative inline-flex" data-tip="ptt">
                                <span
                                  className="inline-flex h-3 w-3 cursor-pointer items-center justify-center rounded-full text-[8px] font-bold"
                                  style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                  onClick={() => setActiveTip(activeTip === 'ptt' ? null : 'ptt')}
                                >
                                  ?
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
                                  {rebindingId === 'hk-ptt' ? '...' : `+ ${t('pttKey')}`}
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

                        {/* Sample Rate */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
                            {t('audioSampleRate')}
                            <span className="relative inline-flex ml-1" data-tip="sample-rate">
                              <span
                                className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
                                style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                onClick={() => setActiveTip(activeTip === 'sample-rate' ? null : 'sample-rate')}
                              >
                                ?
                              </span>
                              </span>
                          </span>
                          <div className="flex gap-1">
                            {[44100, 48000, 96000].map((rate) => (
                              <button
                                key={rate}
                                type="button"
                                onClick={() => handleConfigUpdate({ audioSampleRate: rate })}
                                className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
                                style={{
                                  background:
                                    (config.audioSampleRate ?? 48000) === rate
                                      ? 'var(--accent)'
                                      : 'rgba(113,113,122,0.08)',
                                  color: (config.audioSampleRate ?? 48000) === rate ? '#fff' : 'var(--text-primary)',
                                }}
                              >
                                {rate / 1000}kHz
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Game Audio Only */}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                              {t('gameAudioOnly')}
                            </span>
                            <span className="relative inline-flex" data-tip="game-audio">
                              <span
                                className="inline-flex h-3 w-3 cursor-pointer items-center justify-center rounded-full text-[8px] font-bold"
                                style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
                                onClick={() => setActiveTip(activeTip === 'game-audio' ? null : 'game-audio')}
                              >
                                ?
                              </span>
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
                                ...(newVal ? { micEnabled: true, audioLoopback: false } : {}),
                              })
                            }}
                          />
                        </div>

                        {/* AutoCleanup */}
                        <div className="space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              {t('autoCleanup')}
                            </span>
                            <TogglePill
                              enabled={config.autoCleanupEnabled ?? true}
                              accent="cyan"
                              onToggle={() =>
                                handleConfigUpdate({
                                  autoCleanupEnabled: !(config.autoCleanupEnabled ?? true),
                                })
                              }
                            />
                          </div>
                          {(config.autoCleanupEnabled ?? true) && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-dim)' }}>
                                {t('autoCleanupThreshold')}
                              </span>
                              <input
                                type="range"
                                min={50}
                                max={99}
                                value={config.autoCleanupThresholdPercent ?? 90}
                                onChange={(e) =>
                                  handleConfigUpdate({
                                    autoCleanupThresholdPercent: Number.parseInt(e.target.value, 10),
                                  })
                                }
                                className="flex-1 h-1 rounded-full accent-cyan-500"
                                style={{ accentColor: '#06b6d4' }}
                              />
                              <span className="text-[10px] font-mono min-w-[2rem] text-right" style={{ color: 'var(--text-dim)' }}>
                                {config.autoCleanupThresholdPercent ?? 90}%
                              </span>
                            </div>
                          )}
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
                        background: 'var(--card-bg)',
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

      {/* ── Centered Tooltip Overlay ── */}
      {activeTip && tooltipContent[activeTip] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setActiveTip(null)}>
          <div
            className="max-w-xs rounded-xl border bg-[#1a1a2e] p-5 text-sm leading-relaxed shadow-2xl"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {tooltipContent[activeTip]}
          </div>
        </div>
      )}

      {mergeModePaths && (
        <ClipEditorModal
          initialMergePaths={mergeModePaths}
          onClose={() => setMergeModePaths(null)}
          onSave={() => {
            setMergeModePaths(null)
            refreshClips()
          }}
        />
      )}
      {editingClip && !mergeModePaths && (
        <ClipEditorModal
          clip={editingClip}
          onClose={() => setEditingClip(null)}
          onSave={() => {
            setEditingClip(null)
            refreshClips()
          }}
        />
      )}
    </>
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
  label: React.ReactNode
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
  label: React.ReactNode
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
