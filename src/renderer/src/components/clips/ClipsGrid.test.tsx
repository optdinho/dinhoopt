// @vitest-environment jsdom

import type { ClipInfo } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ClipsGrid, sortClips } from './ClipsGrid'
import type { ClipsSortKey } from './clips-utils'
import type { ClipsState } from './useClipsState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)

const t = ((key: string) => key) as unknown as ClipsState['t']

const clip = (name: string, createdAt: string, size: number, duration = 30): ClipInfo => ({
  name,
  path: `C:\\Clips\\${name}`,
  size,
  createdAt,
  duration,
})

const clips: ClipInfo[] = [
  clip('newest.mp4', '2026-11-03T10:00:00.000Z', 100),
  clip('middle.mp4', '2026-11-02T10:00:00.000Z', 300),
  clip('oldest.mp4', '2026-11-01T10:00:00.000Z', 200),
]

const filterTabs: ClipsState['filterTabs'] = [
  { key: 'all', label: 'all' },
  { key: 'today', label: 'today' },
  { key: 'week', label: 'week' },
  { key: 'favorites', label: 'favorites' },
]

function defaults(): Partial<ClipsState> {
  return {
    clipsLoaded: true,
    filteredClips: clips,
    filterTab: 'all',
    setFilterTab: vi.fn(),
    filterCounts: { all: 3, today: 1, week: 3, favorites: 1 },
    searchQuery: '',
    setSearchQuery: vi.fn(),
    sortBy: 'recent',
    setSortBy: vi.fn(),
    thumbnails: {},
    favorites: new Set(['middle.mp4']),
    refreshing: false,
    refreshClips: vi.fn(),
    setDeleteAllPending: vi.fn(),
    setMergeModePaths: vi.fn(),
    handleOpenClip: vi.fn(),
    openClipEditor: vi.fn(),
    openClipPlayer: vi.fn(),
    setRenameTarget: vi.fn(),
    handlePublishClip: vi.fn(),
    handleCancelPublish: vi.fn(),
    publishingPath: null,
    publishProgress: 0,
    publishedLinks: {},
    setDeleteTarget: vi.fn(),
    toggleFavorite: vi.fn(),
    formatSize: (bytes: number) => `${bytes}B`,
    formatDate: (iso: string) => iso.slice(0, 10),
    formatSeconds: (seconds: number) => `${seconds}s`,
    filterTabs,
    t,
  }
}

/**
 * Renders the grid with real selection state (so checkbox clicks actually
 * update the bulk bar) while every other prop stays a spy from `defaults()`.
 */
function Harness({ overrides = {} }: { overrides?: Partial<ClipsState> }) {
  const [selection, setSelection] = useState<Set<string>>(() => overrides.selectedClips ?? new Set<string>())
  const [sortBy, setSortBy] = useState<ClipsSortKey>(overrides.sortBy ?? 'recent')
  const state = {
    ...defaults(),
    ...overrides,
    selectedClips: overrides.selectedClips ?? selection,
    setSelectedClips: overrides.setSelectedClips ?? setSelection,
    sortBy,
    setSortBy: overrides.setSortBy ?? setSortBy,
  } as unknown as ClipsState
  return <ClipsGrid {...state} />
}

function renderGrid(overrides: Partial<ClipsState> = {}) {
  return render(<Harness overrides={overrides} />)
}

const cardNames = () => screen.queryAllByText(/\.mp4$/).map((el) => el.textContent)

describe('sortClips', () => {
  it('sorts newest first without mutating the input', () => {
    const input = [...clips]
    expect(sortClips(input, 'recent').map((c) => c.name)).toEqual(['newest.mp4', 'middle.mp4', 'oldest.mp4'])
    expect(input.map((c) => c.name)).toEqual(['newest.mp4', 'middle.mp4', 'oldest.mp4'])
  })

  it('sorts oldest first', () => {
    expect(sortClips(clips, 'oldest').map((c) => c.name)).toEqual(['oldest.mp4', 'middle.mp4', 'newest.mp4'])
  })

  it('sorts by size, largest first', () => {
    expect(sortClips(clips, 'largest').map((c) => c.size)).toEqual([300, 200, 100])
  })
})

