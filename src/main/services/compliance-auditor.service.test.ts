import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { applyComplianceSettings, revertComplianceSettings, scanCompliance } from './compliance-auditor.service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scanCompliance', () => {
  it('handles all checks failing gracefully', async () => {
    mocks.execNativeUtf8.mockRejectedValue(new Error('command failed'))

    const result = await scanCompliance()
    expect(result.total).toBeGreaterThan(0)
    // clear-text-password: val=null → intVal=0 → compliant=true
    // wuauserv-enabled: stdout='' → ''!=='disabled' → compliant=true
    expect(result.compliant).toBeLessThanOrEqual(2)
    expect(result.score).toBeLessThanOrEqual(20)
  })

  it('reports progress via callback', async () => {
    mocks.execNativeUtf8.mockRejectedValue(new Error('command failed'))
    const onProgress = vi.fn()

    await scanCompliance(onProgress)

    expect(onProgress).toHaveBeenCalled()
    const calls = onProgress.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0][0]).toHaveProperty('total')
  })

  it('detects SMB1 as enabled when registry returns 1', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('SMB1')) {
        return { stdout: '    SMB1    REG_DWORD    0x1', stderr: '' }
      }
      if (full.includes('reg.exe query')) {
        throw new Error('key not found')
      }
      if (full.includes('cmd.exe') || full.includes('secedit.exe') || full.includes('powershell.exe')) {
        throw new Error('command failed')
      }
      throw new Error('command failed')
    })

    const result = await scanCompliance()
    const smb1 = result.checks.find((c) => c.id === 'smb1-disabled')
    expect(smb1).toBeDefined()
    expect(smb1!.compliant).toBe(false)
    expect(smb1!.value).toBe('Ativado')
  })

  it('detects SMB1 as disabled when registry returns 0', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('SMB1')) {
        return { stdout: '    SMB1    REG_DWORD    0x0', stderr: '' }
      }
      if (full.includes('reg.exe query')) {
        throw new Error('key not found')
      }
      throw new Error('command failed')
    })

    const result = await scanCompliance()
    const smb1 = result.checks.find((c) => c.id === 'smb1-disabled')
    expect(smb1).toBeDefined()
    expect(smb1!.compliant).toBe(true)
    expect(smb1!.value).toBe('Desativado')
  })

  it('checks UAC via registry', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('EnableLUA')) {
        return { stdout: '    EnableLUA    REG_DWORD    0x1', stderr: '' }
      }
      if (full.includes('reg.exe query')) {
        throw new Error('key not found')
      }
      throw new Error('command failed')
    })

    const result = await scanCompliance()
    const uac = result.checks.find((c) => c.id === 'uac-enabled')
    expect(uac).toBeDefined()
    expect(uac!.compliant).toBe(true)
    expect(uac!.value).toBe('Ativado')
  })

  it('checks firewall via PowerShell', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('Get-NetFirewallProfile')) {
        return { stdout: '3', stderr: '' }
      }
      if (full.includes('reg.exe query')) {
        throw new Error('key not found')
      }
      if (full.includes('cmd.exe') || full.includes('secedit.exe') || full.includes('powershell.exe')) {
        throw new Error('command failed')
      }
      throw new Error('command failed')
    })

    const result = await scanCompliance()
    const fw = result.checks.find((c) => c.id === 'firewall-enabled')
    expect(fw).toBeDefined()
    expect(fw!.compliant).toBe(true)
  })
})

describe('scanCompliance - password policies', () => {
  it('all password policies compliant via secedit', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('echo %TEMP%')) return { stdout: 'C:\\TEMP\\\n', stderr: '' }
      if (full.includes('secedit.exe /export')) return { stdout: '', stderr: '' }
      if (full.includes('Get-Content')) {
        return {
          stdout: [
            'PasswordComplexity=1',
            'MinimumPasswordLength=8',
            'MaximumPasswordAge=90',
            'LockoutBadCount=3',
            'LockoutDuration=15',
          ].join('\n'),
          stderr: '',
        }
      }
      if (full.includes('/c del')) return { stdout: '', stderr: '' }
      throw new Error('unexpected command')
    })

    const result = await scanCompliance()
    const pwPolicy = ['password-complexity', 'password-min-length', 'password-max-age', 'lockout-threshold', 'lockout-duration']
    for (const id of pwPolicy) {
      expect(result.checks.find((c) => c.id === id)!.compliant).toBe(true)
    }
    expect(result.checks.find((c) => c.id === 'password-min-length')!.value).toBe('8')
    expect(result.checks.find((c) => c.id === 'password-max-age')!.value).toBe('90 dias')
    expect(result.checks.find((c) => c.id === 'lockout-threshold')!.value).toBe('3')
    expect(result.checks.find((c) => c.id === 'lockout-duration')!.value).toBe('15 min')
  })

  it('all password policies non-compliant via secedit', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('echo %TEMP%')) return { stdout: 'C:\\TEMP\\\n', stderr: '' }
      if (full.includes('secedit.exe /export')) return { stdout: '', stderr: '' }
      if (full.includes('Get-Content')) {
        return {
          stdout: [
            'PasswordComplexity=0',
            'MinimumPasswordLength=4',
            'MaximumPasswordAge=180',
            'LockoutBadCount=0',
            'LockoutDuration=5',
          ].join('\n'),
          stderr: '',
        }
      }
      if (full.includes('/c del')) return { stdout: '', stderr: '' }
      throw new Error('unexpected command')
    })

    const result = await scanCompliance()
    expect(result.checks.find((c) => c.id === 'password-complexity')!.compliant).toBe(false)
    expect(result.checks.find((c) => c.id === 'password-min-length')!.compliant).toBe(false)
    expect(result.checks.find((c) => c.id === 'password-max-age')!.compliant).toBe(false)
    expect(result.checks.find((c) => c.id === 'lockout-threshold')!.compliant).toBe(false)
    expect(result.checks.find((c) => c.id === 'lockout-duration')!.compliant).toBe(false)
  })
})

