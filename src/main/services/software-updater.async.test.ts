import { describe, it, expect, vi, beforeEach } from 'vitest'

const ORIG_PLATFORM = process.platform

vi.mock('./exec-utf8', () => ({
  execFileAsync: vi.fn(),
  psUtf8: vi.fn((s: string) => s),
}))

vi.mock('./elevation', () => ({
  isAdmin: () => false,
}))

vi.mock('./settings-store', () => ({
  getSettings: () => ({ windowsPackageManager: 'winget' }),
}))

function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

async function freshMod() {
  vi.resetModules()
  const mod = await import('./software-updater')
  return mod
}

// ─── checkForUpdates — win32 ────────────────────────────────

describe('checkForUpdates (win32)', () => {
  beforeEach(() => {
    setPlatform('win32')
  })

  it('returns winget updates when winget is available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const upgradeOutput = [
      'Name                     Id                              Version     Available   Source',
      '----------------------------------------------------------------------------------------',
      'Google Chrome            Google.Chrome                   120.0.1     121.0.0     winget',
      '2 upgrades available.',
    ].join('\n')
    const listOutput = [
      'Name              Id                    Version    Available  Source',
      '---------------------------------------------------------------------',
      'Google Chrome     Google.Chrome         121.0.0               winget',
      'Node.js           OpenJS.NodeJS         20.10.0               winget',
    ].join('\n')

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: upgradeOutput, stderr: '' })
      .mockResolvedValueOnce({ stdout: listOutput, stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerName).toBe('winget')
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].id).toBe('Google.Chrome')
    expect(result.totalCount).toBe(1)
    expect(result.majorCount).toBe(1)
  })

  it('returns empty when winget not available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('handles winget non-zero exit with stdout', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const upgradeOutput = [
      'Name    Id          Version     Available   Source',
      '----------------------------------------------------',
      'App     Some.App    1.0.0       2.0.0       winget',
    ].join('\n')

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: upgradeOutput, message: 'exit code 1' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
  })

  it('returns empty apps when winget has no stdout on error', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce(new Error('no output'))

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toEqual([])
  })
})

// ─── runUpdates — win32 ─────────────────────────────────────

describe('runUpdates (win32)', () => {
  beforeEach(() => setPlatform('win32'))

  it('upgrades apps via winget', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded Google.Chrome', stderr: '' })

    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('collects errors for failed upgrades', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed', message: 'installer failed', code: 1 } as any)
      .mockRejectedValueOnce(new Error('elevation failed'))
      .mockRejectedValueOnce({ stdout: 'installer failed', message: 'installer failed', code: 1 } as any)

    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('truncates error messages longer than 200 chars', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const longLine = 'E:' + 'x'.repeat(300)
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: longLine, message: 'exit code 1' })

    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toMatch(/\.\.\.$/)
    expect(result.errors[0].reason!.length).toBeLessThanOrEqual(203)
  })

  it('routes to choco when source is specified', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'googlechrome was successful', stderr: '' })
    const result = await mod.runUpdates(['googlechrome'], vi.fn(), 'choco')
    expect(result.succeeded).toBe(1)
  })

  it('routes to winget when source is specified', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'successfully upgraded', stderr: '' })
    const result = await mod.runUpdates(['Google.Chrome'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
  })

  it('returns all failed when no manager available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('No package manager available')
  })
})

// ─── checkForUpdates — darwin ───────────────────────────────

describe('checkForUpdates (darwin)', () => {
  beforeEach(() => setPlatform('darwin'))

  it('returns brew unavailable when brew not installed', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBe('brew')
  })

  it('returns brew updates when brew is available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const outdatedJson = JSON.stringify({
      formulae: [{ name: 'curl', installed_versions: ['7.87.0'], current_version: '8.0.0' }],
      casks: [],
    })
    const infoJson = JSON.stringify({
      formulae: [
        { name: 'curl', installed: [{ version: '7.87.0' }], versions: { stable: '8.0.0' } },
        { name: 'wget', installed: [{ version: '1.21' }], versions: { stable: '1.21' } },
      ],
      casks: [],
    })

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'Homebrew 4.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: outdatedJson, stderr: '' })
      .mockResolvedValueOnce({ stdout: infoJson, stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.packageManagerName).toBe('brew')
    expect(result.apps).toHaveLength(1)
  })
})

// ─── runUpdates — darwin ────────────────────────────────────

describe('runUpdates (darwin)', () => {
  beforeEach(() => setPlatform('darwin'))

  it('upgrades brew formula', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'Homebrew 4.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('reports failed brew upgrades', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'Homebrew 4.0', stderr: '' })
      .mockRejectedValueOnce(new Error('brew upgrade failed'))

    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })
})

// ─── checkForUpdates — linux ────────────────────────────────

describe('checkForUpdates (linux)', () => {
  beforeEach(() => setPlatform('linux'))

  it('returns apt updates when apt is available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const aptOutput = [
      'Listing... Done',
      'curl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]',
    ].join('\n')
    const dpkgOutput = 'curl\t7.81.0-1ubuntu1.15\ngit\t1:2.34.1-1ubuntu1.10\n'

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'apt 2.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: aptOutput, stderr: '' })
      .mockResolvedValueOnce({ stdout: dpkgOutput, stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerName).toBe('apt')
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0].id).toBe('curl')
  })

  it('returns no manager when no linux pm found', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBeNull()
  })
})

// ─── runUpdates — linux ─────────────────────────────────────

describe('runUpdates (linux)', () => {
  beforeEach(() => setPlatform('linux'))

  it('upgrades via apt', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'apt 2.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns 0 succeeded when no linux pm', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('collects errors for failed apt upgrades', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'apt 2.4', stderr: '' })
      .mockRejectedValueOnce(new Error('apt-get install failed'))

    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toContain('apt-get install failed')
  })

  it('rejects apps with invalid package name format', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'apt 2.4', stderr: '' })

    const result = await mod.runUpdates(['../../malicious'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('Invalid package name format')
  })
})

// ─── checkForUpdates — linux dnf ────────────────────────────

describe('checkForUpdates (linux dnf)', () => {
  beforeEach(() => setPlatform('linux'))

  it('returns dnf updates when dnf is available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ stdout: 'dnf 4.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'curl.x86_64 7.81.0 8.0.0 updates\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'curl\t7.81.0-1\n', stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.packageManagerName).toBe('dnf')
    expect(result.apps).toHaveLength(1)
  })
})

// ─── checkForUpdates — linux pacman ─────────────────────────

describe('checkForUpdates (linux pacman)', () => {
  beforeEach(() => setPlatform('linux'))

  it('returns pacman updates when pacman is available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ stdout: 'pacman 6.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'curl 7.81.0-1 -> 8.0.0-1\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'curl 7.81.0-1\n', stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.packageManagerName).toBe('pacman')
  })
})

// ─── runUpdates — linux dnf ─────────────────────────────────

describe('runUpdates (linux dnf)', () => {
  beforeEach(() => setPlatform('linux'))

  it('upgrades via dnf', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ stdout: 'dnf 4.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('upgrades via pacman', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ stdout: 'pacman 6.0', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const result = await mod.runUpdates(['curl'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })
})

// ─── unknown platform ─────────────────────────────────────

describe('checkForUpdates (unknown)', () => {
  beforeEach(() => setPlatform('android' as any))

  it('returns empty result', async () => {
    const mod = await freshMod()
    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBeNull()
  })
})

describe('runUpdates (unknown)', () => {
  beforeEach(() => setPlatform('android' as any))

  it('returns empty result', async () => {
    const mod = await freshMod()
    const result = await mod.runUpdates([], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})