describe('ClipsGrid — cards', () => {
  it('renders one card per clip with date, size and duration', () => {
    renderGrid()
    expect(cardNames()).toHaveLength(3)
    expect(screen.getByText('2026-11-03')).toBeTruthy()
    expect(screen.getByText('100B')).toBeTruthy()
    expect(screen.getAllByText('30s')).toHaveLength(3)
  })

  it('renders the header count from the filtered list', () => {
    renderGrid({ filteredClips: clips.slice(0, 2) })
    expect(screen.getByText('clipCount')).toBeTruthy()
    expect(cardNames()).toHaveLength(2)
  })

  it('opens the player when the thumbnail is clicked', () => {
    const openClipPlayer = vi.fn()
    renderGrid({ openClipPlayer })
    fireEvent.click(screen.getAllByLabelText('playVideo')[0]!)
    expect(openClipPlayer).toHaveBeenCalledWith(clips[0])
  })

  it('shows shimmer skeletons instead of cards while loading', () => {
    const { container } = renderGrid({ clipsLoaded: false })
    expect(cardNames()).toHaveLength(0)
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(0)
  })
})

describe('ClipsGrid — filters, search and sort', () => {
  it('renders a count badge per filter tab', () => {
    renderGrid()
    expect(screen.getByText('all').parentElement?.textContent).toContain('3')
    expect(screen.getByText('today').parentElement?.textContent).toContain('1')
    expect(screen.getByText('favorites').parentElement?.textContent).toContain('1')
  })

  it('calls setFilterTab with the clicked tab key', () => {
    const setFilterTab = vi.fn()
    renderGrid({ setFilterTab })
    fireEvent.click(screen.getByText('today'))
    expect(setFilterTab).toHaveBeenCalledWith('today')
  })

  it('orders the cards according to the selected sort', () => {
    renderGrid()
    expect(cardNames()).toEqual(['newest.mp4', 'middle.mp4', 'oldest.mp4'])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'largest' } })
    expect(cardNames()).toEqual(['middle.mp4', 'oldest.mp4', 'newest.mp4'])
  })

  it('notifies the sort change to the store', () => {
    const setSortBy = vi.fn<(sort: ClipsSortKey) => void>()
    renderGrid({ setSortBy })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'oldest' } })
    expect(setSortBy).toHaveBeenCalledWith('oldest')
  })

  it('shows the clear button only when there is a query and clears it', () => {
    const setSearchQuery = vi.fn()
    const { rerender } = render(<Harness overrides={{ searchQuery: '', setSearchQuery }} />)
    expect(screen.queryByLabelText('clearSearch')).toBeNull()

    rerender(<Harness overrides={{ searchQuery: 'needle', setSearchQuery }} />)
    fireEvent.click(screen.getByLabelText('clearSearch'))
    expect(setSearchQuery).toHaveBeenCalledWith('')
  })
})

describe('ClipsGrid — empty states', () => {
  it('explains an empty result set caused by a filter or search', () => {
    renderGrid({ filteredClips: [], searchQuery: 'zzz' })
    expect(screen.getByText('noResults')).toBeTruthy()
    expect(screen.getByText('noResultsDesc')).toBeTruthy()
    expect(screen.queryByText('noClips')).toBeNull()
  })

  it('shows the plain empty state when there are no clips at all', () => {
    renderGrid({ filteredClips: [] })
    expect(screen.getByText('noClips')).toBeTruthy()
    expect(screen.getByText('noClipsDesc')).toBeTruthy()
  })
})

