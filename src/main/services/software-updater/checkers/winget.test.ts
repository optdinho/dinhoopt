import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdatesWinget, parseWingetListOutput, parseWingetUpgradeOutput, runUpdatesWinget } from './winget'

const execFileAsyncMock = vi.hoisted(() => vi.fn())
const psUtf8Mock = vi.hoisted(() => vi.fn((s: string) => s))

vi.mock('../../exec-utf8', () => ({
  execFileAsync: execFileAsyncMock,
  psUtf8: psUtf8Mock,
}))

const isAdminMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../elevation', () => ({
  isAdmin: isAdminMock,
}))

const stripTrailingVersionMock = vi.hoisted(() => vi.fn((s: string) => s))
vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    stripTrailingVersion: stripTrailingVersionMock,
  }
})

const upgradeHeader = 'Name               Id                   Version           Available        Source'
const upgradeSeparator = '--------------------------------------------------'

function padUpgradeCols(name: string, id: string, version: string, available: string, source: string): string {
  return `${name.padEnd(19)}${id.padEnd(21)}${version.padEnd(18)}${available.padEnd(17)}${source}`
}

const listHeader = 'Name               Id                   Version           Available        Source'
const listSeparator = '--------------------------------------------------'

function padListCols(name: string, id: string, version: string, source: string): string {
  return `${name.padEnd(19)}${id.padEnd(21)}${version.padEnd(35)}${source}`
}

beforeEach(() => {
  vi.clearAllMocks()
  execFileAsyncMock.mockReset()
})

// ─── parseWingetUpgradeOutput ────────────────────────────────

describe('parseWingetUpgradeOutput', () => {
  it('parses normal output', () => {
    const output = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('7-Zip', '7zip.7zip', '24.01', '24.03', 'winget'),
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('7zip.7zip')
  })

  it('returns empty when no separator after header', () => {
    const output = [upgradeHeader].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toEqual([])
  })

  it('returns empty when separator does not match (===)', () => {
    const output = [upgradeHeader, '=================================================='].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toEqual([])
  })

  it('handles header without Source column (localized output)', () => {
    const headerNoSource = 'Name               Id                   Version           Available'
    const line = `${'App'.padEnd(19)}${'Some.App'.padEnd(21)}${'1.0.0'.padEnd(18)}2.0.0`
    const output = [headerNoSource, upgradeSeparator, line].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('winget')
  })

  it('returns empty when Id column is missing from header', () => {
    const badHeader = 'Name               Version              Available         Source'
    const output = [badHeader, upgradeSeparator].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toEqual([])
  })

  it('skips whitespace-only data lines', () => {
    const output = [
      upgradeHeader,
      upgradeSeparator,
      '   ',
      padUpgradeCols('App', 'Some.App', '1.0.0', '2.0.0', 'winget'),
    ].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toHaveLength(1)
  })

  it('strips < prefix from version', () => {
    const output = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('MyApp', 'MyApp.MyApp', '< 1.0.0', '2.0.0', 'winget'),
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.currentVersion).toBe('1.0.0')
  })

  it('strips > prefix from available', () => {
    const output = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('MyApp', 'MyApp.MyApp', '1.0.0', '> 2.0.0', 'winget'),
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.availableVersion).toBe('2.0.0')
  })

  it('skips entries with empty id', () => {
    const output = [upgradeHeader, upgradeSeparator, padUpgradeCols('NoId', '', '1.0.0', '2.0.0', 'winget')].join(
      '\r\n',
    )
    expect(parseWingetUpgradeOutput(output)).toHaveLength(0)
  })

  it('skips entries with empty version', () => {
    const output = [upgradeHeader, upgradeSeparator, padUpgradeCols('NoVer', 'Some.App', '', '2.0.0', 'winget')].join(
      '\r\n',
    )
    expect(parseWingetUpgradeOutput(output)).toHaveLength(0)
  })

  it('skips entries with empty available', () => {
    const output = [upgradeHeader, upgradeSeparator, padUpgradeCols('NoAvail', 'Some.App', '1.0.0', '', 'winget')].join(
      '\r\n',
    )
    expect(parseWingetUpgradeOutput(output)).toHaveLength(0)
  })

  it('uses "winget" as source when source column is empty', () => {
    const output = [upgradeHeader, upgradeSeparator, padUpgradeCols('App', 'Some.App', '1.0.0', '2.0.0', '')].join(
      '\r\n',
    )
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.source).toBe('winget')
  })

  it('uses id as name when stripTrailingVersion returns empty', () => {
    stripTrailingVersionMock.mockReturnValueOnce('')
    const output = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('SomeApp', 'Some.App', '1.0.0', '2.0.0', 'winget'),
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.name).toBe('Some.App')
  })

  it('parses Portuguese (PT-BR) localized header', () => {
    const ptHeader = 'Nome                 Id                   Vers\u00e3o              Dispon\u00edvel         Origem'
    const dataLine = 'App                  Some.App             1.0.0               2.0.0               winget'
    const output = [ptHeader, upgradeSeparator, dataLine].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('Some.App')
    expect(result[0]?.currentVersion).toBe('1.0.0')
    expect(result[0]?.availableVersion).toBe('2.0.0')
    expect(result[0]?.source).toBe('winget')
  })

  it('parses Portuguese header with uppercase ID (real winget output)', () => {
    const ptHeader =
      'Nome                                                               ID                            Vers\u00e3o                        Dispon\u00edvel                    Origem'
    const sep = '-'.repeat(191)
    const dataLine =
      '7-Zip 24.08 (x64)                                                  7zip.7zip                     24.08                         26.02                         winget'
    const output = [ptHeader, sep, dataLine].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('7zip.7zip')
    expect(result[0]?.currentVersion).toBe('24.08')
    expect(result[0]?.availableVersion).toBe('26.02')
    expect(result[0]?.source).toBe('winget')
  })

  it('parses Spanish (ES) localized header', () => {
    const esHeader = 'Nombre               Id                   Versi\u00f3n             Disponible          Origen'
    const dataLine = 'App                  Some.App             1.0.0               2.0.0               winget'
    const output = [esHeader, upgradeSeparator, dataLine].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('Some.App')
    expect(result[0]?.availableVersion).toBe('2.0.0')
  })
})

