import type { ClipInfo, ClipsConfig, ClipsEngineStatus, MicDeviceInfo } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FilterTab } from './clips-utils'
import { formatClipsDate, formatClipsSeconds, formatClipsSize, useClipsActions } from './useClipsActions'

export interface ClipsState {
  status: ClipsEngineStatus
  statusLoaded: boolean
  clipsLoaded: boolean
  config: ClipsConfig | null
  clips: ClipInfo[]
  loading: boolean
  starting: boolean
  rebindingId: string | null
  setRebindingId: (id: string | null) => void
  filterTab: FilterTab
  setFilterTab: (tab: FilterTab) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  thumbnails: Record<string, string>
  refreshing: boolean
  showProcPicker: boolean
  setShowProcPicker: (v: boolean) => void
  procSearch: string
  setProcSearch: (v: string) => void
  processes: Array<{ name: string; pid: number }>
  setProcesses: React.Dispatch<React.SetStateAction<Array<{ name: string; pid: number }>>>
  micDevices: MicDeviceInfo[]
  loadingMicDevices: boolean
  gpuList: Array<{ index: number; name: string; vendorId: number }>
  showConfig: boolean
  setShowConfig: (v: boolean) => void
  selectedClips: Set<string>
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>
  favorites: Set<string>
  activeTip: string | null
  setActiveTip: (tip: string | null) => void
  editingClip: ClipInfo | null
  setEditingClip: (clip: ClipInfo | null) => void
  mergeModePaths: string[] | null
  setMergeModePaths: (paths: string[] | null) => void
  filteredClips: ClipInfo[]
  autoReplayTime: number
  estimatedRamMB: number
  tooltipContent: Record<string, string>
  filterTabs: { key: FilterTab; label: string }[]
  refreshStatus: () => Promise<void>
  refreshConfig: () => Promise<void>
  refreshClips: () => Promise<void>
  handleStartRecording: () => Promise<void>
  handleStopRecording: () => Promise<void>
  handleSaveClip: () => Promise<void>
  handleDeleteClip: (name: string) => Promise<void>
  handleDeleteSelected: () => Promise<void>
  handleOpenClip: (path: string) => Promise<void>
  handleRenameClip: (oldName: string) => Promise<void>
  handleConfigUpdate: (partial: Partial<ClipsConfig>) => Promise<void>
  handleSelectOutputDir: () => Promise<void>
  toggleFavorite: (name: string) => void
  addHotkey: () => void
  removeHotkey: (id: string) => void
  updateHotkey: (id: string, patch: Partial<import('@shared/types').HotkeyBinding>) => void
  formatSize: (bytes: number) => string
  formatDate: (iso: string) => string
  formatSeconds: (s: number) => string
  t: (key: string) => string
}

