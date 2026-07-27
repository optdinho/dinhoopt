import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkForUpdates,
  cleanOutput,
  computeSeverity,
  isValidAppId,
  parseChocoListOutput,
  parseChocoOutdatedOutput,
  parseScoopListOutput,
  parseScoopStatusOutput,
  parseWingetListOutput,
  parseWingetUpgradeOutput,
  runUpdates,
  stripTrailingVersion,
} from './software-updater'

const execFileAsyncMock = vi.hoisted(() => vi.fn())
const psUtf8Mock = vi.hoisted(() => vi.fn((s: string) => s))

vi.mock('./exec-utf8', () => ({
  execFileAsync: execFileAsyncMock,
  psUtf8: psUtf8Mock,
}))

const isAdminMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('./elevation', () => ({
  isAdmin: isAdminMock,
}))

const getSettingsMock = vi.hoisted(() => vi.fn(() => ({ windowsPackageManager: 'winget' })))
vi.mock('./settings-store', () => ({
  getSettings: getSettingsMock,
}))

function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  setPlatform('win32')
})

describe('cleanOutput', () => {
  it('strips ANSI escape sequences', () => {
    const input = '\x1B[31mHello\x1B[0m World'
    expect(cleanOutput(input)).toBe('Hello World')
  })

  it('handles \r overwrites (spinners)', () => {
    const input = 'Scanning...\rDone!\nNext line'
    expect(cleanOutput(input)).toBe('Done!\nNext line')
  })

  it('handles multiple \r in same line', () => {
    const input = 'aaa\rbbb\rccc\nnext'
    expect(cleanOutput(input)).toBe('ccc\nnext')
  })

  it('preserves normal strings', () => {
    expect(cleanOutput('Hello World')).toBe('Hello World')
  })

  it('handles empty string', () => {
    expect(cleanOutput('')).toBe('')
  })
})

describe('computeSeverity', () => {
  it('returns major for major version bump', () => {
    expect(computeSeverity('1.0.0', '2.0.0')).toBe('major')
  })

  it('returns minor for minor version bump', () => {
    expect(computeSeverity('1.0.0', '1.1.0')).toBe('minor')
  })

  it('returns patch for patch version bump', () => {
    expect(computeSeverity('1.0.0', '1.0.1')).toBe('patch')
  })

  it('returns unknown when versions are equal', () => {
    expect(computeSeverity('1.0.0', '1.0.0')).toBe('unknown')
  })

  it('returns unknown when version cannot be parsed', () => {
    expect(computeSeverity('abc', '1.0.0')).toBe('unknown')
    expect(computeSeverity('1.0.0', 'abc')).toBe('unknown')
  })

  it('handles two-part versions (major.minor)', () => {
    expect(computeSeverity('1.0', '2.0')).toBe('major')
    expect(computeSeverity('1.0', '1.1')).toBe('minor')
  })

  it('does not handle leading v (returns unknown)', () => {
    expect(computeSeverity('v1.0.0', 'v2.0.0')).toBe('unknown')
  })
})

describe('stripTrailingVersion', () => {
  it('strips trailing version from name', () => {
    expect(stripTrailingVersion('HandBrake 1.11.0')).toBe('HandBrake')
  })

  it('strips v-prefixed version', () => {
    expect(stripTrailingVersion('My App v2.3.1')).toBe('My App')
  })

  it('preserves name without version', () => {
    expect(stripTrailingVersion('Google Chrome')).toBe('Google Chrome')
  })

  it('handles empty string', () => {
    expect(stripTrailingVersion('')).toBe('')
  })
})