// ─── parseWingetListOutput ───────────────────────────────────

describe('parseWingetListOutput', () => {
  it('parses normal list output', () => {
    const output = [
      listHeader,
      listSeparator,
      padListCols('7-Zip', '7zip.7zip', '24.03', 'winget'),
      '',
      '42 packages.',
    ].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('7zip.7zip')
  })

  it('handles empty lines before header', () => {
    const output = ['', '', listHeader, listSeparator, padListCols('App', 'Some.App', '2.0.0', 'winget')].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
  })

  it('returns empty when header regex does not match', () => {
    const output = ['Name    Version    Source', '-----------------------', 'App     1.0.0      winget'].join('\r\n')
    expect(parseWingetListOutput(output)).toEqual([])
  })

  it('returns empty when no header found', () => {
    expect(parseWingetListOutput('no header')).toEqual([])
  })

  it('returns empty for empty output', () => {
    expect(parseWingetListOutput('')).toEqual([])
  })

  it('returns empty when no separator after header', () => {
    const output = [listHeader].join('\r\n')
    expect(parseWingetListOutput(output)).toEqual([])
  })

  it('returns empty when separator does not match', () => {
    const output = [listHeader, '=================================================='].join('\r\n')
    expect(parseWingetListOutput(output)).toEqual([])
  })

  it('returns empty when id column is missing from header', () => {
    const badHeader = 'Name               Version'
    const output = [badHeader, upgradeSeparator].join('\r\n')
    expect(parseWingetListOutput(output)).toEqual([])
  })

  it('returns empty when version column is missing from header', () => {
    const badHeader = 'Name               Id                   Available'
    const output = [badHeader, upgradeSeparator].join('\r\n')
    expect(parseWingetListOutput(output)).toEqual([])
  })

  it('handles both availableStart and sourceStart <= 0 (versionEnd = -1)', () => {
    const header = 'Name               Id                   Version'
    const separator = '--------------------------------------------------'
    const line = `${'App'.padEnd(19)}${'Some.App'.padEnd(21)}1.0.0`
    const output = [header, separator, line].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.currentVersion).toBe('1.0.0')
  })

  it('skips whitespace-only data lines', () => {
    const output = [listHeader, listSeparator, '   ', padListCols('App', 'Some.App', '2.0.0', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(1)
  })

  it('strips > prefix from version', () => {
    const output = [listHeader, listSeparator, padListCols('MyApp', 'MyApp.MyApp', '> 1.0.0', 'winget')].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result[0]?.currentVersion).toBe('1.0.0')
  })

  it('strips < prefix from version', () => {
    const output = [listHeader, listSeparator, padListCols('MyApp', 'MyApp.MyApp', '< 1.0.0', 'winget')].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result[0]?.currentVersion).toBe('1.0.0')
  })

  it('uses winget as source when source column is absent', () => {
    const header = 'Name               Id                   Version           Available'
    const separator = '--------------------------------------------------'
    const line = padUpgradeCols('App', 'Some.App', '1.0.0', '2.0.0', '')
    const output = [header, separator, line].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result[0]?.source).toBe('winget')
  })

  it('uses id as name when stripTrailingVersion returns empty', () => {
    stripTrailingVersionMock.mockReturnValueOnce('')
    const output = [listHeader, listSeparator, padListCols('SomeName', 'Some.App', '2.0.0', 'winget')].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result[0]?.name).toBe('Some.App')
  })

  it('parses Portuguese (PT-BR) localized list header', () => {
    const ptHeader = 'Nome                 Id                   Vers\u00e3o              Dispon\u00edvel         Origem'
    const dataLine = 'App                  Some.App             2.0.0                                        winget'
    const output = [ptHeader, listSeparator, dataLine].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('Some.App')
    expect(result[0]?.currentVersion).toBe('2.0.0')
    expect(result[0]?.source).toBe('winget')
  })

  it('parses Portuguese list header with uppercase ID (real winget output)', () => {
    const ptHeader =
      'Nome                                                                ID                                                                                  Vers\u00e3o                        Dispon\u00edvel                    Origem'
    const sep = '-'.repeat(219)
    const dataLine =
      '7-Zip 24.08 (x64)                                                   7zip.7zip                                                                           24.08                         26.02                         winget'
    const output = [ptHeader, sep, dataLine].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('7zip.7zip')
    expect(result[0]?.currentVersion).toBe('24.08')
    expect(result[0]?.source).toBe('winget')
  })

  it('parses header without Available or Source columns', () => {
    const headerMinimal = 'Name               Id                   Version'
    const line = `${'App'.padEnd(19)}${'Some.App'.padEnd(21)}2.0.0`
    const output = [headerMinimal, listSeparator, line].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0]?.currentVersion).toBe('2.0.0')
    expect(result[0]?.source).toBe('winget')
  })
})

