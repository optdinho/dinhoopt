import type { ClipInfo, ClipsConfig, ClipsEngineStatus, MicDeviceInfo } from '@shared/types'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import logger from '@/lib/renderer-logger'
import { useClipsStateStore } from '@/stores/clips-state-store'
import { QUALITY_PRESETS, type QualityPresetKey } from './clips-quality-presets'
import type { FilterTab } from './clips-utils'
import { formatClipsDate, formatClipsSeconds, formatClipsSize, useClipsActions } from './useClipsActions'

const DEFAULT_THUMB_RETRY_MS = 30_000
let thumbRetryMs = DEFAULT_THUMB_RETRY_MS

export function setThumbRetryMsForTest(ms: number): void {
  thumbRetryMs = ms
}

export interface ClipsState {
  status: ClipsEngineStatus
  statusLoaded: boolean
  clipsLoaded: boolean
  config: ClipsConfig | null
  clips: ClipInfo[]
  loading: boolean
  starting: boolean
  stopping: boolean
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
  editingClipFullscreen: boolean
  openClipEditor: (clip: ClipInfo) => void
  openClipPlayer: (clip: ClipInfo) => void
  renameTarget: string | null
  setRenameTarget: (name: string | null) => void
  /** F2 — clipe com exclusão pendente de confirmação (dialog na página). */
  deleteTarget: string | null
  setDeleteTarget: (name: string | null) => void
  /** F2 — exclusão em massa pendente de confirmação (dialog na página). */
  deleteAllPending: boolean
  setDeleteAllPending: (v: boolean) => void
  mergeModePaths: string[] | null
  setMergeModePaths: (paths: string[] | null) => void
  filteredClips: ClipInfo[]
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
  handleRenameClip: (oldName: string, newName: string) => Promise<void>
  handlePublishClip: (clipName: string, clipPath: string) => Promise<void>
  handleCancelPublish: (clipPath: string) => Promise<void>
  publishingPath: string | null
  publishProgress: number
  publishResult: { link: string } | null
  setPublishResult: (r: { link: string } | null) => void
  publishedLinks: Record<string, string>
  setPublishedLink: (path: string, link: string) => void
  handleConfigUpdate: (partial: Partial<ClipsConfig>) => Promise<void>
  handleSelectOutputDir: () => Promise<void>
  toggleFavorite: (name: string) => void
  addHotkey: () => void
  removeHotkey: (id: string) => void
  updateHotkey: (id: string, patch: Partial<import('@shared/types').HotkeyBinding>) => void
  formatSize: (bytes: number) => string
  formatDate: (iso: string) => string
  formatSeconds: (s: number) => string
  QUALITY_PRESETS: Record<QualityPresetKey, Partial<ClipsConfig>>
  t: TFunction<'clips'>
}