describe('scanCompliance - guest account', () => {
  it('convidado user disabled (compliant)', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('"Convidado"')) return { stdout: 'False', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const g = result.checks.find((c) => c.id === 'guest-account-disabled')!
    expect(g.compliant).toBe(true)
    expect(g.value).toBe('Desativada')
  })

  it('convidado user enabled (non-compliant)', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('"Convidado"')) return { stdout: 'true\n', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const g = result.checks.find((c) => c.id === 'guest-account-disabled')!
    expect(g.compliant).toBe(false)
    expect(g.value).toBe('Ativada')
  })

  it('guest fallback disabled (compliant)', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('"Convidado"')) return { stdout: '', stderr: '' }
      if (full.includes('"Guest"')) return { stdout: 'False', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const g = result.checks.find((c) => c.id === 'guest-account-disabled')!
    expect(g.compliant).toBe(true)
    expect(g.value).toBe('Desativada')
  })

  it('guest fallback enabled (non-compliant)', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('"Convidado"')) return { stdout: '', stderr: '' }
      if (full.includes('"Guest"')) return { stdout: 'true\n', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const g = result.checks.find((c) => c.id === 'guest-account-disabled')!
    expect(g.compliant).toBe(false)
    expect(g.value).toBe('Ativada')
  })
})

describe('scanCompliance - audit & bitlocker', () => {
  it('audit policy enabled', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('auditpol /get')) return { stdout: 'Success', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    expect(result.checks.find((c) => c.id === 'audit-policy')!.compliant).toBe(true)
    expect(result.checks.find((c) => c.id === 'audit-policy')!.value).toBe('Ativada')
  })

  it('bitlocker system drive encrypted', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('Get-BitLockerVolume')) return { stdout: '1', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    expect(result.checks.find((c) => c.id === 'bitlocker-system')!.compliant).toBe(true)
    expect(result.checks.find((c) => c.id === 'bitlocker-system')!.value).toBe('Ativado')
  })
})

describe('scanCompliance - registry-based checks', () => {
  it('uac admin prompt at level 2', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('ConsentPromptBehaviorAdmin')) {
        return { stdout: '    ConsentPromptBehaviorAdmin    REG_DWORD    0x2', stderr: '' }
      }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const uac = result.checks.find((c) => c.id === 'uac-admin-prompt')!
    expect(uac.compliant).toBe(true)
    expect(uac.value).toBe('Nível 2')
  })

  it('lm hash disabled (compliant)', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('NoLMHash')) {
        return { stdout: '    NoLMHash    REG_DWORD    0x1', stderr: '' }
      }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const lm = result.checks.find((c) => c.id === 'lm-hash')!
    expect(lm.compliant).toBe(true)
    expect(lm.value).toBe('Desativado')
  })

  it('clear text password enabled (non-compliant)', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('ClearTextPassword')) {
        return { stdout: '    ClearTextPassword    REG_DWORD    0x1', stderr: '' }
      }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const ctp = result.checks.find((c) => c.id === 'clear-text-password')!
    expect(ctp.compliant).toBe(false)
    expect(ctp.value).toBe('Ativado')
  })

  it('wuauserv service disabled', async () => {
    mocks.execNativeUtf8.mockImplementation(async (cmd: string, args: string[]) => {
      const full = `${cmd} ${args.join(' ')}`
      if (full.includes('wuauserv')) return { stdout: 'Disabled', stderr: '' }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const wu = result.checks.find((c) => c.id === 'wuauserv-enabled')!
    expect(wu.compliant).toBe(false)
    expect(wu.value).toBe('Disabled')
  })
})

describe('scanCompliance - regQuery edge cases', () => {
  it('returns null when value not found in output', async () => {
    mocks.execNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      const full = args.join(' ')
      if (full.includes('ClearTextPassword')) {
        return { stdout: '    SomeOtherValue    REG_DWORD    0x1', stderr: '' }
      }
      throw new Error('unexpected command')
    })
    const result = await scanCompliance()
    const ctp = result.checks.find((c) => c.id === 'clear-text-password')!
    expect(ctp.compliant).toBe(true)
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
    expect(result.errors[0].reason).toBe('access denied')
  })

  it('handles non-Error throws in apply', async () => {
    mocks.execNativeUtf8.mockRejectedValue('something broke')
    const result = await applyComplianceSettings(['smb1-disabled'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('Erro desconhecido')
  })

  it('fails for settings without apply function', async () => {
    const result = await applyComplianceSettings(['bitlocker-system'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('applies various settings', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await applyComplianceSettings([
      'password-complexity', 'password-min-length', 'password-max-age',
      'lockout-threshold', 'lockout-duration',
      'clear-text-password', 'lm-hash',
      'audit-policy', 'wuauserv-enabled',
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
    expect(result.errors[0].reason).toBe('revert failed')
  })

  it('reverts various settings', async () => {
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await revertComplianceSettings([
      'password-complexity', 'password-min-length', 'password-max-age',
      'lockout-threshold', 'lockout-duration',
      'clear-text-password', 'lm-hash',
      'audit-policy', 'wuauserv-enabled',
      'uac-enabled', 'uac-admin-prompt',
    ])
    expect(result.succeeded).toBe(11)
    expect(result.failed).toBe(0)
  })
})
