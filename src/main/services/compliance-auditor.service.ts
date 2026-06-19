import type { ComplianceApplyResult, ComplianceCheck, ComplianceScanProgress, ComplianceState } from '@shared/types'
import { execNativeUtf8 } from './exec-utf8'

interface CheckDef {
  id: string
  category: ComplianceCheck['category']
  severity: ComplianceCheck['severity']
  label: string
  description: string
  expected: string
  requiresAdmin: boolean
  check: () => Promise<{ compliant: boolean; value: string }>
  apply?: () => Promise<void>
  revert?: () => Promise<void>
}

async function regQuery(path: string, value: string): Promise<string | null> {
  try {
    const { stdout } = await execNativeUtf8('reg.exe', ['query', path, '/v', value, '/reg:64'], {
      timeout: 5000,
      windowsHide: true,
    })
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
    for (const line of lines) {
      const match = line.match(new RegExp(`\\s+${value}\\s+REG_\\w+\\s+(.+)$`, 'i'))
      if (match) return match[1]!.trim()
    }
    return null
  } catch {
    return null
  }
}

async function regSetDword(path: string, value: string, data: number): Promise<void> {
  const hex = `0x${data.toString(16)}`
  await execNativeUtf8('reg.exe', ['add', path, '/v', value, '/t', 'REG_DWORD', '/d', hex, '/f', '/reg:64'], {
    timeout: 5000,
    windowsHide: true,
  })
}