export function useClipsState(): ClipsState {
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
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [clipsLoaded, setClipsLoaded] = useState(false)

  const tooltipContent: Record<string, string> = useMemo(
    () => ({
      quality:
        'Define a qualidade do vídeo. Maior qualidade = arquivos maiores. CQ controla a compressão (menor = melhor).',
      codec:
        'Codec de vídeo. Auto detecta o melhor disponível. H.264/HEVC/AV1 usam aceleração gráfica. Software usa CPU.',
      gpu: 'Placa de vídeo usada para gravar. Selecione caso tenha mais de uma GPU no sistema.',
      resolution: 'Tamanho do vídeo gravado. Maior resolução = mais qualidade e mais espaço em disco.',
      fps: 'Quadros por segundo. 60 FPS é ideal para jogos. 30 FPS economiza espaço. 120+ requer monitor de alta taxa.',
      replay: 'Quanto tempo de jogo é mantido em memória para salvar o clipe. Mais tempo usa mais RAM.',
      'force-software': t('forceSoftwareTooltip'),
      mic: 'Grava o áudio do microfone junto com o vídeo do jogo.',
      loopback: 'Grava o áudio do sistema (jogo, Discord, navegador) junto com o vídeo.',
      ptt: t('pushToTalkTooltip'),
      'sample-rate': 'Taxa de amostragem do áudio. 48kHz é o padrão para vídeos. 96kHz para áudio de alta qualidade.',
      'game-audio':
        'Grava apenas o áudio do jogo e do microfone, silenciando outros aplicativos (Discord, navegador, etc).',
      'noise-suppression':
        'Reduz ruído de fundo do microfone usando filtros de áudio integrados (anlmdn/arnndn). Útil para eliminar barulhos de teclado, ventoinha ou ambiente.',
      'adaptive-quality':
        'Ajusta automaticamente a qualidade da gravação conforme a RAM disponível. Reduz CQ, resolução e buffer em PCs com pouca memória para evitar travamentos. Desative para qualidade máxima sempre.',
    }),
    [t],
  )

  // Escape key closes active tooltip
  useEffect(() => {
    if (!activeTip) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveTip(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeTip])

  // Persist favorites to localStorage
  useEffect(() => {
    localStorage.setItem('clips-favorites', JSON.stringify([...favorites]))
  }, [favorites])

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
    try {
      const devices = await window.dinho?.clipsGetMicDevices()
      if (devices && devices.length > 0) {
        setMicDevices(devices)
      }
    } catch {
      /* ignore */
    }
    setLoadingMicDevices(false)
  }, [])

  // Load mic devices after status loaded
  useEffect(() => {
    if (!statusLoaded) return
    loadMicDevices()
  }, [statusLoaded, loadMicDevices])

  // Reload mic devices when engine starts
  useEffect(() => {
    if (status.running) loadMicDevices()
  }, [status.running, loadMicDevices])

  // Load GPU list once
  useEffect(() => {
    if (!statusLoaded || gpuList.length > 0) return
    ;(async () => {
      try {
        const gpus = await window.dinho?.clipsGetGpus()
        if (gpus && gpus.length > 0) setGpuList(gpus)
      } catch {
        /* ignore */
      }
    })()
  }, [statusLoaded, gpuList.length])

  const loadThumbnail = useCallback(async (clipName: string) => {
    try {
      const dataUrl = await window.dinho?.clipsGetThumbnail(clipName)
      if (dataUrl) setThumbnails((prev) => ({ ...prev, [clipName]: dataUrl }))
    } catch {
      /* ignore */
    }
  }, [])

  // Batch load thumbnails
  useEffect(() => {
    if (clips.length === 0) return
    const BATCH = 6
    let cancelled = false
    const loadBatch = async () => {
      for (let i = 0; i < clips.length; i += BATCH) {
        if (cancelled) break
        const batch = clips.slice(i, i + BATCH)
        await Promise.all(batch.map((c) => loadThumbnail(c.name)))
      }
    }
    const timer = setTimeout(loadBatch, 0)
    return () => {
      clearTimeout(timer)
      cancelled = true
    }
  }, [clips, loadThumbnail])

  // Initial data load — all three in one effect so clipsLoaded is set in same microtask batch
  useEffect(() => {
    ;(async () => {
      await Promise.all([refreshStatus(), refreshConfig()])
      setStatusLoaded(true)
      await refreshClips()
      setClipsLoaded(true)
    })()
  }, [refreshStatus, refreshConfig, refreshClips])

  // Poll status every 3s
  useEffect(() => {
    const timer = setInterval(refreshStatus, 3000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  // Subscribe to engine status events
  useEffect(() => {
    const unsub = window.dinho?.clipsOnEngineStatus?.((s) => setStatus(s))
    return () => unsub?.()
  }, [])

  // ── Actions (delegated to useClipsActions) ───────────────

  const actions = useClipsActions({
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
  })

  // Hotkey rebinding listeners (delegated to useClipsActions)
  useEffect(() => {
    return actions.setupRebindingListeners(rebindingId)
  }, [rebindingId, actions.setupRebindingListeners])

  // ── Derived state ─────────────────────────────────────────

  const filteredClips = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000

    return clips.filter((clip) => {
      const ct = new Date(clip.createdAt).getTime()
      if (ct <= 0) return true
      if (filterTab === 'today') {
        if (ct < startOfToday) return false
      }
      if (filterTab === 'week') {
        if (ct < startOfWeek) return false
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
  }, [config?.hotkeys, config])

  // Auto-increase buffer when a hotkey needs more than current
  useEffect(() => {
    if (!config || config.replayTimeSeconds >= autoReplayTime) return
    const timer = setTimeout(() => {
      actions.handleConfigUpdate({ replayTimeSeconds: autoReplayTime })
    }, 500)
    return () => clearTimeout(timer)
  }, [autoReplayTime, config, actions.handleConfigUpdate])

  // Expose save trigger for E2E tests
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__clipsSaveClip = actions.handleSaveClip
    return () => {
      delete (window as unknown as Record<string, unknown>).__clipsSaveClip
    }
  }, [actions.handleSaveClip])

  const estimatedRamMB = useMemo(() => {
    if (!config) return 0
    const rate = config.maxrateKbps || 50000
    return Math.round(((rate * (config.replayTimeSeconds || status.replayTimeSeconds)) / 8 / 1024) * 1.05)
  }, [config, status.replayTimeSeconds])

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'all' },
    { key: 'today', label: 'today' },
    { key: 'week', label: 'week' },
    { key: 'favorites', label: 'favorites' },
  ]

  return {
    status,
    statusLoaded,
    clipsLoaded,
    config,
    clips,
    loading,
    starting,
    rebindingId,
    setRebindingId,
    filterTab,
    setFilterTab,
    searchQuery,
    setSearchQuery,
    thumbnails,
    refreshing,
    showProcPicker,
    setShowProcPicker,
    procSearch,
    setProcSearch,
    processes,
    setProcesses,
    micDevices,
    loadingMicDevices,
    gpuList,
    showConfig,
    setShowConfig,
    selectedClips,
    setSelectedClips,
    favorites,
    activeTip,
    setActiveTip,
    editingClip,
    setEditingClip,
    mergeModePaths,
    setMergeModePaths,
    filteredClips,
    autoReplayTime,
    estimatedRamMB,
    tooltipContent,
    filterTabs,
    refreshStatus,
    refreshConfig,
    refreshClips,
    handleStartRecording: actions.handleStartRecording,
    handleStopRecording: actions.handleStopRecording,
    handleSaveClip: actions.handleSaveClip,
    handleDeleteClip: actions.handleDeleteClip,
    handleDeleteSelected: actions.handleDeleteSelected,
    handleOpenClip: actions.handleOpenClip,
    handleRenameClip: actions.handleRenameClip,
    handleConfigUpdate: actions.handleConfigUpdate,
    handleSelectOutputDir: actions.handleSelectOutputDir,
    toggleFavorite: actions.toggleFavorite,
    addHotkey: actions.addHotkey,
    removeHotkey: actions.removeHotkey,
    updateHotkey: actions.updateHotkey,
    formatSize: formatClipsSize,
    formatDate: formatClipsDate,
    formatSeconds: formatClipsSeconds,
    t,
  }
}
