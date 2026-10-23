import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Curated release map: for each version, the sidebar sections that received user-visible
 * news. This is hand-maintained (not parsed): the changelog prose is written for humans and
 * mapping it automatically to nav sections would be guesswork. Update it when a release
 * changes one of the tracked sections.
 */
export type NewsSection = 'clips' | 'protect' | 'clean' | 'optimize'

export const NEWS_BY_VERSION: Record<string, NewsSection[]> = {
  '2.1.4': ['protect', 'clean', 'optimize'],
  '2.1.3': ['clips'],
  '2.1.2': ['clips'],
  '2.1.1': ['clips'],
  '2.1.0': ['clips'],
  '2.0.9': [],
  '2.0.8': ['clips', 'optimize'],
  '2.0.7': ['clips', 'protect', 'clean', 'optimize'],
  '2.0.6': ['clips'],
  '2.0.5': ['optimize'],
}

/**
 * Curated path → section map. Mirrors the nav structure in `Sidebar.tsx`; kept here so the
 * "news" decision is testable without rendering the sidebar (which owns stores, router and
 * platform context).
 */
export const SECTION_PATHS: Record<NewsSection, string[]> = {
  clips: ['/clips'],
  protect: [
    '/malware',
    '/hardening',
    '/privacy',
    '/services',
    '/firewall',
    '/power-plans',
    '/compliance',
    '/vulnerability',
  ],
  clean: [
    '/cleaner',
    '/network',
    '/hosts-editor',
    '/registry',
    '/updates',
    '/installer',
    '/drivers',
    '/uninstaller',
    '/debloater',
    '/context-menu',
    '/disk',
    '/duplicates',
    '/large-files',
    '/empty-folders',
    '/file-shredder',
    '/disk-repair',
    '/disk-maintenance',
  ],
  optimize: [
    '/windows-tweaks',
    '/memory',
    '/stoped',
    '/startup',
    '/schedules',
    '/performance',
    '/benchmark',
    '/settings',
    '/activation',
    '/history',
    '/about',
  ],
}

export function parseVersion(version: string): number[] {
  return version
    .split('-')[0]!
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** Returns -1, 0 or 1 comparing two dotted versions (pre-release suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const length = Math.max(pa.length, pb.length)
  for (let i = 0; i < length; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

/**
 * Sections that got news in a version strictly newer than `baseline` and no newer than
 * `current`. A `null` baseline means "no prior version recorded" (fresh install) — nothing
 * is considered new, so a brand-new user is not greeted with a wall of badges.
 */
export function sectionsWithNewsSince(current: string, baseline: string | null): NewsSection[] {
  if (!baseline) return []
  const result = new Set<NewsSection>()
  for (const [version, sections] of Object.entries(NEWS_BY_VERSION)) {
    if (compareVersions(version, baseline) > 0 && compareVersions(version, current) <= 0) {
      for (const section of sections) result.add(section)
    }
  }
  return [...result]
}

export function sectionForPath(path: string): NewsSection | null {
  for (const section of Object.keys(SECTION_PATHS) as NewsSection[]) {
    if (SECTION_PATHS[section].includes(path)) return section
  }
  return null
}

export function sectionForHeadingKey(headingKey: string | undefined): NewsSection | null {
  if (headingKey === 'sectionProtect') return 'protect'
  if (headingKey === 'sectionClean') return 'clean'
  if (headingKey === 'sectionOptimize') return 'optimize'
  return null
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private mode / quota); the badges simply do not persist.
  }
}

/**
 * Sections still showing a dot: those with news since the last launch the user ran, minus the
 * ones already dismissed. A section dismissed at version X stops showing until a version
 * newer than X adds news to it again — so skipping releases never re-lights an old dot.
 */
export function visibleNewsSections(
  current: string,
  baseline: string,
  dismissed: Partial<Record<NewsSection, string>>,
): NewsSection[] {
  return sectionsWithNewsSince(current, baseline).filter((section) =>
    sectionsWithNewsSince(current, dismissed[section] ?? baseline).includes(section),
  )
}

interface NavNewsState {
  baseline: string
  dismissed: Partial<Record<NewsSection, string>>
}

const NAV_STATE_KEY = 'dinho-nav-news'

function readNavState(raw: string | null, current: string): NavNewsState {
  if (!raw) return { baseline: current, dismissed: {} }
  try {
    const parsed = JSON.parse(raw) as { baseline?: unknown; dismissed?: unknown }
    if (typeof parsed.baseline !== 'string') return { baseline: current, dismissed: {} }
    const dismissed: Partial<Record<NewsSection, string>> = {}
    if (parsed.dismissed && typeof parsed.dismissed === 'object') {
      for (const [key, value] of Object.entries(parsed.dismissed as Record<string, unknown>)) {
        if (typeof value === 'string') dismissed[key as NewsSection] = value
      }
    }
    return { baseline: parsed.baseline, dismissed }
  } catch {
    return { baseline: current, dismissed: {} }
  }
}

/**
 * Sidebar news dots. The baseline (the version the user last ran) is recorded once and never
 * auto-advances, so unacknowledged dots survive restarts until the user visits the section.
 */
export function useNavNews(current: string): {
  visibleNews: NewsSection[]
  markSeen: (section: NewsSection) => void
} {
  const [state, setState] = useState<NavNewsState>(() => readNavState(readStorage(NAV_STATE_KEY), current))

  useEffect(() => {
    writeStorage(NAV_STATE_KEY, JSON.stringify(state))
  }, [state])

  const visibleNews = useMemo(() => visibleNewsSections(current, state.baseline, state.dismissed), [current, state])

  const markSeen = useCallback(
    (section: NewsSection) => {
      setState((prev) => {
        if (prev.dismissed[section] === current) return prev
        return { baseline: prev.baseline, dismissed: { ...prev.dismissed, [section]: current } }
      })
    },
    [current],
  )

  return { visibleNews, markSeen }
}

/**
 * "New version" badge (e.g. on the Clips gear). True while the running version is newer than
 * the last acknowledged one. The stored version only advances on dismiss, so the badge
 * survives restarts until the user acknowledges it.
 */
export function useNewVersionBadge(storageKey: string, current: string): { isNew: boolean; dismiss: () => void } {
  const [previous] = useState<string | null>(() => readStorage(storageKey))
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Fresh install: record the running version as the baseline so the next update is noticed.
    if (previous === null) writeStorage(storageKey, current)
  }, [previous, storageKey, current])

  const isNew = !dismissed && previous !== null && compareVersions(current, previous) > 0
  const dismiss = useCallback(() => {
    writeStorage(storageKey, current)
    setDismissed(true)
  }, [storageKey, current])

  return { isNew, dismiss }
}
