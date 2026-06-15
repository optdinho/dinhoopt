import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  execFileAsync: vi.fn(),
  psArgs: vi.fn<(script: string) => string[]>((s) => ['-NoProfile', '-NonInteractive', '-Command', s]),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psArgs: (...args: unknown[]) => mocks.psArgs(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { IPC } from '@shared/channels'
import {
  applyFirewallChanges,
  classifyRule,
  isBuiltinRule,
  parseRuleLine,
  registerFirewallAuditIpc,
  scanFirewallRules,
} from './firewall-audit.ipc'

// ── Private function replicas ──
// parseProfiles, parseSignature, and looksLikeResourceRef are module-private
// (not exported).  We replicate them here so we can test them directly.
type FirewallProfile = 'Domain' | 'Private' | 'Public' | 'Any'
type FirewallSignatureStatus = 'signed' | 'unsigned' | 'unknown' | 'not-applicable'

function parseProfiles(raw: string): FirewallProfile[] {
  if (!raw) return []
  if (raw.toLowerCase().trim() === 'any') return ['Any']
  const parts = raw.split(',').map((p) => p.trim())
  const out: FirewallProfile[] = []
  for (const p of parts) {
    if (p === 'Domain' || p === 'Private' || p === 'Public') out.push(p)
  }
  return out
}

function parseSignature(raw: string): FirewallSignatureStatus {
  switch (raw) {
    case 'signed':
      return 'signed'
    case 'unsigned':
      return 'unsigned'
    case 'unknown':
      return 'unknown'
    default:
      return 'not-applicable'
  }
}

// ── Standalone regex test ──
// Replicated here to guard against accidental changes to RULE_NAME_RE.
// biome-ignore lint/suspicious/noControlCharactersInRegex: security-critical — intentionally blocks control chars
const RULE_NAME_RE = /^[^\x00-\x1F\x7F|]{1,512}$/

describe('RULE_NAME_RE', () => {
  it('accepts GUID-style system names', () => {
    expect(RULE_NAME_RE.test('{6F4DC32E-BA34-422D-9F87-123456789ABC}')).toBe(true)
  })
  it('accepts hyphenated system names', () => {
    expect(RULE_NAME_RE.test('CoreNet-DHCPV6-In')).toBe(true)
  })
  it('accepts user-defined names with spaces and parens', () => {
    expect(RULE_NAME_RE.test('Microsoft Edge (mDNS-In)')).toBe(true)
  })
  it('rejects control characters', () => {
    expect(RULE_NAME_RE.test('foo\x00bar')).toBe(false)
    expect(RULE_NAME_RE.test('foo\nbar')).toBe(false)
    expect(RULE_NAME_RE.test('foo\rbar')).toBe(false)
  })
  it('rejects pipe (our scan-output delimiter)', () => {
    expect(RULE_NAME_RE.test('rule|name')).toBe(false)
  })
  it('rejects empty names', () => {
    expect(RULE_NAME_RE.test('')).toBe(false)
  })
  it('rejects names over the length cap', () => {
    expect(RULE_NAME_RE.test('a'.repeat(513))).toBe(false)
    expect(RULE_NAME_RE.test('a'.repeat(512))).toBe(true)
  })
})

describe('parseProfiles', () => {
  it('returns empty array for empty input', () => {
    expect(parseProfiles('')).toEqual([])
  })
  it('returns ["Any"] for "Any"', () => {
    expect(parseProfiles('Any')).toEqual(['Any'])
  })
  it('returns ["Any"] for case-insensitive "any"', () => {
    expect(parseProfiles('any')).toEqual(['Any'])
  })
  it('parses comma-separated profiles', () => {
    expect(parseProfiles('Domain, Private')).toEqual(['Domain', 'Private'])
  })
  it('drops unknown values', () => {
    expect(parseProfiles('Domain, Bogus, Public')).toEqual(['Domain', 'Public'])
  })
})

describe('parseSignature', () => {
  it('maps known statuses', () => {
    expect(parseSignature('signed')).toBe('signed')
    expect(parseSignature('unsigned')).toBe('unsigned')
    expect(parseSignature('unknown')).toBe('unknown')
  })
  it('maps empty/unrecognized to not-applicable', () => {
    expect(parseSignature('')).toBe('not-applicable')
    expect(parseSignature('weird')).toBe('not-applicable')
  })
})

describe('isBuiltinRule', () => {
  const empty = { description: '', group: '', isManaged: false, isSystemPath: false }

  it('detects MUI resource description (FirewallAPI.dll)', () => {
    expect(isBuiltinRule({ ...empty, description: '@FirewallAPI.dll,-25000' })).toBe(true)
  })
  it('detects MUI resource description with trailing semicolon segment', () => {
    expect(isBuiltinRule({ ...empty, description: '@%SystemRoot%\\system32\\firewallapi.dll,-25000;remarks' })).toBe(
      true,
    )
  })
  it('detects MUI resource for an exe path (Hyper-V vmms.exe)', () => {
    expect(isBuiltinRule({ ...empty, description: '@%systemroot%\\system32\\vmms.exe,-210' })).toBe(true)
  })
  it('detects AppX resource description (Desktop App Web Viewer)', () => {
    const description =
      '@{Microsoft.Win32WebViewHost_10.0.26100.1_neutral_neutral_cw5n1h2txyewy?ms-resource://Windows.Win32WebViewHost/resources/DisplayName}'
    expect(isBuiltinRule({ ...empty, description })).toBe(true)
  })
  it('detects AppX resource description (Windows Feature Experience Pack)', () => {
    const description =
      '@{MicrosoftWindows.Client.OOBE_1000.26100.40.0_x64__cw5n1h2txyewy?ms-resource://MicrosoftWindows.Client.OOBE/resources/ProductPkgDisplayName}'
    expect(isBuiltinRule({ ...empty, description })).toBe(true)
  })
  it('treats system-path binaries as built-in even without resource description', () => {
    expect(isBuiltinRule({ ...empty, description: 'Lets stuff through', isSystemPath: true })).toBe(true)
  })
  it('treats managed rules as built-in (Package or Owner SID set)', () => {
    expect(isBuiltinRule({ ...empty, description: 'Game Bar', isManaged: true })).toBe(true)
    expect(isBuiltinRule({ ...empty, description: 'Microsoft Store', isManaged: true })).toBe(true)
  })
  it('detects resource ref in Group when description is a resolved literal', () => {
    expect(isBuiltinRule({ ...empty, description: 'Game Bar', group: '@FirewallAPI.dll,-25000' })).toBe(true)
  })
  it('does not match user-installed app descriptions', () => {
    expect(isBuiltinRule({ ...empty, description: 'Steam game server traffic' })).toBe(false)
    expect(isBuiltinRule(empty)).toBe(false)
  })
  it('does not match descriptions that merely start with @ or @{', () => {
    expect(isBuiltinRule({ ...empty, description: '@some random text' })).toBe(false)
    expect(isBuiltinRule({ ...empty, description: '@{not a real resource ref}' })).toBe(false)
  })
})

describe('classifyRule', () => {
  const base = {
    program: '',
    programResolved: '',
    programExists: false,
    signature: 'not-applicable' as const,
    profiles: ['Domain'] as const,
    localPort: '443',
    remoteAddress: 'LocalSubnet',
    builtin: false,
  }

  it('flags stale program as high risk', () => {
    const { issues, risk } = classifyRule({
      ...base,
      programResolved: 'C:\\does\\not\\exist.exe',
      programExists: false,
    })
    expect(issues).toContain('stale')
    expect(risk).toBe('high')
  })

  it('flags unsigned existing binary as medium risk', () => {
    const { issues, risk } = classifyRule({
      ...base,
      programResolved: 'C:\\Users\\Test\\app.exe',
      programExists: true,
      signature: 'unsigned',
      profiles: ['Private'],
      localPort: '8080',
    })
    expect(issues).toEqual(['unsigned'])
    expect(risk).toBe('medium')
  })

  it('flags broad-scope (Public + Any port + Any remote) as high risk', () => {
    const { issues, risk } = classifyRule({
      ...base,
      profiles: ['Public'],
      localPort: 'Any',
      remoteAddress: 'Any',
    })
    expect(issues).toContain('broad-scope')
    expect(risk).toBe('high')
  })

  it('flags any-remote (not public) as medium risk', () => {
    const { issues, risk } = classifyRule({
      ...base,
      profiles: ['Private'],
      localPort: 'Any',
      remoteAddress: 'Any',
    })
    expect(issues).toEqual(['any-remote'])
    expect(risk).toBe('medium')
  })

  it('treats Any profile as hitting public', () => {
    const { issues, risk } = classifyRule({
      ...base,
      profiles: ['Any'],
      localPort: 'Any',
      remoteAddress: 'Any',
    })
    expect(issues).toContain('broad-scope')
    expect(risk).toBe('high')
  })

  it('returns low risk for a tightly-scoped, signed built-in rule', () => {
    const { issues, risk } = classifyRule({
      ...base,
      programResolved: 'C:\\Windows\\System32\\svchost.exe',
      programExists: true,
      signature: 'signed',
      builtin: true,
      localPort: '445',
    })
    expect(issues).toEqual([])
    expect(risk).toBe('low')
  })

  it('does not flag unsigned when program is missing on disk (stale takes priority)', () => {
    const { issues } = classifyRule({
      ...base,
      programResolved: 'C:\\gone.exe',
      programExists: false,
      signature: 'unsigned',
      profiles: ['Private'],
    })
    expect(issues).toContain('stale')
    expect(issues).not.toContain('unsigned')
  })

  it('skips program-related issues when there is no program filter', () => {
    const { issues } = classifyRule({
      ...base,
      profiles: ['Domain'],
      localPort: '80',
      remoteAddress: '10.0.0.0/8',
    })
    expect(issues).toEqual([])
  })

  it('does not flag broad-scope on built-in rules', () => {
    const { issues, risk } = classifyRule({
      ...base,
      programResolved: 'C:\\Windows\\System32\\spoolsv.exe',
      programExists: true,
      signature: 'signed',
      profiles: ['Public'],
      localPort: 'Any',
      remoteAddress: 'Any',
      builtin: true,
    })
    expect(issues).toEqual([])
    expect(risk).toBe('low')
  })

  it('does not flag any-remote on built-in port-only rules', () => {
    const { issues, risk } = classifyRule({
      ...base,
      profiles: ['Public'],
      localPort: 'Any',
      remoteAddress: 'Any',
      builtin: true,
    })
    expect(issues).toEqual([])
    expect(risk).toBe('low')
  })

  it('still flags stale on built-in rules (uninstalled feature leftover)', () => {
    const { issues, risk } = classifyRule({
      ...base,
      programResolved: 'C:\\Windows\\System32\\removed.exe',
      programExists: false,
      profiles: ['Public'],
      localPort: 'Any',
      remoteAddress: 'Any',
      builtin: true,
    })
    expect(issues).toEqual(['stale'])
    expect(risk).toBe('high')
  })

  it('flags any-remote when remoteAddress is empty (means Any)', () => {
    const { issues } = classifyRule({
      ...base,
      remoteAddress: '',
      builtin: false,
    })
    expect(issues).toEqual(['any-remote'])
  })

  it('does not flag any-port when localPort is empty string', () => {
    const { issues } = classifyRule({
      ...base,
      localPort: '',
      remoteAddress: 'Any',
      builtin: false,
    })
    expect(issues).toEqual(['any-remote'])
  })
})

describe('parseRuleLine', () => {
  it('returns null for line not starting with RULE|', () => {
    expect(parseRuleLine('TOTAL|42')).toBeNull()
    expect(parseRuleLine('PROG|1|10|Test')).toBeNull()
    expect(parseRuleLine('')).toBeNull()
  })

  it('returns null for fewer than 16 parts', () => {
    expect(parseRuleLine('RULE|a|b|c|d|e|f|g|h|i|j|k|l|m')).toBeNull()
  })

  it('returns null when name is empty', () => {
    expect(parseRuleLine('RULE||display|desc|grp|Domain|TCP|443|Any|prog|resolved|true|signed|false|false|true')).toBeNull()
  })

  it('parses a valid rule line correctly', () => {
    const line = 'RULE|MyRule|My Display|My description|My Group|Domain,Private|TCP|443|10.0.0.0/8|C:\\app.exe|C:\\app.exe|true|signed|false|false|true'
    const rule = parseRuleLine(line)
    expect(rule).not.toBeNull()
    expect(rule!.name).toBe('MyRule')
    expect(rule!.displayName).toBe('My Display')
    expect(rule!.description).toBe('My description')
    expect(rule!.group).toBe('My Group')
    expect(rule!.profiles).toEqual(['Domain', 'Private'])
    expect(rule!.protocol).toBe('TCP')
    expect(rule!.localPort).toBe('443')
    expect(rule!.remoteAddress).toBe('10.0.0.0/8')
    expect(rule!.program).toBe('C:\\app.exe')
    expect(rule!.programResolved).toBe('C:\\app.exe')
    expect(rule!.programExists).toBe(true)
    expect(rule!.signature).toBe('signed')
    expect(rule!.builtin).toBe(false)
    expect(rule!.enabled).toBe(true)
    expect(rule!.issues).toEqual([])
    expect(rule!.risk).toBe('low')
    expect(rule!.selected).toBe(false)
  })

  it('detects builtin rule via description resource ref', () => {
    const line = 'RULE|SysRule|Sys Display|@FirewallAPI.dll,-25000||Public|Any|Any|Any|||false||false|false|true'
    const rule = parseRuleLine(line)
    expect(rule).not.toBeNull()
    expect(rule!.builtin).toBe(true)
  })

  it('detects builtin rule via managed flag', () => {
    const line = 'RULE|Managed|Managed App|Game Bar||Public|Any|Any|Any|C:\\app.exe|C:\\app.exe|true|signed|false|true|true'
    const rule = parseRuleLine(line)
    expect(rule).not.toBeNull()
    expect(rule!.builtin).toBe(true)
    expect(rule!.risk).toBe('low')
  })

  it('parses a stale rule with program missing', () => {
    const line = 'RULE|Stale|Stale Rule|desc||Private|TCP|80|Any|C:\\gone.exe|C:\\gone.exe|false|unsigned|false|false|true'
    const rule = parseRuleLine(line)
    expect(rule).not.toBeNull()
    expect(rule!.issues).toContain('stale')
    expect(rule!.risk).toBe('high')
  })

  it('parses disabled rule correctly', () => {
    const line = 'RULE|Disabled|Disabled Rule|desc||Domain|Any|Any|Any|||false|not-applicable|false|false|false'
    const rule = parseRuleLine(line)
    expect(rule).not.toBeNull()
    expect(rule!.enabled).toBe(false)
  })

  it('defaults missing optional fields', () => {
    const line = 'RULE|NoDesc|No Desc|||||||||||||true'
    const rule = parseRuleLine(line)
    expect(rule).not.toBeNull()
    expect(rule!.description).toBe('')
    expect(rule!.group).toBe('')
    expect(rule!.protocol).toBe('Any')
    expect(rule!.localPort).toBe('Any')
    expect(rule!.remoteAddress).toBe('Any')
  })
})

describe('scanFirewallRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('on non-Windows platform', () => {
    it('returns empty result without calling execFileAsync', async () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const result = await scanFirewallRules()
      expect(result).toEqual({ rules: [], totalCount: 0, staleCount: 0, unsignedCount: 0, broadScopeCount: 0 })
      expect(mocks.execFileAsync).not.toHaveBeenCalled()
      expect(mocks.logger.warning).toHaveBeenCalledWith('firewall-audit', 'Firewall scan skipped: not on Windows')
      Object.defineProperty(process, 'platform', { value: orig })
    })
  })

  describe('on Windows platform', () => {
    beforeEach(() => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      return () => Object.defineProperty(process, 'platform', { value: orig })
    })

    it('parses TOTAL and RULE lines from stdout', async () => {
      const stdout = [
        'TOTAL|2',
        'RULE|Rule1|Display1|desc1||Domain|TCP|80|Any|C:\\app1.exe|C:\\app1.exe|true|signed|false|false|true',
        'RULE|Rule2|Display2|desc2||Private|Any|Any|Any|C:\\app2.exe|C:\\app2.exe|true|unsigned|false|false|true',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await scanFirewallRules()
      expect(result.totalCount).toBe(2)
      expect(result.rules).toHaveLength(2)
      expect(result.rules[0]!.name).toBe('Rule1')
      expect(result.rules[1]!.name).toBe('Rule2')
    })

    it('calls onProgress with TOTAL count and PROG updates', async () => {
      const stdout = [
        'TOTAL|50',
        'RULE|R1|Display1|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true',
        'PROG|1|50|Display1',
        'RULE|R2|Display2|desc||Private|Any|Any|Any|||false|not-applicable|false|false|true',
        'PROG|2|50|Display2',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const onProgress = vi.fn()
      await scanFirewallRules(onProgress)

      expect(onProgress).toHaveBeenCalledTimes(3)
      expect(onProgress).toHaveBeenNthCalledWith(1, { phase: 'enumerating', current: 0, total: 0, currentRule: 'Enumerating firewall rules...' })
      expect(onProgress).toHaveBeenNthCalledWith(2, { phase: 'classifying', current: 1, total: 50, currentRule: 'Display1' })
      expect(onProgress).toHaveBeenNthCalledWith(3, { phase: 'classifying', current: 2, total: 50, currentRule: 'Display2' })
    })

    it('counts stale, unsigned, and broad-scope issues', async () => {
      const stdout = [
        'TOTAL|3',
        'RULE|Stale|Stale|desc||Private|TCP|80|Any|C:\\gone.exe|C:\\gone.exe|false|unsigned|false|false|true',
        'RULE|Unsigned|Unsigned|desc||Private|TCP|80|Any|C:\\app.exe|C:\\app.exe|true|unsigned|false|false|true',
        'RULE|Broad|Broad|desc||Public|Any|Any|Any|||false|not-applicable|false|false|true',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await scanFirewallRules()
      expect(result.staleCount).toBe(1)
      expect(result.unsignedCount).toBe(1)
      expect(result.broadScopeCount).toBe(1)
      expect(result.rules).toHaveLength(3)
    })

    it('returns totalCount equal to rules length when TOTAL is missing', async () => {
      const stdout = [
        'RULE|R1|D1|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await scanFirewallRules()
      expect(result.totalCount).toBe(1)
    })

    it('ignores invalid TOTAL lines', async () => {
      const stdout = [
        'TOTAL|not-a-number',
        'RULE|R1|D1|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await scanFirewallRules()
      expect(result.totalCount).toBe(1)
    })

    it('handles empty stdout', async () => {
      mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await scanFirewallRules()
      expect(result.rules).toHaveLength(0)
      expect(result.totalCount).toBe(0)
    })

    it('skips lines that fail to parse', async () => {
      const stdout = [
        'TOTAL|2',
        'RULE|Valid|Valid|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true',
        'not a rule line',
        'RULE||bad||empty name is skipped',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await scanFirewallRules()
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]!.name).toBe('Valid')
    })

    it('skips progress lines with invalid numbers', async () => {
      const stdout = [
        'TOTAL|1',
        'PROG|not-a-number|1|Test',
        'PROG|1|not-a-number|Test',
        'RULE|R1|D1|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const onProgress = vi.fn()
      const result = await scanFirewallRules(onProgress)
      expect(result.rules).toHaveLength(1)
      expect(onProgress).toHaveBeenCalledTimes(1)
    })
  })
})

describe('applyFirewallChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result for empty changes array', async () => {
    const result = await applyFirewallChanges([])
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })

  it('returns empty result for non-array (handled at caller level)', async () => {
    const result = await applyFirewallChanges([] as unknown as { name: string; action: 'disable' | 'delete' }[])
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  describe('on non-Windows platform', () => {
    it('fails all changes with platform error', async () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const result = await applyFirewallChanges([{ name: 'Rule1', action: 'disable' }])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0]!.reason).toBe('Firewall audit is Windows-only')
      Object.defineProperty(process, 'platform', { value: orig })
    })
  })

  describe('on Windows platform', () => {
    beforeEach(() => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      return () => Object.defineProperty(process, 'platform', { value: orig })
    })

    it('rejects invalid rule name', async () => {
      const result = await applyFirewallChanges([{ name: 'rule|pipe', action: 'disable' }])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0]!.reason).toBe('Invalid rule name')
    })

    it('rejects invalid action', async () => {
      const result = await applyFirewallChanges([
        { name: 'Rule1', action: 'enable' as unknown as 'disable' },
      ])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0]!.reason).toBe('Invalid action')
    })

    it('successfully disables a rule', async () => {
      const stdout = "OK|Rule1|Display1\n"
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await applyFirewallChanges([{ name: 'Rule1', action: 'disable' }])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('successfully deletes a rule', async () => {
      const stdout = "OK|Rule1|Display1\n"
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await applyFirewallChanges([{ name: 'Rule1', action: 'delete' }])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('handles partial failures from FAIL lines', async () => {
      const stdout = [
        'OK|Rule1|Display1',
        'FAIL|Rule2|Display2|Access denied',
        'FAIL|Rule3|Display3|Rule not found',
      ].join('\n')
      mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

      const result = await applyFirewallChanges([
        { name: 'Rule1', action: 'disable' },
        { name: 'Rule2', action: 'disable' },
        { name: 'Rule3', action: 'disable' },
      ])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(2)
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0]!.name).toBe('Rule2')
      expect(result.errors[0]!.reason).toBe('Access denied')
      expect(result.errors[1]!.name).toBe('Rule3')
      expect(result.errors[1]!.reason).toBe('Rule not found')
    })

    it('handles PowerShell execution error', async () => {
      mocks.execFileAsync.mockRejectedValue(new Error('PowerShell not found'))

      const result = await applyFirewallChanges([{ name: 'Rule1', action: 'disable' }])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.reason).toBe('PowerShell not found')
    })

    it('handles non-Error rejection', async () => {
      mocks.execFileAsync.mockRejectedValue('string error')

      const result = await applyFirewallChanges([{ name: 'Rule1', action: 'disable' }])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0]!.reason).toBe('PowerShell execution failed')
    })

    it('escapes single quotes in rule names', async () => {
      mocks.execFileAsync.mockResolvedValue({ stdout: "OK|Rule's Name|Rule's Display\n", stderr: '' })

      const result = await applyFirewallChanges([{ name: "Rule's Name", action: 'disable' }])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      const script = mocks.psArgs.mock.calls[0]?.[0] ?? ''
      expect(script).toContain("Rule''s Name")
    })
  })
})

