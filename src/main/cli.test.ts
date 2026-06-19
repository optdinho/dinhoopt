import { beforeEach, describe, expect, it, vi } from 'vitest'

let appExitMock: (...args: unknown[]) => void

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\test',
    getName: () => 'DiNho',
    getVersion: () => '1.0.0',
    exit: (...args: unknown[]) => appExitMock(...args),
  },
}))

vi.mock('../shared/enums', () => ({
  CleanerType: {
    System: 'system',
    Browser: 'browser',
    App: 'app',
    Gaming: 'gaming',
    RecycleBin: 'recycleBin',
    UninstallLeftovers: 'uninstallLeftovers',
    Shortcut: 'shortcut',
    Database: 'database',
    Environment: 'environment',
    WinSxS: 'winSxS',
  },
}))

vi.mock('./platform', () => ({
  getPlatform: () => ({ paths: {} }),
}))

vi.mock('./services/exec-utf8', () => ({
  psUtf8: (s: string) => s,
}))

vi.mock('./services/file-utils', () => ({
  cleanItems: vi.fn(),
  resolveChildSubdirs: vi.fn(),
  scanDirectoriesAsItems: vi.fn(),
  scanDirectory: vi.fn(),
  scanFile: vi.fn(),
  scanMultipleDirectories: vi.fn(),
}))

vi.mock('./services/scan-cache', () => ({
  cacheItems: vi.fn(),
}))

beforeEach(() => {
  appExitMock = vi.fn()
  vi.resetModules()
})

describe('ExitCode', () => {
  it('has correct values', async () => {
    const { ExitCode } = await import('./cli')
    expect(ExitCode.SUCCESS).toBe(0)
    expect(ExitCode.GENERAL_ERROR).toBe(1)
    expect(ExitCode.INVALID_ARGS).toBe(2)
    expect(ExitCode.PERMISSION_DENIED).toBe(3)
    expect(ExitCode.PARTIAL_SUCCESS).toBe(4)
    expect(ExitCode.NOTHING_FOUND).toBe(5)
    expect(ExitCode.UNKNOWN_COMMAND).toBe(6)
    expect(ExitCode.SCAN_THREATS).toBe(7)
  })

  it('has no extra properties', async () => {
    const { ExitCode } = await import('./cli')
    expect(Object.keys(ExitCode)).toEqual([
      'SUCCESS',
      'GENERAL_ERROR',
      'INVALID_ARGS',
      'PERMISSION_DENIED',
      'PARTIAL_SUCCESS',
      'NOTHING_FOUND',
      'UNKNOWN_COMMAND',
      'SCAN_THREATS',
    ])
  })
})

