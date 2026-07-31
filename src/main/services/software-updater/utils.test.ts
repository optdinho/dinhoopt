import { describe, expect, it } from 'vitest'
import { cleanOutput, computeSeverity, emptyResult, formatAppName, stripTrailingVersion } from './utils'

// ─── cleanOutput ────────────────────────────────────────────

describe('cleanOutput', () => {
  it('removes ANSI escape codes', () => {
    expect(cleanOutput('\x1B[31mHello\x1B[0m')).toBe('Hello')
  })

  it('resolves \\r\\n to \\n', () => {
    expect(cleanOutput('line1\r\nline2')).toBe('line1\nline2')
  })

  it('keeps last part after \\r without \\n', () => {
    expect(cleanOutput('progress 10%\rprogress 20%\rprogress 30%')).toBe('progress 30%')
  })

  it('handles empty string', () => {
    expect(cleanOutput('')).toBe('')
  })

  it('handles multiple \\r in same line', () => {
    expect(cleanOutput('a\rb\rc')).toBe('c')
  })
})

// ─── computeSeverity ─────────────────────────────────────────

describe('computeSeverity', () => {
  it('major when major version bumps', () => {
    expect(computeSeverity('1.0.0', '2.0.0')).toBe('major')
    expect(computeSeverity('1.9.9', '2.0.0')).toBe('major')
  })

  it('minor when minor version bumps', () => {
    expect(computeSeverity('1.0.0', '1.1.0')).toBe('minor')
    expect(computeSeverity('1.0.9', '1.1.0')).toBe('minor')
  })

  it('patch when patch version bumps', () => {
    expect(computeSeverity('1.0.0', '1.0.1')).toBe('patch')
    expect(computeSeverity('1.0.0', '1.0.99')).toBe('patch')
  })

  it('unknown when versions are equal', () => {
    expect(computeSeverity('1.0.0', '1.0.0')).toBe('unknown')
  })

  it('unknown when non-semver strings provided', () => {
    expect(computeSeverity('abc', 'def')).toBe('unknown')
    expect(computeSeverity('1.0.0', 'nightly')).toBe('unknown')
  })

  it('handles two-part versions', () => {
    expect(computeSeverity('1.0', '2.0')).toBe('major')
    expect(computeSeverity('1.0', '1.1')).toBe('minor')
  })
})

// ─── emptyResult ─────────────────────────────────────────────

describe('emptyResult', () => {
  it('returns empty result with available=false', () => {
    const r = emptyResult(false, 'winget')
    expect(r.apps).toEqual([])
    expect(r.totalCount).toBe(0)
    expect(r.packageManagerAvailable).toBe(false)
    expect(r.packageManagerName).toBe('winget')
  })

  it('returns empty result with available=true', () => {
    const r = emptyResult(true, 'winget')
    expect(r.packageManagerAvailable).toBe(true)
    expect(r.totalCount).toBe(0)
  })
})

// ─── stripTrailingVersion ────────────────────────────────────

describe('stripTrailingVersion', () => {
  it('removes trailing version', () => {
    expect(stripTrailingVersion('App v1.2.3')).toBe('App')
  })

  it('removes trailing version without v prefix', () => {
    expect(stripTrailingVersion('App 1.2.3')).toBe('App')
  })

  it('handles no trailing version', () => {
    expect(stripTrailingVersion('App Name')).toBe('App Name')
  })

  it('handles trailing version with spaces', () => {
    expect(stripTrailingVersion('App   1.0.0')).toBe('App')
  })

  it('handles empty string', () => {
    expect(stripTrailingVersion('')).toBe('')
  })

  it('handles single-dot versions', () => {
    expect(stripTrailingVersion('App v1.2')).toBe('App')
  })
})

// ─── formatAppName ────────────────────────────────────────────

describe('formatAppName', () => {
  it('replaces underscores with spaces and capitalizes', () => {
    expect(formatAppName('some_package_name')).toBe('Some Package Name')
  })

  it('replaces hyphens with spaces and capitalizes', () => {
    expect(formatAppName('some-package-name')).toBe('Some Package Name')
  })

  it('handles mixed separators', () => {
    expect(formatAppName('some_package-name_test')).toBe('Some Package Name Test')
  })

  it('keeps short words lowercase', () => {
    expect(formatAppName('package_of_the_year')).toBe('Package of The Year')
  })

  it('returns raw string if cleaned is empty', () => {
    expect(formatAppName('_')).toBe('_')
  })

  it('handles single word', () => {
    expect(formatAppName('7zip')).toBe('7zip')
  })

  it('handles dot-separated IDs', () => {
    expect(formatAppName('google.chrome')).toBe('Google.chrome')
  })

  it('handles leading/trailing whitespace', () => {
    expect(formatAppName('  app  ')).toBe('App')
  })
})