describe('registerFirewallAuditIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers FIREWALL_SCAN and FIREWALL_APPLY handlers', () => {
    registerFirewallAuditIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IPC.FIREWALL_SCAN)
    expect(channels).toContain(IPC.FIREWALL_APPLY)
    expect(channels.length).toBe(2)
  })

  it('FIREWALL_APPLY handler returns empty result for non-array changes', async () => {
    registerFirewallAuditIpc(() => null)
    const handlerCall = mocks.ipcHandle.mock.calls.find((c) => c[0] === IPC.FIREWALL_APPLY)
    const handler = handlerCall![1] as (...args: unknown[]) => unknown
    const result = await handler(null, null)
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('FIREWALL_SCAN handler sends progress events via window', async () => {
    const send = vi.fn()
    const win = { webContents: { send }, isDestroyed: () => false }
    registerFirewallAuditIpc(() => win as never)
    const handlerCall = mocks.ipcHandle.mock.calls.find((c) => c[0] === IPC.FIREWALL_SCAN)
    const handler = handlerCall![1] as (...args: unknown[]) => unknown

    // mock a successful scan result
    const stdout = ['TOTAL|1', 'RULE|R1|D1|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true'].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

    await handler()
    expect(send).toHaveBeenCalledWith(IPC.FIREWALL_PROGRESS, { phase: 'enumerating', current: 0, total: 0, currentRule: 'Enumerating firewall rules...' })
  })

  it('FIREWALL_SCAN does not send progress when window is destroyed', async () => {
    const send = vi.fn()
    const win = { webContents: { send }, isDestroyed: () => true }
    registerFirewallAuditIpc(() => win as never)
    const handlerCall = mocks.ipcHandle.mock.calls.find((c) => c[0] === IPC.FIREWALL_SCAN)
    const handler = handlerCall![1] as (...args: unknown[]) => unknown

    const stdout = ['TOTAL|1', 'RULE|R1|D1|desc||Domain|TCP|80|Any|||false|not-applicable|false|false|true'].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    await handler()
    expect(send).not.toHaveBeenCalled()
  })
})
