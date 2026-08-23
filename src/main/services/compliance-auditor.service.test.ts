import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyComplianceSettings,
  type ComplianceProbeData,
  parseProbeOutput,
  parseSeceditOutput,
  revertComplianceSettings,
  scanCompliance,
} from './compliance-auditor.service'

const mocks = vi.hoisted(() => ({
  execNativeUtf8: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

vi.mock('./exec-utf8', () => ({
  execNativeUtf8: (...args: unknown[]) => mocks.execNativeUtf8(...args),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => mocks.logger,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeBlob(overrides: Partial<ComplianceProbeData> = {}): string {
  return JSON.stringify({
    secedit: {},
    lsaClearText: null,
    lsaNoLMHash: null,
    smb1: null,
    uacEnableLUA: null,
    uacConsentPrompt: null,
    guestEnabled: null,
    auditSuccess: false,
    wuauservStartType: null,
    bitlockerStatus: null,
    firewallEnabledCount: 0,
    ...overrides,
  } satisfies ComplianceProbeData)
}

function mockGather(overrides: Partial<ComplianceProbeData> = {}): void {
  mocks.execNativeUtf8.mockResolvedValue({ stdout: makeBlob(overrides), stderr: '' })
}

function getCheck(result: Awaited<ReturnType<typeof scanCompliance>>, id: string) {
  const c = result.checks.find((x) => x.id === id)
  expect(c).toBeDefined()
  return c!
}

const PASSWORD_IDS = [
  'password-complexity',
  'password-min-length',
  'password-max-age',
  'lockout-threshold',
  'lockout-duration',
]

describe('scanCompliance', () => {
  it('gathers all probe data with a single process spawn', async () => {
    mockGather()

    await scanCompliance()

    expect(mocks.execNativeUtf8).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = mocks.execNativeUtf8.mock.calls[0]!
    expect(cmd).toBe('powershell.exe')
    expect(args).toContain('-NoProfile')
    expect(args).toContain('-NonInteractive')
    expect(opts).toMatchObject({ windowsHide: true })
  })

  it('marks every check as errored when the gather fails', async () => {
    mocks.execNativeUtf8.mockRejectedValue(new Error('command failed'))

    const result = await scanCompliance()

    expect(result.total).toBe(15)
    expect(result.compliant).toBe(0)
    expect(result.score).toBe(0)
    for (const c of result.checks) {
      expect(c.compliant).toBe(false)
      expect(c.value).toBe('Erro')
    }
  })

  it('marks every check as errored when output cannot be parsed', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: 'garbage without json', stderr: '' })

    const result = await scanCompliance()

    expect(result.compliant).toBe(0)
    expect(result.checks.every((c) => c.value === 'Erro')).toBe(true)
  })

  it('reports progress for gather phase and each check', async () => {
    mockGather()
    const onProgress = vi.fn()

    await scanCompliance(onProgress)

    const calls = onProgress.mock.calls
    expect(calls.length).toBe(16)
    expect(calls[0]![0]).toMatchObject({ current: 0, currentLabel: 'Coletando informações do sistema' })
    expect(calls[calls.length - 1]![0]).toMatchObject({ current: 15, total: 15 })
  })

  it('detects SMB1 as enabled', async () => {
    mockGather({ smb1: 1 })
    const smb1 = getCheck(await scanCompliance(), 'smb1-disabled')
    expect(smb1.compliant).toBe(false)
    expect(smb1.value).toBe('Ativado')
  })

  it('detects SMB1 as disabled', async () => {
    mockGather({ smb1: 0 })
    const smb1 = getCheck(await scanCompliance(), 'smb1-disabled')
    expect(smb1.compliant).toBe(true)
    expect(smb1.value).toBe('Desativado')
  })

  it('treats missing SMB1 value as non-compliant but reports Desativado', async () => {
    mockGather({})
    const smb1 = getCheck(await scanCompliance(), 'smb1-disabled')
    expect(smb1.compliant).toBe(false)
    expect(smb1.value).toBe('Desativado')
  })

  it('checks UAC via gathered registry value', async () => {
    mockGather({ uacEnableLUA: 1 })
    const uac = getCheck(await scanCompliance(), 'uac-enabled')
    expect(uac.compliant).toBe(true)
    expect(uac.value).toBe('Ativado')
  })

  it('counts enabled firewall profiles', async () => {
    mockGather({ firewallEnabledCount: 3 })
    const fw = getCheck(await scanCompliance(), 'firewall-enabled')
    expect(fw.compliant).toBe(true)
    expect(fw.value).toBe('3/3 perfis')
  })

  it('reports partial firewall coverage as non-compliant', async () => {
    mockGather({ firewallEnabledCount: 2 })
    const fw = getCheck(await scanCompliance(), 'firewall-enabled')
    expect(fw.compliant).toBe(false)
    expect(fw.value).toBe('2/3 perfis')
  })
})

describe('scanCompliance - password policies', () => {
  it('all password policies compliant via secedit section', async () => {
    mockGather({
      secedit: {
        PasswordComplexity: '1',
        MinimumPasswordLength: '8',
        MaximumPasswordAge: '90',
        LockoutBadCount: '3',
        LockoutDuration: '15',
      },
    })

    const result = await scanCompliance()
    for (const id of PASSWORD_IDS) {
      expect(getCheck(result, id).compliant).toBe(true)
    }
    expect(getCheck(result, 'password-min-length').value).toBe('8')
    expect(getCheck(result, 'password-max-age').value).toBe('90 dias')
    expect(getCheck(result, 'lockout-threshold').value).toBe('3')
    expect(getCheck(result, 'lockout-duration').value).toBe('15 min')
  })

  it('all password policies non-compliant via secedit section', async () => {
    mockGather({
      secedit: {
        PasswordComplexity: '0',
        MinimumPasswordLength: '4',
        MaximumPasswordAge: '180',
        LockoutBadCount: '0',
        LockoutDuration: '5',
      },
    })

    const result = await scanCompliance()
    for (const id of PASSWORD_IDS) {
      expect(getCheck(result, id).compliant).toBe(false)
    }
    expect(getCheck(result, 'password-complexity').value).toBe('Desativado')
  })

  it('missing secedit keys preserve legacy NaN value formatting', async () => {
    mockGather({ secedit: {} })

    const result = await scanCompliance()
    for (const id of PASSWORD_IDS) {
      expect(getCheck(result, id).compliant).toBe(false)
    }
    expect(getCheck(result, 'password-min-length').value).toBe('NaN')
    expect(getCheck(result, 'password-max-age').value).toBe('NaN dias')
    expect(getCheck(result, 'lockout-threshold').value).toBe('NaN')
    expect(getCheck(result, 'lockout-duration').value).toBe('NaN min')
  })
})

describe('scanCompliance - guest account', () => {
  it('guest disabled is compliant', async () => {
    mockGather({ guestEnabled: false })
    const g = getCheck(await scanCompliance(), 'guest-account-disabled')
    expect(g.compliant).toBe(true)
    expect(g.value).toBe('Desativada')
  })

  it('guest enabled is non-compliant', async () => {
    mockGather({ guestEnabled: true })
    const g = getCheck(await scanCompliance(), 'guest-account-disabled')
    expect(g.compliant).toBe(false)
    expect(g.value).toBe('Ativada')
  })

  it('missing guest info falls back to compliant Desativada', async () => {
    mockGather({ guestEnabled: null })
    const g = getCheck(await scanCompliance(), 'guest-account-disabled')
    expect(g.compliant).toBe(true)
    expect(g.value).toBe('Desativada')
  })
})

describe('scanCompliance - audit & bitlocker', () => {
  it('audit policy enabled', async () => {
    mockGather({ auditSuccess: true })
    const a = getCheck(await scanCompliance(), 'audit-policy')
    expect(a.compliant).toBe(true)
    expect(a.value).toBe('Ativada')
  })

  it('audit policy disabled when probe failed', async () => {
    mockGather({ auditSuccess: false })
    const a = getCheck(await scanCompliance(), 'audit-policy')
    expect(a.compliant).toBe(false)
    expect(a.value).toBe('Desativada')
  })

  it('bitlocker system drive encrypted', async () => {
    mockGather({ bitlockerStatus: 1 })
    const b = getCheck(await scanCompliance(), 'bitlocker-system')
    expect(b.compliant).toBe(true)
    expect(b.value).toBe('Ativado')
  })

  it('bitlocker missing probe is non-compliant', async () => {
    mockGather({ bitlockerStatus: null })
    const b = getCheck(await scanCompliance(), 'bitlocker-system')
    expect(b.compliant).toBe(false)
    expect(b.value).toBe('Desativado')
  })
})

describe('scanCompliance - LSA & update checks', () => {
  it('clear text password enabled is non-compliant', async () => {
    mockGather({ lsaClearText: 1 })
    const ctp = getCheck(await scanCompliance(), 'clear-text-password')
    expect(ctp.compliant).toBe(false)
    expect(ctp.value).toBe('Ativado')
  })

  it('clear text password absent is compliant', async () => {
    mockGather({ lsaClearText: null })
    const ctp = getCheck(await scanCompliance(), 'clear-text-password')
    expect(ctp.compliant).toBe(true)
    expect(ctp.value).toBe('Desativado')
  })

  it('lm hash disabled is compliant', async () => {
    mockGather({ lsaNoLMHash: 1 })
    const lm = getCheck(await scanCompliance(), 'lm-hash')
    expect(lm.compliant).toBe(true)
    expect(lm.value).toBe('Desativado')
  })

  it('lm hash absent is non-compliant', async () => {
    mockGather({ lsaNoLMHash: null })
    const lm = getCheck(await scanCompliance(), 'lm-hash')
    expect(lm.compliant).toBe(false)
    expect(lm.value).toBe('Ativado')
  })

  it('wuauserv disabled is non-compliant preserving case', async () => {
    mockGather({ wuauservStartType: 'Disabled' })
    const wu = getCheck(await scanCompliance(), 'wuauserv-enabled')
    expect(wu.compliant).toBe(false)
    expect(wu.value).toBe('Disabled')
  })

  it('wuauserv manual is compliant', async () => {
    mockGather({ wuauservStartType: 'Manual' })
    const wu = getCheck(await scanCompliance(), 'wuauserv-enabled')
    expect(wu.compliant).toBe(true)
    expect(wu.value).toBe('Manual')
  })

  it('wuauserv unknown is compliant Desconhecido', async () => {
    mockGather({ wuauservStartType: null })
    const wu = getCheck(await scanCompliance(), 'wuauserv-enabled')
    expect(wu.compliant).toBe(true)
    expect(wu.value).toBe('Desconhecido')
  })

  it('uac admin prompt at level 2 is compliant', async () => {
    mockGather({ uacConsentPrompt: 2 })
    const up = getCheck(await scanCompliance(), 'uac-admin-prompt')
    expect(up.compliant).toBe(true)
    expect(up.value).toBe('Nível 2')
  })

  it('uac admin prompt unknown shows Desconhecido', async () => {
    mockGather({ uacConsentPrompt: null })
    const up = getCheck(await scanCompliance(), 'uac-admin-prompt')
    expect(up.compliant).toBe(false)
    expect(up.value).toBe('Desconhecido')
  })
})

describe('parseSeceditOutput', () => {
  it('parses key=value pairs', () => {
    const parsed = parseSeceditOutput('PasswordComplexity=1\nMinimumPasswordLength=8\n')
    expect(parsed).toEqual({ PasswordComplexity: '1', MinimumPasswordLength: '8' })
  })

  it('strips surrounding quotes from values', () => {
    const parsed = parseSeceditOutput('MACHINE\\Key="Value"\n')
    expect(parsed['MACHINE\\Key']).toBe('Value')
  })

  it('ignores lines without equals sign', () => {
    const parsed = parseSeceditOutput('[Version]\nsignature="$CHICAGO$"\nPasswordComplexity=1\n')
    expect(parsed).toEqual({ PasswordComplexity: '1' })
  })

  it('trims whitespace around keys and values', () => {
    const parsed = parseSeceditOutput('  Key  =  42  \n')
    expect(parsed.Key).toBe('42')
  })
})

describe('parseProbeOutput', () => {
  it('returns parsed object for clean json', () => {
    const parsed = parseProbeOutput('{"smb1":1}')
    expect(parsed).toEqual({ smb1: 1 })
  })

  it('extracts json embedded after preamble text', () => {
    const parsed = parseProbeOutput('some warning noise\n{"smb1":0,"guestEnabled":false}')
    expect(parsed).toEqual({ smb1: 0, guestEnabled: false })
  })

  it('returns null when no braces present', () => {
    expect(parseProbeOutput('no json here')).toBeNull()
  })

  it('returns null for malformed json between braces', () => {
    expect(parseProbeOutput('{not valid json}')).toBeNull()
  })
})

describe('applyComplianceSettings', () => {
  it('returns succeeded count for valid IDs', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await applyComplianceSettings(['smb1-disabled', 'uac-enabled'])
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('returns failed for unknown IDs', async () => {
    const result = await applyComplianceSettings(['nonexistent-id'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles apply errors', async () => {
    mocks.execNativeUtf8.mockRejectedValue(new Error('access denied'))
    const result = await applyComplianceSettings(['smb1-disabled'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('access denied')
  })

  it('handles non-Error throws in apply', async () => {
    mocks.execNativeUtf8.mockRejectedValue('something broke')
    const result = await applyComplianceSettings(['smb1-disabled'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Erro desconhecido')
  })

  it('fails for settings without apply function', async () => {
    const result = await applyComplianceSettings(['bitlocker-system'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('applies various settings', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await applyComplianceSettings([
      'password-complexity',
      'password-min-length',
      'password-max-age',
      'lockout-threshold',
      'lockout-duration',
      'clear-text-password',
      'lm-hash',
      'audit-policy',
      'wuauserv-enabled',
      'uac-admin-prompt',
    ])
    expect(result.succeeded).toBe(10)
    expect(result.failed).toBe(0)
  })
})

describe('revertComplianceSettings', () => {
  it('reverts known settings', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await revertComplianceSettings(['guest-account-disabled'])
    expect(result.succeeded).toBe(1)
  })

  it('fails for settings without revert', async () => {
    const result = await revertComplianceSettings(['bitlocker-system'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles revert errors', async () => {
    mocks.execNativeUtf8.mockRejectedValue(new Error('revert failed'))
    const result = await revertComplianceSettings(['smb1-disabled'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('revert failed')
  })

  it('reverts various settings', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await revertComplianceSettings([
      'password-complexity',
      'password-min-length',
      'password-max-age',
      'lockout-threshold',
      'lockout-duration',
      'clear-text-password',
      'lm-hash',
      'audit-policy',
      'wuauserv-enabled',
      'uac-enabled',
      'uac-admin-prompt',
    ])
    expect(result.succeeded).toBe(11)
    expect(result.failed).toBe(0)
  })
})