export function useClipsState(): ClipsState {
  const { t } = useTranslation('clips')

  // ── Shared application state (Zustand) ───────────────────
  // Atomic selectors keep re-renders scoped: the page only re-renders for the
  // slices it actually reads, not for the whole store object.
  const status = useClipsStateStore((s) => s.status)
  const config = useClipsStateStore((s) => s.config)
  const clips = useClipsStateStore((s) => s.clips)
  const loading = useClipsStateStore((s) => s.loading)
  const starting = useClipsStateStore((s) => s.starting)
  const stopping = useClipsStateStore((s) => s.stopping)
  const rebindingId = useClipsStateStore((s) => s.rebindingId)
  const setRebindingId = useClipsStateStore((s) => s.setRebindingId)
  const filterTab = useClipsStateStore((s) => s.filterTab)
  const setFilterTab = useClipsStateStore((s) => s.setFilterTab)
  const searchQuery = useClipsStateStore((s) => s.searchQuery)
  const setSearchQuery = useClipsStateStore((s) => s.setSearchQuery)
  const thumbnails = useClipsStateStore((s) => s.thumbnails)
  const setThumbnails = useClipsStateStore((s) => s.setThumbnails)
  const refreshing = useClipsStateStore((s) => s.refreshing)
  const setRefreshing = useClipsStateStore((s) => s.setRefreshing)
  const selectedClips = useClipsStateStore((s) => s.selectedClips)
  const setSelectedClips = useClipsStateStore((s) => s.setSelectedClips)
  const favorites = useClipsStateStore((s) => s.favorites)
  const setFavorites = useClipsStateStore((s) => s.setFavorites)
  const statusLoaded = useClipsStateStore((s) => s.statusLoaded)
  const clipsLoaded = useClipsStateStore((s) => s.clipsLoaded)
  const publishingPath = useClipsStateStore((s) => s.publishingPath)
  const publishProgress = useClipsStateStore((s) => s.publishProgress)
  const publishResult = useClipsStateStore((s) => s.publishResult)
  const setPublishResult = useClipsStateStore((s) => s.setPublishResult)
  const publishedLinks = useClipsStateStore((s) => s.publishedLinks)
  const setPublishedLinkStore = useClipsStateStore((s) => s.setPublishedLink)

  const setStatus = useClipsStateStore((s) => s.setStatus)
  const setStatusLoaded = useClipsStateStore((s) => s.setStatusLoaded)
  const setClipsLoaded = useClipsStateStore((s) => s.setClipsLoaded)
  const setConfig = useClipsStateStore((s) => s.setConfig)
  const setClips = useClipsStateStore((s) => s.setClips)
  const setLoading = useClipsStateStore((s) => s.setLoading)
  const setStarting = useClipsStateStore((s) => s.setStarting)
  const setStopping = useClipsStateStore((s) => s.setStopping)
  const setPublishingPath = useClipsStateStore((s) => s.setPublishingPath)
  const setPublishProgress = useClipsStateStore((s) => s.setPublishProgress)
  const setPublishedLink = useCallback(
    (path: string, link: string) => setPublishedLinkStore(path, link),
    [setPublishedLinkStore],
  )

  // ── Ephemeral UI state (local to the clips page tree) ────
  const [showProcPicker, setShowProcPicker] = useState(false)
  const [procSearch, setProcSearch] = useState('')
  const [processes, setProcesses] = useState<Array<{ name: string; pid: number }>>([])
  const [micDevices, setMicDevices] = useState<MicDeviceInfo[]>([])
  const [loadingMicDevices, setLoadingMicDevices] = useState(false)
  const [gpuList, setGpuList] = useState<Array<{ index: number; name: string; vendorId: number }>>([])
  const [showConfig, setShowConfig] = useState(false)
  const [activeTip, setActiveTip] = useState<string | null>(null)
  const [editingClip, setEditingClip] = useState<ClipInfo | null>(null)
  const [editingClipFullscreen, setEditingClipFullscreen] = useState(false)

  const openClipEditor = useCallback((clip: ClipInfo) => {
    setEditingClipFullscreen(false)
    setEditingClip(clip)
  }, [])

  const openClipPlayer = useCallback((clip: ClipInfo) => {
    setEditingClipFullscreen(true)
    setEditingClip(clip)
  }, [])
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  // F2 — o `confirm()` nativo foi substituído pelos `ConfirmDialog` da app
  // (renderizados pela página). O estado de pendente vive aqui, ao lado do
  // `renameTarget`, para que a página e a grelha partilhem o mesmo fluxo.
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteAllPending, setDeleteAllPending] = useState(false)
  const [mergeModePaths, setMergeModePaths] = useState<string[] | null>(null)

  const tooltipContent: Record<string, string> = useMemo(
    () => ({
      quality: t('tooltipQuality'),
      gpu: t('tooltipGpu'),
      resolution: t('tooltipResolution'),
      fps: t('tooltipFps'),
      replay: t('tooltipReplay'),
      'stretch-to-fit': t('stretchToFitTooltip'),
      'replay-buffer-mode': t('replayBufferModeTooltip'),
      mic: t('tooltipMic'),
      loopback: t('tooltipLoopback'),
      ptt: t('pushToTalkTooltip'),
      'sample-rate': t('tooltipSampleRate'),
      'game-audio': t('tooltipGameAudio'),
      'noise-suppression': t('tooltipNoiseSuppression'),
      'audio-sessions': t('audioSessionsTooltip'),
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

  // Persist published links to localStorage
  useEffect(() => {
    localStorage.setItem('clips-published', JSON.stringify(publishedLinks))
  }, [publishedLinks])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.dinho?.clipsGetStatus()
      if (s) setStatus(s)
    } catch (err) {
      logger.warn('clips', `Failed to refresh engine status (${String(err)})`)
    }
  }, [setStatus])

  const refreshConfig = useCallback(async () => {
    try {
      const c = await window.dinho?.clipsGetConfig()
      if (c) setConfig(c)
    } catch (err) {
      logger.warn('clips', `Failed to refresh clips config (${String(err)})`)
    }
  }, [setConfig])

  const refreshClips = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await window.dinho?.clipsList()
      if (list) {
        setClips(list)
        setThumbnails({})
      }
    } catch (err) {
      logger.error('clips', 'Failed to refresh clip list', err)
    }
    setRefreshing(false)
  }, [setClips, setRefreshing, setThumbnails])

  const loadMicDevices = useCallback(async () => {
    setLoadingMicDevices(true)
    try {
      const devices = await window.dinho?.clipsGetMicDevices()
      if (devices && devices.length > 0) {
        setMicDevices(devices)
      }
    } catch (err) {
      logger.warn('clips', `Failed to load microphone devices (${String(err)})`)
    }
    setLoadingMicDevices(false)
  }, [])

  // Load mic devices once the status is known, and again when the engine starts.
  // A single effect (not one per trigger) avoids a double request when the very
  // first status already reports the engine as running.
  const micLoadedRef = useRef(false)
  const prevMicRunningRef = useRef(status.running)
  useEffect(() => {
    const wasRunning = prevMicRunningRef.current
    prevMicRunningRef.current = status.running
    if (!statusLoaded) return
    const engineStarted = status.running && !wasRunning
    if (!micLoadedRef.current || engineStarted) {
      micLoadedRef.current = true
      loadMicDevices()
    }
  }, [statusLoaded, status.running, loadMicDevices])

  // Refresh clips when engine starts running (output directory may have changed)
  const prevRunning = useRef(status.running)
  const lastRamLevelRef = useRef<string | undefined>('normal')
  const failedThumbsRef = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    if (status.running && !prevRunning.current) {
      refreshClips()
    }
    prevRunning.current = status.running
  }, [status.running, refreshClips])

  // Load GPU list once
  useEffect(() => {
    if (!statusLoaded || gpuList.length > 0) return
    ;(async () => {
      try {
        const gpus = await window.dinho?.clipsGetGpus()
        if (gpus && gpus.length > 0) setGpuList(gpus)
      } catch (err) {
        logger.warn('clips', `Failed to load GPU list (${String(err)})`)
      }
    })()
  }, [statusLoaded, gpuList.length])

  const loadThumbnail = useCallback(
    async (clipName: string) => {
      const failedAt = failedThumbsRef.current.get(clipName)
      if (failedAt !== undefined && Date.now() - failedAt < thumbRetryMs) return
      try {
        const dataUrl = await window.dinho?.clipsGetThumbnail(clipName)
        if (dataUrl) {
          failedThumbsRef.current.delete(clipName)
          setThumbnails((prev) => ({ ...prev, [clipName]: dataUrl }))
        } else {
          failedThumbsRef.current.set(clipName, Date.now())
        }
      } catch (err) {
        failedThumbsRef.current.set(clipName, Date.now())
        logger.warn('clips', `Thumbnail load for "${clipName}" failed — retry scheduled (${String(err)})`)
      }
    },
    [setThumbnails],
  )

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
  // Detector lifecycle is owned by the main process (started at boot); this
  // effect only loads initial data.
  // Deps are store actions (stable across renders) — the exhaustive-deps rule
  // cannot know that, so they are listed to satisfy it explicitly.
  useEffect(() => {
    ;(async () => {
      await Promise.all([refreshStatus(), refreshConfig()])
      setStatusLoaded(true)
      await refreshClips()
      setClipsLoaded(true)
    })()
  }, [refreshStatus, refreshConfig, refreshClips, setStatusLoaded, setClipsLoaded])

  // Poll status every 3s
  useEffect(() => {
    const timer = setInterval(refreshStatus, 3000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  // Subscribe to engine status events
  useEffect(() => {
    const unsub = window.dinho?.clipsOnEngineStatus?.((s) => setStatus(s))
    return () => unsub?.()
  }, [setStatus])

  // Listen for clip saved events (from hotkey saves in the engine)
  useEffect(() => {
    const unsub = window.dinho?.clipsOnClipSaved?.(() => {
      toast.success(t('clipSaved'))
      refreshClips()
    })
    return () => unsub?.()
  }, [refreshClips, t])

  // Listen for screenshot events (from the printscreen hotkey in the engine)
  useEffect(() => {
    const unsub = window.dinho?.clipsOnScreenshot?.((data) => {
      if (data.success) {
        toast.success(t('screenshotSaved'))
      } else {
        toast.error(t('screenshotFailed'))
      }
    })
    return () => unsub?.()
  }, [t])

  // Listen for RAM pressure broadcasts (RamManager watchdog)
  useEffect(() => {
    // Watchdog broadcasts every ~5s while pressure persists — toast only on
    // level transitions (critical↔normal) to avoid spam.
    const unsub = window.dinho?.clipsOnRamPressure?.((data) => {
      const level = data.level ?? 'normal'
      if (level === lastRamLevelRef.current) return
      lastRamLevelRef.current = level
      if (level === 'critical') {
        toast.warning(t('ramPressureCritical'), {
          description: t('ramPressureCriticalDesc', { pct: Math.round((data.usedPercent ?? 0) * 100) }),
        })
      } else if (level === 'normal') {
        toast.success(t('ramPressureNormal'))
      }
    })
    return () => unsub?.()
  }, [t])

  // Listen for durations-ready event (background duration computation finished)
  useEffect(() => {
    const unsub = window.dinho?.clipsOnDurationsReady?.(() => {
      refreshClips()
    })
    return () => unsub?.()
  }, [refreshClips])

  // Listen for publish progress broadcasts (main forwards per-file progress)
  const publishingPathRef = useRef<string | null>(null)
  publishingPathRef.current = publishingPath
  useEffect(() => {
    const unsub = window.dinho?.clipsOnPublishProgress?.((data) => {
      if (data.clipPath === publishingPathRef.current) {
        setPublishProgress(data.percent ?? 0)
      }
    })
    return () => unsub?.()
  }, [setPublishProgress])

  // ── Actions (delegated to useClipsActions) ───────────────

  const actions = useClipsActions({
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
    // C1 — o toast de sucesso do save oferece "Abrir clipe" com o caminho
    // do clipe mais recente (salvo por nome decrescente pela data de criacao).
    getLatestClip: () => {
      const list = [...clips].sort((a, b) => {
        const ta = new Date(a.createdAt).getTime()
        const tb = new Date(b.createdAt).getTime()
        if (tb !== ta) return tb - ta
        return b.name.localeCompare(a.name)
      })
      const newest = list[0]
      return newest ? { name: newest.name, path: newest.path } : undefined
    },
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
    stopping,
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
    editingClipFullscreen,
    openClipEditor,
    openClipPlayer,
    renameTarget,
    setRenameTarget,
    deleteTarget,
    setDeleteTarget,
    deleteAllPending,
    setDeleteAllPending,
    mergeModePaths,
    setMergeModePaths,
    filteredClips,
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
    handlePublishClip: actions.handlePublishClip,
    handleCancelPublish: actions.handleCancelPublish,
    publishingPath,
    publishProgress,
    publishResult,
    setPublishResult,
    publishedLinks,
    setPublishedLink,
    handleConfigUpdate: actions.handleConfigUpdate,
    handleSelectOutputDir: actions.handleSelectOutputDir,
    toggleFavorite: actions.toggleFavorite,
    addHotkey: actions.addHotkey,
    removeHotkey: actions.removeHotkey,
    updateHotkey: actions.updateHotkey,
    formatSize: (bytes: number) => formatClipsSize(bytes, t),
    formatDate: formatClipsDate,
    formatSeconds: formatClipsSeconds,
    QUALITY_PRESETS,
    t,
  }
}