describe('parseCliArgs', () => {
  // ── No --cli present ────────────────────────────────────────

  it('handles empty argv', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs([])
    expect(result.command).toBeUndefined()
    expect(result.commandArgs).toEqual([])
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
    expect(result.help).toBe(false)
    expect(result.version).toBe(false)
    expect(result.hasLegacyFlags).toBe(false)
    expect(result.hasCleanFlag).toBe(false)
  })

  it('handles argv without --cli', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['node', 'script.js', '--some-flag'])
    expect(result.command).toBe('node')
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
  })

  // ── --cli with no / empty args ──────────────────────────────

  it('handles --cli with no additional args', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli'])
    expect(result.command).toBeUndefined()
    expect(result.commandArgs).toEqual([])
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
    expect(result.help).toBe(false)
    expect(result.version).toBe(false)
    expect(result.hasLegacyFlags).toBe(false)
    expect(result.hasCleanFlag).toBe(false)
  })

  it('handles --cli as the last arg with nothing after', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['node', 'script.js', '--cli'])
    expect(result.command).toBeUndefined()
    expect(result.commandArgs).toEqual([])
  })

  // ── Global flags ────────────────────────────────────────────

  it('parses --json flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json'])
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('normal')
  })

  it('parses --verbose flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--verbose'])
    expect(result.ctx.verbosity).toBe('verbose')
    expect(result.ctx.json).toBe(false)
  })

  it('parses --quiet flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--quiet'])
    expect(result.ctx.verbosity).toBe('quiet')
  })

  it('parses -q flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-q'])
    expect(result.ctx.verbosity).toBe('quiet')
  })

  it('parses --help flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--help'])
    expect(result.help).toBe(true)
  })

  it('parses -h flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-h'])
    expect(result.help).toBe(true)
  })

  it('parses --version flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--version'])
    expect(result.version).toBe(true)
  })

  it('parses -v flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-v'])
    expect(result.version).toBe(true)
  })

  // ── Verbosity precedence ────────────────────────────────────

  it('--verbose takes precedence over --quiet', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--verbose', '--quiet'])
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('--verbose takes precedence over -q', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-q', '--verbose'])
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('--quiet gives quiet verbosity when --verbose absent', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--quiet', '--json'])
    expect(result.ctx.verbosity).toBe('quiet')
    expect(result.ctx.json).toBe(true)
  })

  // ── Command extraction ──────────────────────────────────────

  it('extracts command as first non-flag arg', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan'])
    expect(result.command).toBe('scan')
  })

  it('extracts command after global flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--verbose', 'registry'])
    expect(result.command).toBe('registry')
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('returns undefined command when only flags present', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--help'])
    expect(result.command).toBeUndefined()
  })

  it('returns undefined command for single-dash unknown flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-x'])
    expect(result.command).toBeUndefined()
  })

  it('returns undefined command for bare double-dash', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--'])
    expect(result.command).toBeUndefined()
  })

  // ── Command args filtering ──────────────────────────────────

  it('filters global flags from commandArgs', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'registry', 'scan', '--json', '--verbose'])
    expect(result.command).toBe('registry')
    expect(result.commandArgs).toEqual(['scan'])
  })

  it('preserves non-global flags in commandArgs', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'malware', 'quarantine', '/some/path', '--json'])
    expect(result.command).toBe('malware')
    expect(result.commandArgs).toEqual(['quarantine', '/some/path'])
  })

  it('includes --all and --clean in commandArgs', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'drivers', 'update', '--all'])
    expect(result.commandArgs).toEqual(['update', '--all'])
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('extracts multiple positional args', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'config', 'set', 'theme.dark', 'true'])
    expect(result.command).toBe('config')
    expect(result.commandArgs).toEqual(['set', 'theme.dark', 'true'])
  })

  it('handles subcommand as first command arg', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'startup', 'list', '--json'])
    expect(result.command).toBe('startup')
    expect(result.commandArgs).toEqual(['list'])
    expect(result.ctx.json).toBe(true)
  })

  // ── Legacy flags ────────────────────────────────────────────

  it.each([
    ['--system', ['system']],
    ['--browser', ['browser']],
    ['--app', ['app']],
    ['--gaming', ['gaming']],
    ['--recycle-bin', ['recycle-bin']],
  ])('detects legacy flag %s', async (flag, _cats) => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', flag])
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('detects --all as legacy flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--all'])
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('hasLegacyFlags is false when no legacy flag present', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  it('hasLegacyFlags is false with only global flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--verbose'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  it('hasLegacyFlags is false with unknown command flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--unknown'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  // ── Clean flag ──────────────────────────────────────────────

  it('detects --clean flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--clean'])
    expect(result.hasCleanFlag).toBe(true)
  })

  it('hasCleanFlag is false without --clean', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--all'])
    expect(result.hasCleanFlag).toBe(false)
  })

  it('hasCleanFlag with command presence', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan', '--clean'])
    expect(result.hasCleanFlag).toBe(true)
    expect(result.command).toBe('scan')
  })

  // ── Combined scenarios ──────────────────────────────────────

  it('parses scan --system --clean --json', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan', '--system', '--clean', '--json'])
    expect(result.command).toBe('scan')
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('normal')
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.hasCleanFlag).toBe(true)
  })

  it('parses --all --clean --verbose', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--all', '--clean', '--verbose'])
    expect(result.command).toBeUndefined()
    expect(result.ctx.verbosity).toBe('verbose')
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.hasCleanFlag).toBe(true)
  })

  it('parses registry scan --json with all globals', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'registry', 'scan', '--json', '--verbose'])
    expect(result.command).toBe('registry')
    expect(result.commandArgs).toEqual(['scan'])
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('verbose')
    expect(result.help).toBe(false)
    expect(result.version).toBe(false)
  })

  it('parses --help --version together (both true)', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--help', '-v'])
    expect(result.help).toBe(true)
    expect(result.version).toBe(true)
  })

  it('parses real-world example: malware scan', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'malware', 'scan'])
    expect(result.command).toBe('malware')
    expect(result.commandArgs).toEqual(['scan'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  it('parses real-world example: perf info --json', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'perf', 'info', '--json'])
    expect(result.command).toBe('perf')
    expect(result.commandArgs).toEqual(['info'])
    expect(result.ctx.json).toBe(true)
  })

  it('parses real-world example: debloat remove pkg1,pkg2', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'debloat', 'remove', 'pkg1,pkg2'])
    expect(result.command).toBe('debloat')
    expect(result.commandArgs).toEqual(['remove', 'pkg1,pkg2'])
  })

  it('parses real-world example: drivers update --all --json', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'drivers', 'update', '--all', '--json'])
    expect(result.command).toBe('drivers')
    expect(result.commandArgs).toEqual(['update', '--all'])
    expect(result.ctx.json).toBe(true)
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('parses commands with multiple legacy flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--system', '--browser', '--app', '--json'])
    expect(result.command).toBeUndefined()
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.ctx.json).toBe(true)
  })

  // ── Edge cases ──────────────────────────────────────────────

  it('handles duplicate flags without error', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--json', '--verbose', '--verbose'])
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('treats non-flag tokens after unknown flags as command', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--port', '9100'])
    expect(result.command).toBe('9100')
    expect(result.commandArgs).toEqual(['--port'])
  })

  it('handles --cli at start of process.argv', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan', '--system', '--clean'])
    expect(result.command).toBe('scan')
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.hasCleanFlag).toBe(true)
  })

  it('handles only --cli and a command with no flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'leftovers', 'scan'])
    expect(result.command).toBe('leftovers')
    expect(result.commandArgs).toEqual(['scan'])
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
  })
})