describe('parseWingetUpgradeOutput', () => {
  // winget uses fixed-width columns; align test data to header positions
  // Name(0-18, 19) + Id(19-39, 21) + Version(40-57, 18) + Available(58-74, 17) + Source(75+)
  const header = 'Name               Id                   Version           Available        Source'
  const separator = '--------------------------------------------------'

  function padCols(name: string, id: string, version: string, available: string, source: string): string {
    return `${name.padEnd(19)}${id.padEnd(21)}${version.padEnd(18)}${available.padEnd(17)}${source}`
  }

  it('parses winget upgrade output', () => {
    const output = [
      header,
      separator,
      padCols('7-Zip', '7zip.7zip', '24.01', '24.03', 'winget'),
      padCols('Google Chrome', 'Google.Chrome', '122.0.6261.95', '123.0.6312.59', 'winget'),
      '',
      '42 upgrades available.',
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('7zip.7zip')
    expect(result[0]?.currentVersion).toBe('24.01')
    expect(result[0]?.availableVersion).toBe('24.03')
    expect(result[0]?.severity).toBe('minor')
    expect(result[1]?.id).toBe('Google.Chrome')
  })

  it('strips > and < prefixes from version', () => {
    const output = [header, separator, padCols('MyApp', 'MyApp.MyApp', '> 1.0.0', '< 2.0.0', 'winget')].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.currentVersion).toBe('1.0.0')
    expect(result[0]?.availableVersion).toBe('2.0.0')
  })

  it('skips apps where installed version equals available', () => {
    const output = [header, separator, padCols('SameApp', 'Same.Id', '1.0.0', '1.0.0', 'winget')].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toHaveLength(0)
  })

  it('returns empty array when no header found', () => {
    expect(parseWingetUpgradeOutput('no header here')).toEqual([])
  })

  it('returns empty array for empty output', () => {
    expect(parseWingetUpgradeOutput('')).toEqual([])
  })
})