describe('ClipsGrid — selection and bulk actions', () => {
  it('select-all selects every visible clip and reveals the bulk bar', () => {
    renderGrid()
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull()

    fireEvent.click(screen.getByLabelText('selectAll'))

    const bar = screen.getByTestId('sticky-action-bar')
    expect(bar.textContent).toContain('3')
    expect(bar.textContent).toContain('selectedItems')
    expect(screen.getByLabelText('selectAll')).toHaveProperty('checked', true)
  })

  it('toggles a single clip from its card checkbox', () => {
    renderGrid()
    fireEvent.click(screen.getByLabelText('selectClip: middle.mp4'))
    expect(screen.getByTestId('sticky-action-bar').textContent).toContain('1')
  })

  it('offers merge only from two selections up', () => {
    renderGrid()
    fireEvent.click(screen.getByLabelText('selectClip: newest.mp4'))
    expect(screen.queryByRole('button', { name: 'merge' })).toBeNull()

    fireEvent.click(screen.getByLabelText('selectClip: middle.mp4'))
    expect(screen.getByRole('button', { name: 'merge' })).toBeTruthy()
  })

  it('passes the selected paths to the merge editor', () => {
    const setMergeModePaths = vi.fn()
    renderGrid({ setMergeModePaths })
    fireEvent.click(screen.getByLabelText('selectClip: newest.mp4'))
    fireEvent.click(screen.getByLabelText('selectClip: middle.mp4'))
    fireEvent.click(screen.getByRole('button', { name: 'merge' }))
    expect(setMergeModePaths).toHaveBeenCalledWith(['C:\\Clips\\newest.mp4', 'C:\\Clips\\middle.mp4'])
  })

  it('asks for confirmation before deleting the selection', () => {
    const setDeleteAllPending = vi.fn()
    renderGrid({ setDeleteAllPending })
    fireEvent.click(screen.getByLabelText('selectClip: oldest.mp4'))
    fireEvent.click(screen.getByRole('button', { name: 'deleteSelected' }))
    expect(setDeleteAllPending).toHaveBeenCalledWith(true)
  })

  it('reserves room below the grid while the fixed bulk bar is visible', () => {
    renderGrid()
    const spacer = screen.getByTestId('sticky-bar-spacer')
    expect(spacer.className).toBe('')

    fireEvent.click(screen.getByLabelText('selectClip: oldest.mp4'))
    expect(screen.getByTestId('sticky-bar-spacer').className).toContain('h-16')
  })
})

describe('ClipsGrid — card actions', () => {
  it('opens the folder, editor and publish flow from the primary actions', () => {
    const handleOpenClip = vi.fn()
    const openClipEditor = vi.fn()
    const handlePublishClip = vi.fn()
    renderGrid({ handleOpenClip, openClipEditor, handlePublishClip })

    fireEvent.click(screen.getAllByLabelText('open')[0]!)
    expect(handleOpenClip).toHaveBeenCalledWith('C:\\Clips\\newest.mp4')

    fireEvent.click(screen.getAllByLabelText('edit')[0]!)
    expect(openClipEditor).toHaveBeenCalledWith(clips[0])

    fireEvent.click(screen.getAllByLabelText('publish')[0]!)
    expect(handlePublishClip).toHaveBeenCalledWith('newest.mp4', 'C:\\Clips\\newest.mp4')
  })

  it('renames and deletes through the overflow menu', () => {
    const setRenameTarget = vi.fn()
    const setDeleteTarget = vi.fn()
    renderGrid({ setRenameTarget, setDeleteTarget })

    fireEvent.click(screen.getAllByLabelText('moreActions')[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'rename' }))
    expect(setRenameTarget).toHaveBeenCalledWith('newest.mp4')

    fireEvent.click(screen.getAllByLabelText('moreActions')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    expect(setDeleteTarget).toHaveBeenCalledWith('middle.mp4')
  })

  it('offers the published link only for clips that have one', () => {
    const openExternal = vi.fn()
    ;(window as unknown as { dinho: Record<string, unknown> }).dinho = { clipsOpenExternal: openExternal }
    renderGrid({ publishedLinks: { 'C:\\Clips\\newest.mp4': 'https://share/abc' } })

    fireEvent.click(screen.getAllByLabelText('moreActions')[1]!)
    expect(screen.queryByRole('button', { name: 'openLink' })).toBeNull()
    fireEvent.click(screen.getAllByLabelText('moreActions')[1]!)

    fireEvent.click(screen.getAllByLabelText('moreActions')[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'openLink' }))
    expect(openExternal).toHaveBeenCalledWith('https://share/abc')
  })

  it('toggles the favorite from the star, keeping it visible once set', () => {
    const toggleFavorite = vi.fn()
    renderGrid({ toggleFavorite })
    fireEvent.click(screen.getAllByLabelText('favorites')[0]!)
    expect(toggleFavorite).toHaveBeenCalledWith('newest.mp4')
    expect(screen.getAllByLabelText('favorites')[0]?.getAttribute('aria-pressed')).toBe('false')
  })
})