describe('runCli', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>
  let stderrWrite: ReturnType<typeof vi.fn>
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv
    appExitMock = vi.fn()
    stdoutWrite = vi.fn()
    stderrWrite = vi.fn()
    process.stdout.write = stdoutWrite
    process.stderr.write = stderrWrite
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it('prints help and exits with SUCCESS when --help is passed', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--help']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('DiNho CLI'))
  })

  it('prints version and exits with SUCCESS when --version is passed', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--version']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('DiNho v1.0.0'))
  })

  it('exits with INVALID_ARGS when --verbose and --quiet conflict and --json is set', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--verbose', '--quiet', '--json']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(2)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('invalid_args'))
  })

  it('exits with INVALID_ARGS when --verbose and -q conflict without JSON', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--verbose', '-q']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(2)
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'))
  })

  it('exits with UNKNOWN_COMMAND for unrecognized command', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'nonexistent']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(6)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Unknown command'))
  })

  it('runs legacy scan with --all and exits with NOTHING_FOUND', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--all']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('runs legacy scan with --system and exits with NOTHING_FOUND', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--system']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('handles scan command with --all --clean and shows results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'scan', '--system', '--clean']
    const { runCli } = await import('./cli')

    await runCli()

    // Legacy scan with system and clean should return nothing found
    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('handles clean command with --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'clean', '--all', '--json']
    const { runCli } = await import('./cli')

    await runCli()

    // Clean with all categories via JSON
    expect(appExitMock).toHaveBeenCalledWith(5)
  })
})