describe('parseWingetListOutput', () => {
  // Same header as upgrade; list parser reads version up to sourceStart(75)
  // Name(0-18, 19) + Id(19-39, 21) + Version(40-74, 35) + Source(75+)
  const header = 'Name               Id                   Version           Available        Source'
  const separator = '--------------------------------------------------'

  function padCols(name: string, id: string, version: string, source: string): string {
    return `${name.padEnd(19)}${id.padEnd(21)}${version.padEnd(35)}${source}`
  }

  it('parses winget list output', () => {
    const output = [
      header,
      separator,
      padCols('7-Zip', '7zip.7zip', '24.03', 'winget'),
      padCols('Google Chrome', 'Google.Chrome', '123.0.6312.59', 'winget'),
      '',
      '42 packages.',
    ].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('7zip.7zip')
    expect(result[0]?.isUpToDate).toBe(true)
  })

  it('skips ARP entries', () => {
    const output = [header, separator, padCols('OldApp', 'ARP\\OldApp', '1.0.0', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })

  it('skips unknown version', () => {
    const output = [header, separator, padCols('Unknown', 'Unknown.Id', 'Unknown', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })
})

describe('parseChocoOutdatedOutput', () => {
  it('parses choco outdated output', () => {
    const output = '7zip|24.01|24.03|false\r\nnodejs|18.0.0|20.0.0|false\r\n'
    const result = parseChocoOutdatedOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('7zip')
    expect(result[0]?.currentVersion).toBe('24.01')
    expect(result[0]?.availableVersion).toBe('24.03')
  })

  it('skips pinned packages', () => {
    const output = 'pinned-pkg|1.0.0|2.0.0|true\r\n'
    expect(parseChocoOutdatedOutput(output)).toHaveLength(0)
  })

  it('skips packages where versions match', () => {
    const output = 'uptodate|1.0.0|1.0.0|false\r\n'
    expect(parseChocoOutdatedOutput(output)).toHaveLength(0)
  })

  it('returns empty array for empty output', () => {
    expect(parseChocoOutdatedOutput('')).toEqual([])
  })
})

describe('parseChocoListOutput', () => {
  it('parses choco list output', () => {
    const output = '7zip|24.03\r\nnodejs|20.0.0\r\n'
    const result = parseChocoListOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('7zip')
    expect(result[0]?.currentVersion).toBe('24.03')
    expect(result[0]?.isUpToDate).toBe(true)
  })

  it('returns empty array for empty output', () => {
    expect(parseChocoListOutput('')).toEqual([])
  })
})

describe('parseScoopStatusOutput', () => {
  const sample = [
    'Scoop is up to date.',
    '',
    'Updates are available for:',
    'Main:',
    '    Name            Installed  Available  Requested',
    '    googlechrome    126.0.6478.57  127.0.6533.72  Latest',
    '    7zip            24.07      24.08      Latest',
    '    unknown         -          1.0.0     Latest',
    '',
    'Java:',
    '    openjdk21       21.0.1     21.0.2     Latest',
  ].join('\r\n')

  it('parses scoop status output', () => {
    const result = parseScoopStatusOutput(sample)
    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe('googlechrome')
    expect(result[0]?.currentVersion).toBe('126.0.6478.57')
    expect(result[0]?.availableVersion).toBe('127.0.6533.72')
    expect(result[1]?.id).toBe('7zip')
    expect(result[2]?.id).toBe('unknown')
    expect(result[2]?.currentVersion).toBe('-')
    expect(result[2]?.availableVersion).toBe('1.0.0')
  })

  it('returns empty array for empty output', () => {
    expect(parseScoopStatusOutput('')).toEqual([])
  })
})

describe('parseScoopListOutput', () => {
  it('parses scoop list output', () => {
    const output = [
      'Installed apps in Scoop:',
      '',
      '    Name       Version     Source',
      '    googlechrome  127.0.6533.72  main',
      '    7zip       24.08      main',
    ].join('\r\n')
    const result = parseScoopListOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('googlechrome')
    expect(result[0]?.isUpToDate).toBe(true)
  })
})

// ─── isValidAppId ────────────────────────────────────────────

describe('isValidAppId', () => {
  it('accepts valid winget-style IDs on win32', () => {
    expect(isValidAppId('Google.Chrome')).toBe(true)
    expect(isValidAppId('7zip.7zip')).toBe(true)
    expect(isValidAppId('Microsoft.DotNet.Runtime.6')).toBe(true)
    expect(isValidAppId('a')).toBe(true)
  })

  it('rejects invalid winget-style IDs on win32', () => {
    expect(isValidAppId('')).toBe(false)
    expect(isValidAppId('.starts.with.dot')).toBe(false)
    expect(isValidAppId('a'.repeat(250))).toBe(false)
    expect(isValidAppId('has spaces')).toBe(false)
  })
})

// ─── Helper: fresh module load (for tests needing clean state) ──

async function _freshMod() {
  vi.resetModules()
  const mod = await import('./software-updater')
  return mod
}

// ─── checkForUpdates — win32 ─────────────────────────────────

describe('checkForUpdates (win32)', () => {
  beforeEach(() => setPlatform('win32'))

  it('returns winget result when winget is available', async () => {
    const upgradeOutput = [
      'Name    Id          Version     Available   Source',
      '-----------------------------------------------',
      'App     Some.App    1.0.0       2.0.0       winget',
    ].join('\n')
    const listOutput = [
      'Name        Id              Version    Available  Source',
      '---------------------------------------------------------',
      'App         Some.App        2.0.0                 winget',
      'Node.js     OpenJS.NodeJS   20.10.0              winget',
    ].join('\n')

    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') return { stdout: upgradeOutput, stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'list') return { stdout: listOutput, stderr: '' }
      if (cmd === 'choco' || cmd === 'scoop') throw new Error('not found')
      throw new Error('unexpected')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerName).toBe('winget')
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(2)
    expect(result.apps[0]?.id).toBe('Some.App')
  })

  it('returns choco result when only choco is available', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'choco' && args?.[0] === '--version') return { stdout: '2.0', stderr: '' }
      if (cmd === 'choco' && args?.[0] === 'outdated') return { stdout: 'pkg1|1.0.0|2.0.0|false\n', stderr: '' }
      if (cmd === 'choco' && args?.[0] === 'list') return { stdout: 'pkg1|2.0.0\n', stderr: '' }
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.packageManagerName).toContain('choco')
  })

  it('returns scoop result when only scoop is available', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'scoop' && args?.[0] === '--version') return { stdout: 'v0.3', stderr: '' }
      if (cmd === 'scoop' && args?.[0] === 'status') {
        return {
          stdout: ['    Name   Installed  Available  Requested', '    7zip   24.07      24.08      Latest'].join('\n'),
          stderr: '',
        }
      }
      if (cmd === 'scoop' && args?.[0] === 'list') {
        return {
          stdout: ['    Name   Version   Source', '    7zip   24.08     main'].join('\n'),
          stderr: '',
        }
      }
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.packageManagerName).toContain('scoop')
  })

  it('returns no manager when all unavailable', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('not found'))

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBeNull()
  })

  it('handles winget upgrade non-zero exit with stdout', async () => {
    const upgradeOutput = [
      'Name    Id          Version     Available   Source',
      '-----------------------------------------------',
      'App     Some.App    1.0.0       2.0.0       winget',
    ].join('\n')

    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') throw { stdout: upgradeOutput, message: 'exit 1', code: '1' }
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
  })

  it('handles winget upgrade non-zero exit without stdout', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') throw new Error('no output')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(0)
  })

  it('handles winget list non-zero exit gracefully', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') return { stdout: '', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'list') throw new Error('list failed')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    // Should still succeed with upgrade result, just not up-to-date list
    expect(result.packageManagerAvailable).toBe(true)
  })

  it('handles choco outdated non-zero exit with stdout', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'choco' && args?.[0] === '--version') return { stdout: '2.0', stderr: '' }
      if (cmd === 'choco' && args?.[0] === 'outdated') throw { stdout: 'pkg1|1.0.0|2.0.0|false\n', code: '1' }
      if (cmd === 'choco' && args?.[0] === 'list') throw new Error('list failed')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
  })

  it('handles choco outdated non-zero exit without stdout', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'choco' && args?.[0] === '--version') return { stdout: '2.0', stderr: '' }
      if (cmd === 'choco' && args?.[0] === 'outdated') throw new Error('no output')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(0)
  })

  it('handles scoop status non-zero exit with stdout', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'scoop' && args?.[0] === '--version') return { stdout: 'v0.3', stderr: '' }
      if (cmd === 'scoop' && args?.[0] === 'status') {
        throw {
          stdout: ['    Name  Installed  Available  Requested', '    7zip  24.07      24.08      Latest'].join('\n'),
          code: '1',
        }
      }
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
  })

  it('handles scoop status non-zero exit without stdout', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'scoop' && args?.[0] === '--version') return { stdout: 'v0.3', stderr: '' }
      if (cmd === 'scoop' && args?.[0] === 'status') throw new Error('no output')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(0)
  })
})

