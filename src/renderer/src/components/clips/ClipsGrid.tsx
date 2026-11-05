import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpDown,
  Clapperboard,
  Combine,
  Film,
  FolderOpen,
  Link,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { StickyActionBar } from '@/components/shared/StickyActionBar'
import { type ClipsSortKey, nativeSelectStyle, SegmentedControl } from './clips-utils'
import type { ClipsState } from './useClipsState'

/** Sorts a copy of the list — never mutates the array coming from state. */
export function sortClips<T extends { createdAt: string; size: number }>(clips: T[], sortBy: ClipsSortKey): T[] {
  const list = [...clips]
  if (sortBy === 'largest') {
    list.sort((a, b) => b.size - a.size)
    return list
  }
  const direction = sortBy === 'recent' ? -1 : 1
  list.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime()
    const tb = new Date(b.createdAt).getTime()
    return (ta - tb) * direction
  })
  return list
}

export function ClipsGrid({
  clipsLoaded,
  filteredClips,
  filterTab,
  setFilterTab,
  filterCounts,
  searchQuery,
  setSearchQuery,
  sortBy,
  setSortBy,
  selectedClips,
  setSelectedClips,
  thumbnails,
  favorites,
  refreshing,
  refreshClips,
  setDeleteAllPending,
  setMergeModePaths,
  handleOpenClip,
  openClipEditor,
  openClipPlayer,
  setRenameTarget,
  handlePublishClip,
  handleCancelPublish,
  publishingPath,
  publishProgress,
  publishedLinks,
  setDeleteTarget,
  toggleFavorite,
  formatSize,
  formatDate,
  formatSeconds,
  filterTabs,
  t,
}: ClipsState) {
  const visibleClips = useMemo(() => sortClips(filteredClips, sortBy), [filteredClips, sortBy])
  const filtering = searchQuery.length > 0 || filterTab !== 'all'
  const allSelected = visibleClips.length > 0 && visibleClips.every((c) => selectedClips.has(c.name))

  const selectedPaths = filteredClips.filter((c) => selectedClips.has(c.name)).map((c) => c.path)

  return (
    <div className="rounded-2xl border p-5 glass-card" style={{ borderColor: 'var(--border-medium)' }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Film className="mr-2 inline-block h-4 w-4" style={{ color: 'var(--accent)' }} />
          {t('clips')}
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
            {t('clipCount', { count: filteredClips.length })}
          </span>
        </h3>
        <button
          type="button"
          onClick={refreshClips}
          disabled={refreshing}
          title={t('refreshSessions')}
          aria-label={t('refreshSessions')}
          className="rounded-lg p-1.5 transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-dim)' }} />
        </button>
      </div>

      {/* Filter tabs + search + sort */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={filterTabs.map((tab) => ({
            value: tab.key,
            label: (
              <span className="flex items-center gap-1.5">
                {t(tab.label)}
                <span
                  className="rounded-full px-1.5 text-[9px] font-semibold tabular-nums"
                  style={{ background: 'rgba(113,113,122,0.18)' }}
                >
                  {filterCounts[tab.key]}
                </span>
              </span>
            ),
            title: t(tab.label),
          }))}
          value={filterTab}
          onChange={setFilterTab}
          layoutId="clips-filter-tabs"
          className="w-fit"
        />

        <div className="ml-auto flex items-center gap-2">
          <label className="relative block">
            <span className="sr-only">{t('sortBy')}</span>
            <ArrowUpDown
              className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2"
              style={{ color: 'var(--text-dim)' }}
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ClipsSortKey)}
              className="cursor-pointer rounded-lg py-1.5 pl-6 pr-2 text-[11px] outline-none focus:ring-2"
              style={{
                ...nativeSelectStyle,
                background: 'rgba(113,113,122,0.1)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <option value="recent">{t('sortRecent')}</option>
              <option value="oldest">{t('sortOldest')}</option>
              <option value="largest">{t('sortLargest')}</option>
            </select>
          </label>

          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: 'var(--text-dim)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="w-52 rounded-lg py-1.5 pl-8 pr-7 text-xs outline-none transition-all focus:w-64 focus:ring-2"
              style={{
                background: 'rgba(113,113,122,0.1)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title={t('clearSearch')}
                aria-label={t('clearSearch')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-dim)' }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Multi-select toolbar */}
      {visibleClips.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                if (allSelected) {
                  setSelectedClips(new Set())
                } else {
                  setSelectedClips(new Set(visibleClips.map((c) => c.name)))
                }
              }}
              className="h-3.5 w-3.5 rounded"
            />
            <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              {t('selectAll')}
            </span>
          </label>
          {selectedClips.size > 0 && (
            <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
              {t('selectedCount', { count: selectedClips.size })}
            </span>
          )}
        </div>
      )}

      {/* Clip grid */}
      {!clipsLoaded ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders have no stable id
              key={`skel-${i}`}
              className="overflow-hidden rounded-2xl border"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--card-bg)' }}
            >
              <div
                className="aspect-video animate-shimmer"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(113,113,122,0.07) 25%, rgba(113,113,122,0.16) 50%, rgba(113,113,122,0.07) 75%)',
                  backgroundSize: '200% 100%',
                }}
              />
              <div className="space-y-1.5 p-2.5">
                <div
                  className="h-3 w-3/4 animate-shimmer rounded"
                  style={{
                    background:
                      'linear-gradient(90deg, rgba(113,113,122,0.08) 25%, rgba(113,113,122,0.18) 50%, rgba(113,113,122,0.08) 75%)',
                    backgroundSize: '200% 100%',
                  }}
                />
                <div
                  className="h-2.5 w-1/2 animate-shimmer rounded"
                  style={{
                    background:
                      'linear-gradient(90deg, rgba(113,113,122,0.06) 25%, rgba(113,113,122,0.14) 50%, rgba(113,113,122,0.06) 75%)',
                    backgroundSize: '200% 100%',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : filteredClips.length === 0 ? (
        <EmptyState
          icon={filtering ? Search : Clapperboard}
          title={filtering ? t('noResults') : t('noClips')}
          description={filtering ? t('noResultsDesc') : t('noClipsDesc')}
          className="py-12"
        />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <AnimatePresence>
            {visibleClips.map((clip, index) => {
              const link = publishedLinks[clip.path]
              const isSelected = selectedClips.has(clip.name)
              const isFavorite = favorites.has(clip.name)
              const isPublishing = publishingPath === clip.path
              return (
                <motion.div
                  key={clip.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.2 }}
                  className="group relative rounded-2xl border glass-card glass-card-hover"
                  style={{
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border-subtle)',
                    boxShadow: isSelected ? '0 0 0 1px var(--accent), 0 8px 24px rgba(0,0,0,0.25)' : undefined,
                  }}
                >
                  {/* Selection checkbox */}
                  <label
                    className={`absolute left-1.5 top-1.5 z-10 grid h-5 w-5 cursor-pointer place-items-center rounded-md backdrop-blur transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    style={{ background: isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.45)' }}
                    title={t('selectClip')}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedClips((prev) => {
                          const next = new Set(prev)
                          if (next.has(clip.name)) next.delete(clip.name)
                          else next.add(clip.name)
                          return next
                        })
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${t('selectClip')}: ${clip.name}`}
                      className="h-3 w-3 rounded accent-white"
                    />
                  </label>

                  {/* Thumbnail — click to play fullscreen */}
                  <button
                    type="button"
                    onClick={() => openClipPlayer(clip)}
                    title={t('playVideo')}
                    aria-label={t('playVideo')}
                    className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-t-2xl"
                    style={{ background: 'rgba(113,113,122,0.08)' }}
                  >
                    {thumbnails[clip.name] ? (
                      <img src={thumbnails[clip.name]} alt={clip.name} className="h-full w-full object-cover" />
                    ) : (
                      <Clapperboard className="h-8 w-8" style={{ color: 'var(--text-dim)', opacity: 0.4 }} />
                    )}

                    {/* Hover play overlay */}
                    <span
                      className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.45))' }}
                    >
                      <span
                        className="grid h-9 w-9 place-items-center rounded-full backdrop-blur"
                        style={{ background: 'rgba(0,0,0,0.55)' }}
                      >
                        <Play className="h-4 w-4 text-white" fill="currentColor" />
                      </span>
                    </span>

                    {/* Duration pill */}
                    <span
                      className="absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums backdrop-blur"
                      style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                    >
                      {formatSeconds(clip.duration)}
                    </span>

                    {/* Upload progress overlay */}
                    {isPublishing && (
                      <span
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 backdrop-blur-[2px]"
                        style={{ background: 'rgba(0,0,0,0.55)' }}
                      >
                        <span className="text-lg font-semibold tabular-nums text-white">
                          {Math.round(publishProgress)}%
                        </span>
                        <span
                          className="h-1 w-1/2 overflow-hidden rounded-full"
                          style={{ background: 'rgba(255,255,255,0.25)' }}
                        >
                          <span
                            className="block h-full rounded-full transition-all duration-200"
                            style={{
                              width: `${Math.max(0, Math.min(100, publishProgress))}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </span>
                        <span className="text-[10px] text-white/80">{t('publish')}</span>
                      </span>
                    )}
                  </button>

                  {/* Info */}
                  <div className="px-2.5 pb-1 pt-2">
                    <p className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {clip.name}
                    </p>
                    <p
                      className="mt-0.5 flex items-center gap-1 text-[11px] tabular-nums"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <span>{formatDate(clip.createdAt)}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{formatSize(clip.size)}</span>
                    </p>
                  </div>

                  {/* Favorites star — always visible once favorited */}
                  <div
                    className={`absolute right-1.5 top-1.5 z-10 transition-opacity ${
                      isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFavorite(clip.name)}
                      title={t('favorites')}
                      aria-label={t('favorites')}
                      aria-pressed={isFavorite}
                      className="rounded-lg p-1 backdrop-blur transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ background: 'rgba(0,0,0,0.35)' }}
                    >
                      <Star
                        className="h-3.5 w-3.5"
                        style={{
                          color: isFavorite ? '#facc15' : 'rgba(255,255,255,0.8)',
                          fill: isFavorite ? '#facc15' : 'none',
                        }}
                      />
                    </button>
                  </div>

                  {/* Bottom actions: icon-only buttons */}
                  <div
                    className="flex items-center gap-0.5 rounded-b-2xl border-t px-1.5 py-1"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenClip(clip.path)}
                      title={t('open')}
                      aria-label={t('open')}
                      className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openClipEditor(clip)}
                      title={t('edit')}
                      aria-label={t('edit')}
                      className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <Film className="h-3.5 w-3.5" />
                    </button>
                    {isPublishing ? (
                      <button
                        type="button"
                        onClick={() => handleCancelPublish(clip.path)}
                        title={t('cancelPublish')}
                        aria-label={t('cancelPublish')}
                        className="rounded-md p-1.5 transition-colors hover:bg-red-500/15"
                        style={{ color: '#ef4444' }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePublishClip(clip.name, clip.path)}
                        disabled={publishingPath !== null}
                        title={t('publish')}
                        aria-label={t('publish')}
                        className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ color: link ? '#06b6d4' : 'var(--text-dim)' }}
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setRenameTarget(clip.name)}
                      title={t('rename')}
                      aria-label={t('rename')}
                      className="ml-auto rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {link && (
                      <button
                        type="button"
                        onClick={() => window.dinho?.clipsOpenExternal(link)}
                        title={t('openLink')}
                        aria-label={t('openLink')}
                        className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                        style={{ color: '#06b6d4' }}
                      >
                        <Link className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(clip.name)}
                      title={t('delete')}
                      aria-label={t('delete')}
                      className="rounded-md p-1.5 transition-colors hover:bg-red-500/15"
                      style={{ color: '#ef4444' }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Bulk actions */}
      <StickyActionBar
        selectedCount={selectedClips.size}
        totalLabel={t('selectedItems')}
        actions={[
          ...(selectedClips.size >= 2
            ? [
                {
                  label: t('merge'),
                  onClick: () => setMergeModePaths(selectedPaths),
                  icon: Combine,
                  variant: 'accent' as const,
                },
              ]
            : []),
          {
            label: t('deleteSelected'),
            onClick: () => setDeleteAllPending(true),
            icon: Trash2,
            variant: 'danger' as const,
          },
        ]}
      />

      {/* The bulk bar is `position: fixed`; reserve its height so the last row
          of cards can still be scrolled clear of it. */}
      <div aria-hidden="true" data-testid="sticky-bar-spacer" className={selectedClips.size > 0 ? 'h-16' : undefined} />
    </div>
  )
}
