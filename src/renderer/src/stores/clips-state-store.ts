import type { ClipInfo, ClipsConfig, ClipsEngineStatus } from '@shared/types'
import { create } from 'zustand'
import type { FilterTab } from '@/components/clips/clips-utils'
import logger from '@/lib/renderer-logger'

/**
 * Shared, cross-consumer Clips application state.
 *
 * Only state that is genuinely application state (engine status, config, the clip
 * list, load/operation flags, filters, favorites, selections, thumbnails and the
 * publish pipeline) lives here — it is read by several sibling components through
 * `useClipsState()` and benefits from a single source of truth.
 *
 * Purely ephemeral UI state (which modal/tooltip/picker is open, the process
 * list, the in-flight editor target, …) intentionally stays as `useState` inside
 * the hook: it is owned by a single render tree, has no cross-consumer meaning and
 * moving it would add risk without any sharing benefit.
 */
export interface ClipsStateStoreState {
  status: ClipsEngineStatus
  statusLoaded: boolean
  clipsLoaded: boolean
  config: ClipsConfig | null
  clips: ClipInfo[]
  loading: boolean
  starting: boolean
  stopping: boolean
  rebindingId: string | null
  filterTab: FilterTab
  searchQuery: string
  thumbnails: Record<string, string>
  refreshing: boolean
  selectedClips: Set<string>
  favorites: Set<string>
  publishingPath: string | null
  publishProgress: number
  publishResult: { link: string } | null
  publishedLinks: Record<string, string>

  setStatus: (status: ClipsEngineStatus) => void
  setStatusLoaded: (loaded: boolean) => void
  setClipsLoaded: (loaded: boolean) => void
  setConfig: React.Dispatch<React.SetStateAction<ClipsConfig | null>>
  setClips: (clips: ClipInfo[]) => void
  setThumbnails: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setLoading: (loading: boolean) => void
  setStarting: (starting: boolean) => void
  setStopping: (stopping: boolean) => void
  setRefreshing: (refreshing: boolean) => void
  setRebindingId: (id: string | null) => void
  setFilterTab: (tab: FilterTab) => void
  setSearchQuery: (query: string) => void
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>
  setFavorites: React.Dispatch<React.SetStateAction<Set<string>>>
  setPublishingPath: (path: string | null) => void
  setPublishProgress: (pct: number) => void
  setPublishResult: (result: { link: string } | null) => void
  setPublishedLink: (path: string, link: string) => void
  /** Restore the initial (post-localStorage) baseline. Used by tests. */
  reset: () => void
}

export const defaultClipsEngineStatus: ClipsEngineStatus = {
  running: false,
  capturing: false,
  uptime: 0,
  fps: 60,
  replayTimeSeconds: 120,
}

/** Read persisted favorites from localStorage, falling back to an empty set. */
export function readPersistedFavorites(): Set<string> {
  try {
    const saved = localStorage.getItem('clips-favorites')
    return saved ? new Set(JSON.parse(saved)) : new Set()
  } catch (err) {
    logger.error('clips', 'Failed to load persisted favorites from localStorage — starting empty', err)
    return new Set()
  }
}

/** Read persisted published links from localStorage, falling back to an empty map. */
export function readPersistedPublishedLinks(): Record<string, string> {
  try {
    const saved = localStorage.getItem('clips-published')
    return saved ? (JSON.parse(saved) as Record<string, string>) : {}
  } catch (err) {
    logger.warn('clips', `Failed to load persisted published links — starting empty (${String(err)})`)
    return {}
  }
}

export const useClipsStateStore = create<ClipsStateStoreState>((set) => ({
  status: defaultClipsEngineStatus,
  statusLoaded: false,
  clipsLoaded: false,
  config: null,
  clips: [],
  loading: false,
  starting: false,
  stopping: false,
  rebindingId: null,
  filterTab: 'all',
  searchQuery: '',
  thumbnails: {},
  refreshing: false,
  selectedClips: new Set<string>(),
  favorites: readPersistedFavorites(),
  publishingPath: null,
  publishProgress: 0,
  publishResult: null,
  publishedLinks: readPersistedPublishedLinks(),

  setStatus: (status) => set({ status }),
  setStatusLoaded: (statusLoaded) => set({ statusLoaded }),
  setClipsLoaded: (clipsLoaded) => set({ clipsLoaded }),
  setConfig: (update) =>
    set((state) => ({
      config: typeof update === 'function' ? update(state.config) : update,
    })),
  // The clip list and the thumbnail map are always reset together by the caller
  // (refreshClips); kept as two setters so each remains atomically selectable.
  setClips: (clips) => set({ clips }),
  setThumbnails: (update) =>
    set((state) => ({
      thumbnails: typeof update === 'function' ? update(state.thumbnails) : update,
    })),
  setLoading: (loading) => set({ loading }),
  setStarting: (starting) => set({ starting }),
  setStopping: (stopping) => set({ stopping }),
  setRefreshing: (refreshing) => set({ refreshing }),
  setRebindingId: (rebindingId) => set({ rebindingId }),
  setFilterTab: (filterTab) => set({ filterTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedClips: (update) =>
    set((state) => ({
      selectedClips: typeof update === 'function' ? update(state.selectedClips) : update,
    })),
  setFavorites: (update) =>
    set((state) => ({
      favorites: typeof update === 'function' ? update(state.favorites) : update,
    })),
  setPublishingPath: (publishingPath) => set({ publishingPath }),
  setPublishProgress: (publishProgress) => set({ publishProgress }),
  setPublishResult: (publishResult) => set({ publishResult }),
  setPublishedLink: (path, link) =>
    set((state) =>
      state.publishedLinks[path] === link ? state : { publishedLinks: { ...state.publishedLinks, [path]: link } },
    ),
  reset: () =>
    set({
      status: defaultClipsEngineStatus,
      statusLoaded: false,
      clipsLoaded: false,
      config: null,
      clips: [],
      loading: false,
      starting: false,
      stopping: false,
      rebindingId: null,
      filterTab: 'all',
      searchQuery: '',
      thumbnails: {},
      refreshing: false,
      selectedClips: new Set<string>(),
      // Called after an explicit `localStorage.clear()` (tests) — re-read the
      // persisted values instead of holding the merged ones from module init.
      favorites: readPersistedFavorites(),
      publishingPath: null,
      publishProgress: 0,
      publishResult: null,
      publishedLinks: readPersistedPublishedLinks(),
    }),
}))