async function seceditQuery(): Promise<Record<string, string>> {
  try {
    const tmpDir = await execNativeUtf8('cmd.exe', ['/c', 'echo', '%TEMP%'], { timeout: 3000, windowsHide: true })
    const tmpPath = `${tmpDir.stdout.trim()}\\dinho-secedit-${Date.now()}.inf`
    await execNativeUtf8('secedit.exe', ['/export', '/cfg', tmpPath, '/quiet'], { timeout: 15000, windowsHide: true })
    const { stdout } = await execNativeUtf8(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Content '${tmpPath}' -Encoding Unicode | Where-Object { $_ -notmatch '^[\\s;]' }`,
      ],
      { timeout: 10000, windowsHide: true },
    )
    const vals: Record<string, string> = {}
    for (const line of stdout.split('\n')) {
      const eqIdx = line.indexOf('=')
      if (eqIdx > 0) {
        const k = line.slice(0, eqIdx).trim()
        const v = line
          .slice(eqIdx + 1)
          .trim()
          .replace(/^"|"$/g, '')
        vals[k] = v
      }
    }
    await execNativeUtf8('cmd.exe', ['/c', 'del', '/f', '/q', tmpPath], { timeout: 3000, windowsHide: true }).catch(
      () => {},
    )
    return vals
  } catch {
    return {}
  }
}

const CHECKS: CheckDef[] = [
  // ── Password & Account Policy ──
  {
    id: 'password-complexity',
    category: 'password',
    severity: 'critical',
    label: 'Exigir complexidade de senha',
    description: 'A política de senhas deve exigir caracteres maiúsculos, minúsculos, números e especiais',
    expected: 'Ativado',
    requiresAdmin: false,
    check: async () => {
      const sec = await seceditQuery()
      const val = sec.PasswordComplexity!
      return { compliant: val === '1', value: val === '1' ? 'Ativado' : 'Desativado' }
    },
    apply: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'net accounts /minpwlen:8; net accounts /passwordchg:Yes'],
        { timeout: 10000, windowsHide: true },
      )
    },
    revert: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'net accounts /minpwlen:0; net accounts /passwordchg:No'],
        { timeout: 10000, windowsHide: true },
      )
    },
  },
  {
    id: 'password-min-length',
    category: 'password',
    severity: 'critical',
    label: 'Tamanho mínimo de senha ≥ 8',
    description: 'A política de senhas deve exigir no mínimo 8 caracteres',
    expected: '≥ 8',
    requiresAdmin: false,
    check: async () => {
      const sec = await seceditQuery()
      const val = Number.parseInt(sec.MinimumPasswordLength!, 10)
      return { compliant: val >= 8, value: String(val) }
    },
    apply: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /minpwlen:8'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
    revert: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /minpwlen:0'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
  },
  {
    id: 'password-max-age',
    category: 'password',
    severity: 'warning',
    label: 'Validade máxima da senha ≤ 90 dias',
    description: 'Senhas devem expirar após no máximo 90 dias',
    expected: '≤ 90',
    requiresAdmin: false,
    check: async () => {
      const sec = await seceditQuery()
      const val = Number.parseInt(sec.MaximumPasswordAge!, 10)
      return { compliant: val <= 90, value: `${val} dias` }
    },
    apply: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /maxpwage:90'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
    revert: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /maxpwage:0'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
  },
  {
    id: 'lockout-threshold',
    category: 'password',
    severity: 'critical',
    label: 'Limite de tentativas de login ≤ 5',
    description: 'A conta deve bloquear após no máximo 5 tentativas inválidas',
    expected: '≤ 5',
    requiresAdmin: false,
    check: async () => {
      const sec = await seceditQuery()
      const val = Number.parseInt(sec.LockoutBadCount!, 10)
      return { compliant: val > 0 && val <= 5, value: String(val) }
    },
    apply: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /lockoutthreshold:5'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
    revert: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /lockoutthreshold:0'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
  },
  {
    id: 'lockout-duration',
    category: 'password',
    severity: 'warning',
    label: 'Duração de bloqueio ≥ 15 minutos',
    description: 'A conta deve permanecer bloqueada por pelo menos 15 minutos',
    expected: '≥ 15',
    requiresAdmin: false,
    check: async () => {
      const sec = await seceditQuery()
      const val = Number.parseInt(sec.LockoutDuration!, 10)
      return { compliant: val >= 15, value: `${val} min` }
    },
    apply: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /lockoutduration:15'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
    revert: async () => {
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-Command', 'net accounts /lockoutduration:30'], {
        timeout: 10000,
        windowsHide: true,
      })
    },
  },
  {
    id: 'clear-text-password',
    category: 'password',
    severity: 'critical',
    label: 'Armazenamento de senha em texto claro',
    description: 'O Windows não deve armazenar senhas com criptografia reversível',
    expected: 'Desativado',
    requiresAdmin: true,
    check: async () => {
      const val = await regQuery('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa', 'ClearTextPassword')
      const intVal = val != null ? Number.parseInt(val, 16) : 0
      return { compliant: intVal === 0, value: intVal === 1 ? 'Ativado' : 'Desativado' }
    },
    apply: async () => {
      await regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa', 'ClearTextPassword', 0)
    },
    revert: async () => {
      await regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa', 'ClearTextPassword', 1)
    },
  },
  {
    id: 'lm-hash',
    category: 'password',
    severity: 'critical',
    label: 'Armazenamento de hash LM',
    description: 'O Windows não deve armazenar hashes LM (fracos e vulneráveis)',
    expected: 'Desativado',
    requiresAdmin: true,
    check: async () => {
      const val = await regQuery('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa', 'NoLMHash')
      const intVal = val != null ? Number.parseInt(val, 16) : undefined
      return { compliant: intVal === 1, value: intVal === 1 ? 'Desativado' : 'Ativado' }
    },
    apply: async () => {
      await regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa', 'NoLMHash', 1)
    },
    revert: async () => {
      await regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa', 'NoLMHash', 0)
    },
  },
  {
    id: 'guest-account-disabled',
    category: 'password',
    severity: 'warning',
    label: 'Conta de convidado desativada',
    description: 'A conta de convidado deve estar desativada por segurança',
    expected: 'Desativada',
    requiresAdmin: false,
    check: async () => {
      const { stdout } = await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', '(Get-LocalUser -Name "Convidado" -ErrorAction SilentlyContinue).Enabled'],
        { timeout: 5000, windowsHide: true },
      ).catch(() => ({ stdout: '' }))
      if (!stdout.trim()) {
        const { stdout: en } = await execNativeUtf8(
          'powershell.exe',
          ['-NoProfile', '-Command', '(Get-LocalUser -Name "Guest" -ErrorAction SilentlyContinue).Enabled'],
          { timeout: 5000, windowsHide: true },
        )
        return { compliant: en.trim().toLowerCase() !== 'true', value: en.trim() === 'true' ? 'Ativada' : 'Desativada' }
      }
      return {
        compliant: stdout.trim().toLowerCase() !== 'true',
        value: stdout.trim() === 'true' ? 'Ativada' : 'Desativada',
      }
    },
    apply: async () => {
      await execNativeUtf8(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Disable-LocalUser -Name "Convidado" -ErrorAction SilentlyContinue; Disable-LocalUser -Name "Guest" -ErrorAction SilentlyContinue',
        ],
        { timeout: 10000, windowsHide: true },
      )
    },
    revert: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Enable-LocalUser -Name "Guest" -ErrorAction SilentlyContinue'],
        { timeout: 10000, windowsHide: true },
      )
    },
  },
  // ── Audit & Logging ──
  {
    id: 'audit-policy',
    category: 'audit',
    severity: 'warning',
    label: 'Política de auditoria',
    description: 'O Windows deve auditar eventos de segurança (logon, conta, objeto)',
    expected: 'Ativada',
    requiresAdmin: true,
    check: async () => {
      const { stdout } = await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'auditpol /get /category:"Logon/Logoff" /r'],
        { timeout: 5000, windowsHide: true },
      ).catch(() => ({ stdout: '' }))
      return {
        compliant: stdout.toLowerCase().includes('success'),
        value: stdout.toLowerCase().includes('success') ? 'Ativada' : 'Desativada',
      }
    },
    apply: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'auditpol /set /subcategory:"Logon" /success:enable'],
        { timeout: 10000, windowsHide: true },
      )
    },
    revert: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'auditpol /set /subcategory:"Logon" /success:disable'],
        { timeout: 10000, windowsHide: true },
      )
    },
  },
  // ── Network Security ──
  {
    id: 'smb1-disabled',
    category: 'network',
    severity: 'critical',
    label: 'SMBv1 desativado',
    description: 'O protocolo SMBv1 é vulnerável a WannaCry e EternalBlue',
    expected: 'Desativado',
    requiresAdmin: true,
    check: async () => {
      const val = await regQuery('HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', 'SMB1')
      const intVal = val != null ? Number.parseInt(val, 16) : undefined
      return { compliant: intVal === 0, value: intVal === 1 ? 'Ativado' : 'Desativado' }
    },
    apply: async () => {
      await regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', 'SMB1', 0)
    },
    revert: async () => {
      await regSetDword('HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', 'SMB1', 1)
    },
  },
  // ── Windows Update ──
  {
    id: 'wuauserv-enabled',
    category: 'update',
    severity: 'warning',
    label: 'Windows Update ativo',
    description: 'O serviço de atualização automática deve estar habilitado',
    expected: 'Ativo',
    requiresAdmin: true,
    check: async () => {
      const { stdout } = await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', '(Get-Service -Name wuauserv -ErrorAction SilentlyContinue).StartType'],
        { timeout: 5000, windowsHide: true },
      ).catch(() => ({ stdout: '' }))
      return { compliant: stdout.trim().toLowerCase() !== 'disabled', value: stdout.trim() || 'Desconhecido' }
    },
    apply: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Set-Service -Name wuauserv -StartupType Manual -ErrorAction Stop'],
        { timeout: 10000, windowsHide: true },
      )
    },
    revert: async () => {
      await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Set-Service -Name wuauserv -StartupType Disabled -ErrorAction Stop'],
        { timeout: 10000, windowsHide: true },
      )
    },
  },
  // ── BitLocker ──
  {
    id: 'bitlocker-system',
    category: 'bitlocker',
    severity: 'warning',
    label: 'BitLocker na unidade do sistema',
    description: 'A unidade do sistema deve estar criptografada com BitLocker',
    expected: 'Ativado',
    requiresAdmin: false,
    check: async () => {
      const { stdout } = await execNativeUtf8(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '(Get-BitLockerVolume -MountPoint "C:" -ErrorAction SilentlyContinue).ProtectionStatus',
        ],
        { timeout: 5000, windowsHide: true },
      ).catch(() => ({ stdout: '' }))
      return { compliant: stdout.trim() === '1', value: stdout.trim() === '1' ? 'Ativado' : 'Desativado' }
    },
  },
  // ── Firewall ──
  {
    id: 'firewall-enabled',
    category: 'firewall',
    severity: 'critical',
    label: 'Firewall do Windows ativo',
    description: 'O firewall deve estar ativo em todos os perfis de rede',
    expected: 'Ativo',
    requiresAdmin: false,
    check: async () => {
      const { stdout } = await execNativeUtf8(
        'powershell.exe',
        ['-NoProfile', '-Command', '@(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $true }).Count'],
        { timeout: 5000, windowsHide: true },
      ).catch(() => ({ stdout: '0' }))
      return { compliant: stdout.trim() === '3', value: `${stdout.trim()}/3 perfis` }
    },
  },
  // ── UAC ──
  {
    id: 'uac-enabled',
    category: 'uac',
    severity: 'critical',
    label: 'UAC ativo',
    description: 'O Controle de Conta de Usuário (UAC) deve estar ativo',
    expected: 'Ativado',
    requiresAdmin: true,
    check: async () => {
      const val = await regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 'EnableLUA')
      const intVal = val != null ? Number.parseInt(val, 16) : undefined
      return { compliant: intVal === 1, value: intVal === 1 ? 'Ativado' : 'Desativado' }
    },
    apply: async () => {
      await regSetDword('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 'EnableLUA', 1)
    },
    revert: async () => {
      await regSetDword('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 'EnableLUA', 0)
    },
  },
  {
    id: 'uac-admin-prompt',
    category: 'uac',
    severity: 'warning',
    label: 'UAC — solicitar consentimento do admin',
    description: 'O UAC deve solicitar consentimento ao elevar privilégios (nível 2)',
    expected: 'Nível 2',
    requiresAdmin: true,
    check: async () => {
      const val = await regQuery(
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        'ConsentPromptBehaviorAdmin',
      )
      const intVal = val != null ? Number.parseInt(val, 16) : undefined
      return { compliant: intVal === 2, value: intVal != null ? `Nível ${intVal}` : 'Desconhecido' }
    },
    apply: async () => {
      await regSetDword(
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        'ConsentPromptBehaviorAdmin',
        2,
      )
    },
    revert: async () => {
      await regSetDword(
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        'ConsentPromptBehaviorAdmin',
        0,
      )
    },
  },
]

export async function scanCompliance(onProgress?: (data: ComplianceScanProgress) => void): Promise<ComplianceState> {
  const checks: ComplianceCheck[] = []
  let compliantCount = 0

  for (let i = 0; i < CHECKS.length; i++) {
    const def = CHECKS[i]!
    onProgress?.({ current: i + 1, total: CHECKS.length, currentLabel: def.label, category: def.category })

    let compliant = false
    let value = 'Erro'
    try {
      const result = await def.check()
      compliant = result.compliant
      value = result.value
    } catch {
      compliant = false
    }

    if (compliant) compliantCount++
    checks.push({
      id: def.id,
      category: def.category,
      severity: def.severity,
      label: def.label,
      description: def.description,
      compliant,
      reversible: typeof def.revert === 'function',
      applicable: typeof def.apply === 'function',
      requiresAdmin: def.requiresAdmin,
      value,
      expected: def.expected,
    })
  }

  const score = CHECKS.length > 0 ? Math.round((compliantCount / CHECKS.length) * 100) : 0
  return { checks, score, total: CHECKS.length, compliant: compliantCount }
}

export async function applyComplianceSettings(ids: string[]): Promise<ComplianceApplyResult> {
  let succeeded = 0
  let failed = 0
  const errors: ComplianceApplyResult['errors'] = []

  for (const id of ids) {
    const def = CHECKS.find((c) => c.id === id)
    if (!def || !def.apply) {
      failed++
      continue
    }
    try {
      await def.apply()
      succeeded++
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'Erro desconhecido'
      failed++
      errors.push({ id: def.id, label: def.label, reason })
    }
  }

  return { succeeded, failed, errors }
}

export async function revertComplianceSettings(ids: string[]): Promise<ComplianceApplyResult> {
  let succeeded = 0
  let failed = 0
  const errors: ComplianceApplyResult['errors'] = []

  for (const id of ids) {
    const def = CHECKS.find((c) => c.id === id)
    if (!def || !def.revert) {
      failed++
      continue
    }
    try {
      await def.revert()
      succeeded++
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'Erro desconhecido'
      failed++
      errors.push({ id: def.id, label: def.label, reason })
    }
  }

  return { succeeded, failed, errors }
}