// ─── checkForUpdatesWinget ───────────────────────────────────

describe('checkForUpdatesWinget', () => {
  it('returns empty when winget not available', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('not found'))
    const result = await checkForUpdatesWinget()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBe('winget')
  })

  it('returns parsed updates when winget succeeds', async () => {
    const upgradeOutput = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('App', 'Some.App', '1.0.0', '2.0.0', 'winget'),
    ].join('\n')

    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: upgradeOutput, stderr: '' })

    const result = await checkForUpdatesWinget()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.totalCount).toBe(1)
    expect(result.majorCount).toBe(1)
  })

  it('handles winget upgrade non-zero exit with stdout', async () => {
    const upgradeOutput = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('App', 'Some.App', '1.0.0', '2.0.0', 'winget'),
    ].join('\n')

    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: upgradeOutput, message: 'exit 1', code: '1' })

    const result = await checkForUpdatesWinget()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.totalCount).toBe(1)
  })

  it('handles winget upgrade error without stdout', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce(new Error('no output'))

    const result = await checkForUpdatesWinget()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toEqual([])
  })
})

// ─── runUpdatesWinget ────────────────────────────────────────

describe('runUpdatesWinget', () => {
  function noopProgress() {
    // no-op progress callback
  }

  it('upgrades app successfully', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockResolvedValue({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('handles empty appIds array', async () => {
    const result = await runUpdatesWinget([], noopProgress)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('handles execFileAsync error with empty message (e?.message is "")', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValue({ stdout: '', message: '' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('Unknown error')
  })

  it('handles execFileAsync error without stdout (else branch)', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValue(new Error('winget crashed'))

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toContain('winget crashed')
  })

  it('retries with elevation and handles empty message from powershell', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockRejectedValueOnce({ message: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('Elevated upgrade failed')
  })

  it('produces "Upgrade failed" when result output is whitespace-only', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValue({ stdout: ' ', message: '' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
  })

  it('handles exit code 0 with failure pattern', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'installer failed: Some.App', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns success when exit code 1 with success pattern', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'successfully upgraded Some.App', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns success when other exit code with success pattern', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'installer succeeded Some.App', code: '42' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when other exit code with failure pattern', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'installer failed Some.App', code: '42' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns specific error for install technology changed', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValueOnce({ stdout: 'install technology is different', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toContain('Installer type changed')
  })

  it('truncates error messages longer than 200 chars', async () => {
    isAdminMock.mockReturnValue(true)
    const longLine = `E:${'x'.repeat(300)}`
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: longLine, code: '1' })
      .mockRejectedValueOnce({ stdout: longLine, code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/\.\.\.$/)
  })

  it('invalid app ID returns failure', async () => {
    const result = await runUpdatesWinget(['  '], noopProgress)
    expect(result.failed).toBe(1)
  })

  it('handles elevation and still needs upgrade', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Some.App 1.0.0 2.0.0 ready', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
  })

  it('handles elevation failure when UAC denied', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied: Some.App', code: '1' })
      .mockRejectedValueOnce(new Error('UAC denied'))
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.failed).toBe(1)
  })

  it('skips elevation when already admin', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(1)
  })

  it('retries with --force on second failure', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'installer failed: version mismatch', code: '1' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded Some.App', stderr: '' })

    const result = await runUpdatesWinget(['Some.App'], noopProgress)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })
})

// ─── parseWingetUpgradeOutput (edge cases) ───────────────────

describe('parseWingetUpgradeOutput (edge cases)', () => {
  it('returns empty when header line is empty/falsy', () => {
    const output = ['', upgradeSeparator, padUpgradeCols('App', 'Some.App', '1.0.0', '2.0.0', 'winget')].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toEqual([])
  })

  it('skips entries where version equals available version', () => {
    const output = [
      upgradeHeader,
      upgradeSeparator,
      padUpgradeCols('App', 'Some.App', '1.0.0', '1.0.0', 'winget'),
    ].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toHaveLength(0)
  })
})

// ─── parseWingetListOutput (edge cases) ──────────────────────

describe('parseWingetListOutput (edge cases)', () => {
  it('returns empty when header line is empty/falsy', () => {
    const output = ['', listSeparator, padListCols('App', 'Some.App', '2.0.0', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toEqual([])
  })

  it('skips entries with version "Unknown"', () => {
    const output = [listHeader, listSeparator, padListCols('App', 'Some.App', 'Unknown', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })

  it('skips ARP prefixed IDs', () => {
    const output = [listHeader, listSeparator, padListCols('App', 'ARP\\Some.App', '2.0.0', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })

  it('stops at summary line with packages count', () => {
    const output = [
      listHeader,
      listSeparator,
      padListCols('App', 'Some.App', '2.0.0', 'winget'),
      '',
      '12 packages.',
    ].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(1)
  })
})

// ─── attemptElevatedUpgrade (edge cases) ─────────────────────

describe('attemptElevatedUpgrade (edge cases)', () => {
  it('returns failure for invalid app ID format', async () => {
    const noop = () => {}
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock.mockRejectedValue({ stdout: 'access is denied', code: '1' })

    const result = await runUpdatesWinget([''], noop)
    expect(result.failed).toBe(1)
  })
})