// ─── runUpdates — win32: winget pipeline ────────────────────

describe('runUpdates (win32) — winget', () => {
  beforeEach(() => {
    setPlatform('win32')
    isAdminMock.mockReturnValue(true)
  })

  it('upgrades app via winget successfully', async () => {
    execFileAsyncMock.mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when exit code 0 with failure pattern', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'installer failed: Some.App', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns success when exit code 1 with success pattern', async () => {
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'successfully upgraded Some.App', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when exit code 1 without success pattern', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'no applicable update', code: '1' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns success when other exit code but output shows success', async () => {
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'installer succeeded Some.App', code: '42' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when other exit code and output shows failure', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'installer failed Some.App', code: '42' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles invalid app ID format', async () => {
    const result = await runUpdates(['  '], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles execFileAsync error without stdout', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('winget crashed'))
      .mockRejectedValueOnce(new Error('winget crashed'))

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toContain('winget crashed')
  })

  it('retries with elevation when output indicates admin needed', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied: Some.App', code: '1' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'No updates available', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('handles elevation failure when UAC denied', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied: Some.App', code: '1' })
      .mockRejectedValueOnce(new Error('UAC denied'))
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles elevation check when app still needs upgrade', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Some.App 1.0.0 2.0.0 ready', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns specific error when install technology changed', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'install technology is different', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toContain('Installer type changed')
  })

  it('retries with --force on second failure', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'installer failed: version mismatch', code: '1' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded Some.App', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('truncates error messages longer than 200 chars', async () => {
    const longLine = `E:${'x'.repeat(300)}`
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: longLine, code: '1' })
      .mockRejectedValueOnce({ stdout: longLine, code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/\.\.\.$/)
    expect(result.errors[0]?.reason!.length).toBeLessThanOrEqual(203)
  })

  it('skips elevation when already admin', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
  })

  it('handles empty appIds array', async () => {
    const result = await runUpdates([], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})

// ─── runUpdates — win32: choco pipeline ─────────────────────

describe('runUpdates (win32) — choco', () => {
  beforeEach(() => {
    setPlatform('win32')
    isAdminMock.mockReturnValue(true)
  })

  it('upgrades app via choco successfully', async () => {
    execFileAsyncMock.mockResolvedValueOnce({ stdout: 'googlechrome was successful', stderr: '' })

    const result = await runUpdates(['googlechrome'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when choco output shows failure pattern', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'was not successful', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'installer failed', stderr: '' })

    const result = await runUpdates(['googlechrome'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles choco exec error without stdout', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('choco not found'))
      .mockRejectedValueOnce(new Error('choco not found'))

    const result = await runUpdates(['googlechrome'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles exec error with choco stdout', async () => {
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'choco was successful: some.pkg', message: 'exit 1', code: '1' })

    const result = await runUpdates(['some.pkg'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('rejects invalid choco package ID format', async () => {
    const result = await runUpdates(['../invalid'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('retries with elevation when output indicates admin needed', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'access to the path is denied', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await runUpdates(['some.pkg'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(1)
  })

  it('retries with --force when still failed after elevation', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'access to the path is denied', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'some.pkg|1.0.0|2.0.0|false\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'some.pkg was successful', stderr: '' })

    const result = await runUpdates(['some.pkg'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(1)
  })

  it('handles failed elevation and force retry', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'access to the path is denied', stderr: '' })
      .mockRejectedValueOnce(new Error('powershell denied'))
      .mockRejectedValueOnce({ stdout: 'installer failed', stderr: '' })

    const result = await runUpdates(['some.pkg'], vi.fn(), 'choco')
    expect(result.failed).toBe(1)
  })
})

// ─── runUpdates — win32: scoop pipeline ─────────────────────

describe('runUpdates (win32) — scoop', () => {
  beforeEach(() => setPlatform('win32'))

  it('upgrades app via scoop successfully', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'Updated 7zip', stderr: '' })

    const result = await runUpdates(['7zip'], vi.fn(), 'scoop')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('rejects invalid scoop package name format', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await runUpdates(['InvalidName'], vi.fn(), 'scoop')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('retries with --global on first failure', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('access denied'))
      .mockResolvedValueOnce({ stdout: 'Updated 7zip', stderr: '' })

    const result = await runUpdates(['7zip'], vi.fn(), 'scoop')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('retries with --force when --global also fails', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('access denied'))
      .mockRejectedValueOnce(new Error('still denied'))
      .mockResolvedValueOnce({ stdout: 'Updated 7zip', stderr: '' })

    const result = await runUpdates(['7zip'], vi.fn(), 'scoop')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when all retries exhausted', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('error 1'))
      .mockRejectedValueOnce(new Error('error 2'))
      .mockRejectedValueOnce(new Error('error 3'))

    const result = await runUpdates(['7zip'], vi.fn(), 'scoop')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles scoop exec error output', async () => {
    execFileAsyncMock.mockRejectedValue({ stdout: '', message: 'scoop update failed' })

    const result = await runUpdates(['7zip'], vi.fn(), 'scoop')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })
})

// ─── runUpdates — win32: fallback order ─────────────────────

describe('runUpdates (win32) — fallback', () => {
  beforeEach(() => setPlatform('win32'))

  it('tries winget first when no source specified and winget available', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn())
    expect(result.succeeded).toBe(1)
  })

  it('falls back to choco when winget unavailable', async () => {
    getSettingsMock.mockReturnValue({ windowsPackageManager: 'winget' })
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('winget not found'))
      .mockResolvedValueOnce({ stdout: 'choco 2.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'some.pkg was successful', stderr: '' })

    const result = await runUpdates(['some.pkg'], vi.fn())
    expect(result.succeeded).toBe(1)
  })

  it('falls back to scoop when winget and choco unavailable', async () => {
    execFileAsyncMock
      .mockRejectedValueOnce(new Error('winget not found'))
      .mockRejectedValueOnce(new Error('choco not found'))
      .mockResolvedValueOnce({ stdout: 'scoop v0.3', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Updated 7zip', stderr: '' })

    const result = await runUpdates(['7zip'], vi.fn())
    expect(result.succeeded).toBe(1)
  })

  it('returns all failed when no package manager available', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('not found'))

    const result = await runUpdates(['Some.App'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('No package manager available')
  })

  it('uses choco preferred order when settings specify it', async () => {
    getSettingsMock.mockReturnValue({ windowsPackageManager: 'choco' })
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'choco 2.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'some.pkg was successful', stderr: '' })

    const result = await runUpdates(['some.pkg'], vi.fn())
    expect(result.succeeded).toBe(1)
  })

  it('uses scoop preferred order when settings specify it', async () => {
    getSettingsMock.mockReturnValue({ windowsPackageManager: 'scoop' })
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'scoop v0.3', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Updated 7zip', stderr: '' })

    const result = await runUpdates(['7zip'], vi.fn())
    expect(result.succeeded).toBe(1)
  })
})
