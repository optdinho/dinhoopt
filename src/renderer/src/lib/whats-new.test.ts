// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareVersions,
  NEWS_BY_VERSION,
  parseVersion,
  sectionForHeadingKey,
  sectionForPath,
  sectionsWithNewsSince,
  useNavNews,
  useNewVersionBadge,
  visibleNewsSections,
} from './whats-new'

describe('parseVersion / compareVersions', () => {
  it('parses dotted versions and ignores pre-release suffixes', () => {
    expect(parseVersion('2.0.9')).toEqual([2, 0, 9])
    expect(parseVersion('2.0.9-beta.1')).toEqual([2, 0, 9])
  })

  it('orders numerically, not lexically', () => {
    expect(compareVersions('2.0.9', '2.0.10')).toBe(-1)
    expect(compareVersions('2.0.10', '2.0.9')).toBe(1)
    expect(compareVersions('2.1.0', '2.0.99')).toBe(1)
    expect(compareVersions('2.0.9', '2.0.9')).toBe(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
  })
})

describe('sectionsWithNewsSince', () => {
  it('returns nothing when there is no recorded baseline', () => {
    expect(sectionsWithNewsSince('2.0.9', null)).toEqual([])
  })

  it('returns nothing when the baseline is the current version', () => {
    expect(sectionsWithNewsSince('2.0.9', '2.0.9')).toEqual([])
  })

  it('flags the clips section when updating from 2.0.9 to 2.1.0', () => {
    expect(sectionsWithNewsSince('2.1.0', '2.0.9')).toEqual(['clips'])
  })

  it('unions the sections of every version above the baseline up to current', () => {
    expect(sectionsWithNewsSince('2.0.8', '2.0.7')).toEqual(['clips', 'optimize'])
    const merged = sectionsWithNewsSince('2.0.7', '2.0.5')
    expect(new Set(merged)).toEqual(new Set(['clips', 'protect', 'clean', 'optimize']))
  })

  it('never reports sections newer than the current version', () => {
    // Baseline 2.0.7, but the app is only at 2.0.6 → nothing new is reachable.
    expect(sectionsWithNewsSince('2.0.6', '2.0.7')).toEqual([])
  })

  it('a versions map entry with no sections does not light anything up', () => {
    expect(NEWS_BY_VERSION['2.0.9']).toEqual([])
    expect(sectionsWithNewsSince('2.0.9', '2.0.8')).toEqual([])
  })
})

describe('sectionForPath / sectionForHeadingKey', () => {
  it('maps a nested path to its section', () => {
    expect(sectionForPath('/vulnerability')).toBe('protect')
    expect(sectionForPath('/registry')).toBe('clean')
    expect(sectionForPath('/windows-tweaks')).toBe('optimize')
    expect(sectionForPath('/clips')).toBe('clips')
  })

  it('returns null for unknown paths', () => {
    expect(sectionForPath('/does-not-exist')).toBeNull()
    expect(sectionForPath('/')).toBeNull()
  })

  it('maps the three headed section keys', () => {
    expect(sectionForHeadingKey('sectionProtect')).toBe('protect')
    expect(sectionForHeadingKey('sectionClean')).toBe('clean')
    expect(sectionForHeadingKey('sectionOptimize')).toBe('optimize')
    expect(sectionForHeadingKey('sectionQuick')).toBeNull()
    expect(sectionForHeadingKey(undefined)).toBeNull()
  })
})

describe('visibleNewsSections', () => {
  it('hides a section dismissed at or after its news version', () => {
    expect(visibleNewsSections('2.0.8', '2.0.7', { clips: '2.0.8' })).toEqual(['optimize'])
  })

  it('re-lights a section once a newer version adds news to it', () => {
    // clips was dismissed at 2.0.7, but 2.0.8 brings clips news again.
    expect(visibleNewsSections('2.0.8', '2.0.7', { clips: '2.0.7' })).toEqual(['clips', 'optimize'])
  })

  it('returns nothing when the baseline is the running version', () => {
    expect(visibleNewsSections('2.0.9', '2.0.9', {})).toEqual([])
  })
})

describe('useNavNews', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('shows no dots on a fresh install and records the baseline', () => {
    const { result } = renderHook(() => useNavNews('2.0.8'))
    expect(result.current.visibleNews).toEqual([])
    expect(JSON.parse(localStorage.getItem('dinho-nav-news')!)).toMatchObject({ baseline: '2.0.8' })
  })

  it('shows the dots for news since the recorded baseline', () => {
    localStorage.setItem('dinho-nav-news', JSON.stringify({ baseline: '2.0.7', dismissed: {} }))
    const { result } = renderHook(() => useNavNews('2.0.8'))
    expect(new Set(result.current.visibleNews)).toEqual(new Set(['clips', 'optimize']))
  })

  it('clears a dot once its section is visited and keeps the others', () => {
    localStorage.setItem('dinho-nav-news', JSON.stringify({ baseline: '2.0.7', dismissed: {} }))
    const { result } = renderHook(() => useNavNews('2.0.8'))
    act(() => result.current.markSeen('clips'))
    expect(result.current.visibleNews).toEqual(['optimize'])
    expect(JSON.parse(localStorage.getItem('dinho-nav-news')!)).toEqual({
      baseline: '2.0.7',
      dismissed: { clips: '2.0.8' },
    })
  })

  it('keeps an acknowledged dot hidden on the next launch of the same version', () => {
    localStorage.setItem('dinho-nav-news', JSON.stringify({ baseline: '2.0.7', dismissed: { clips: '2.0.8' } }))
    const { result } = renderHook(() => useNavNews('2.0.8'))
    expect(result.current.visibleNews).toEqual(['optimize'])
  })
})

describe('useNewVersionBadge', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('is hidden on a fresh install and stores the current version', () => {
    const { result } = renderHook(() => useNewVersionBadge('dinho-test-badge', '2.0.8'))
    expect(result.current.isNew).toBe(false)
    expect(localStorage.getItem('dinho-test-badge')).toBe('2.0.8')
  })

  it('is visible after an update and dismisses on demand', () => {
    localStorage.setItem('dinho-test-badge', '2.0.7')
    const { result } = renderHook(() => useNewVersionBadge('dinho-test-badge', '2.0.8'))
    expect(result.current.isNew).toBe(true)
    act(() => result.current.dismiss())
    expect(result.current.isNew).toBe(false)
  })

  it('does not show on a downgrade', () => {
    localStorage.setItem('dinho-test-badge', '2.0.9')
    const { result } = renderHook(() => useNewVersionBadge('dinho-test-badge', '2.0.8'))
    expect(result.current.isNew).toBe(false)
  })

  it('stays visible across mounts until dismissed', () => {
    localStorage.setItem('dinho-test-badge', '2.0.7')
    const first = renderHook(() => useNewVersionBadge('dinho-test-badge', '2.0.8'))
    expect(first.result.current.isNew).toBe(true)
    first.unmount()
    // A restart without acknowledgement must not silently swallow the badge.
    const second = renderHook(() => useNewVersionBadge('dinho-test-badge', '2.0.8'))
    expect(second.result.current.isNew).toBe(true)
    act(() => second.result.current.dismiss())
    const third = renderHook(() => useNewVersionBadge('dinho-test-badge', '2.0.8'))
    expect(third.result.current.isNew).toBe(false)
  })
})

describe('storage resilience', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => renderHook(() => useNavNews('2.0.8'))).not.toThrow()
  })
})
