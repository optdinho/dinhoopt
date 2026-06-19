import { describe, expect, it } from 'vitest'
import {
  BREW_PATH_CANDIDATES,
  cleanOutput,
  computeSeverity,
  parseAptUpgradable,
  parseBrewInstalledJson,
  parseBrewOutdatedJson,
  parseChocoListOutput,
  parseChocoOutdatedOutput,
  parseDnfCheckUpdate,
  parseDpkgInstalled,
  parsePacmanQu,
  parseScoopListOutput,
  parseScoopStatusOutput,
  parseWingetListOutput,
  parseWingetUpgradeOutput,
  stripTrailingVersion,
} from './software-updater'

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

describe('BREW_PATH_CANDIDATES', () => {
  it('includes Apple Silicon path first', () => {
    expect(BREW_PATH_CANDIDATES[0]).toBe('/opt/homebrew/bin/brew')
  })

  it('includes Intel path second', () => {
    expect(BREW_PATH_CANDIDATES[1]).toBe('/usr/local/bin/brew')
  })

  it('includes PATH fallback last', () => {
    expect(BREW_PATH_CANDIDATES[2]).toBe('brew')
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
    const output = [
      header,
      separator,
      padCols('MyApp', 'MyApp.MyApp', '> 1.0.0', '< 2.0.0', 'winget'),
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.currentVersion).toBe('1.0.0')
    expect(result[0]?.availableVersion).toBe('2.0.0')
  })

  it('skips apps where installed version equals available', () => {
    const output = [
      header,
      separator,
      padCols('SameApp', 'Same.Id', '1.0.0', '1.0.0', 'winget'),
    ].join('\r\n')
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
    const output = [
      header,
      separator,
      padCols('OldApp', 'ARP\\OldApp', '1.0.0', 'winget'),
    ].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })

  it('skips unknown version', () => {
    const output = [
      header,
      separator,
      padCols('Unknown', 'Unknown.Id', 'Unknown', 'winget'),
    ].join('\r\n')
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

describe('parseBrewOutdatedJson', () => {
  it('parses brew outdated JSON', () => {
    const json = JSON.stringify({
      formulae: [
        { name: 'curl', installed_versions: ['8.0.1'], current_version: '8.1.0' },
        { name: 'git', installed_versions: ['2.40.0'], current_version: '2.41.0' },
      ],
      casks: [
        { name: 'firefox', token: 'firefox', installed_versions: '120.0', current_version: '121.0' },
      ],
    })
    const result = parseBrewOutdatedJson(json)
    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe('curl')
    expect(result[0]?.currentVersion).toBe('8.0.1')
    expect(result[0]?.availableVersion).toBe('8.1.0')
    expect(result[0]?.severity).toBe('minor')
    expect(result[2]?.id).toBe('firefox')
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseBrewOutdatedJson('not json')).toEqual([])
  })
})

describe('parseBrewInstalledJson', () => {
  it('parses brew installed JSON', () => {
    const json = JSON.stringify({
      formulae: [
        { name: 'curl', installed: [{ version: '8.0.1' }], versions: { stable: '8.0.1' } },
      ],
      casks: [
        { token: 'firefox', installed: '120.0', version: '120.0' },
      ],
    })
    const result = parseBrewInstalledJson(json)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('curl')
    expect(result[0]?.isUpToDate).toBe(true)
    expect(result[1]?.id).toBe('firefox')
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseBrewInstalledJson('not json')).toEqual([])
  })
})

describe('parseAptUpgradable', () => {
  it('parses apt list --upgradable output', () => {
    const output = [
      'Listing...',
      'curl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]',
      'libssl3/jammy-updates 3.0.2-0ubuntu1.12 amd64 [upgradable from: 3.0.2-0ubuntu1.11]',
    ].join('\n')
    const result = parseAptUpgradable(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('curl')
    expect(result[0]?.currentVersion).toBe('7.81.0-1ubuntu1.15')
    expect(result[0]?.availableVersion).toBe('7.81.0-1ubuntu1.16')
  })

  it('returns empty array for empty output', () => {
    expect(parseAptUpgradable('')).toEqual([])
  })
})

describe('parseDpkgInstalled', () => {
  it('parses dpkg-query output', () => {
    const output = 'curl\t7.81.0-1ubuntu1.15\nlibssl3\t3.0.2-0ubuntu1.11\n'
    const result = parseDpkgInstalled(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('curl')
    expect(result[0]?.currentVersion).toBe('7.81.0-1ubuntu1.15')
    expect(result[0]?.isUpToDate).toBe(true)
  })

  it('returns empty array for empty output', () => {
    expect(parseDpkgInstalled('')).toEqual([])
  })
})

describe('parseDnfCheckUpdate', () => {
  it('parses dnf check-update output', () => {
    const output = [
      'curl.x86_64    7.76.1-23.el9    baseos',
      'libxml2.x86_64    2.9.13-6.el9    appstream',
    ].join('\n')
    const result = parseDnfCheckUpdate(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('curl')
    expect(result[0]?.availableVersion).toBe('7.76.1-23.el9')
  })

  it('skips metadata lines', () => {
    const output = 'Last metadata expiration check: 1:00:00 ago\ncurl.x86_64    7.76.1-23.el9    baseos\n'
    const result = parseDnfCheckUpdate(output)
    expect(result).toHaveLength(1)
  })
})

describe('parsePacmanQu', () => {
  it('parses pacman -Qu output', () => {
    const output = 'curl 7.87.0-1 -> 7.88.0-1\nfirefox 120.0-1 -> 121.0-1\n'
    const result = parsePacmanQu(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('curl')
    expect(result[0]?.currentVersion).toBe('7.87.0-1')
    expect(result[0]?.availableVersion).toBe('7.88.0-1')
    expect(result[0]?.severity).toBe('minor')
  })

  it('returns empty array for empty output', () => {
    expect(parsePacmanQu('')).toEqual([])
  })
})
