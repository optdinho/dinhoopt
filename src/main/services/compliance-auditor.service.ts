import type { ComplianceApplyResult, ComplianceCheck, ComplianceScanProgress, ComplianceState } from '@shared/types'
import { execNativeUtf8 } from './exec-utf8'

/**
 * Snapshot coletado por UMA única invocação do PowerShell (probe).
 * Todas as checagens de leitura avaliam este objeto em memória — sem spawns por check.
 */
export type RegProbeValue = string | number | null

/**
 * Snapshot coletado por UMA única invocação do PowerShell (probe).
 * Todas as checagens de leitura avaliam este objeto em memória — sem spawns por check.
 */
export interface ComplianceProbeData {
  secedit: Record<string, string>
  lsaClearText: RegProbeValue
  lsaNoLMHash: RegProbeValue
  smb1: RegProbeValue
  uacEnableLUA: RegProbeValue
  uacConsentPrompt: RegProbeValue
  guestEnabled: boolean | string | null
  auditSuccess: boolean
  wuauservStartType: string | null
  bitlockerStatus: RegProbeValue
  firewallEnabledCount: number
}

function regValueToInt(v: RegProbeValue | undefined): number {
  if (v == null) return Number.NaN
  return Number.parseInt(String(v), 16)
}

interface CheckDef {
  id: string
  category: ComplianceCheck['category']
  severity: ComplianceCheck['severity']
  label: string
  description: string
  expected: string
  requiresAdmin: boolean
  evaluate: (data: ComplianceProbeData) => { compliant: boolean; value: string }
  apply?: () => Promise<void>
  revert?: () => Promise<void>
}

async function regSetDword(path: string, value: string, data: number): Promise<void> {
  const hex = `0x${data.toString(16)}`
  await execNativeUtf8('reg.exe', ['add', path, '/v', value, '/t', 'REG_DWORD', '/d', hex, '/f', '/reg:64'], {
    timeout: 5000,
    windowsHide: true,
  })
}

const SECEDIT_META_KEYS = new Set(['signature', 'revision'])

export function parseSeceditOutput(stdout: string): Record<string, string> {
  const vals: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const eqIdx = line.indexOf('=')
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim()
      if (SECEDIT_META_KEYS.has(k.toLowerCase())) continue
      const v = line
        .slice(eqIdx + 1)
        .trim()
        .replace(/^"|"$/g, '')
      vals[k] = v
    }
  }
  return vals
}

export function parseProbeOutput(stdout: string): ComplianceProbeData | null {
  const start = stdout.indexOf('{')
  if (start < 0) return null
  const end = stdout.lastIndexOf('}')
  if (end <= start) return null
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start, end + 1))
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ComplianceProbeData
  } catch {
    return null
  }
}

const PROBE_TIMEOUT_MS = 60_000

const PROBE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$tmp=Join-Path $env:TEMP ('dinho-sec-' + $PID + '.inf')",
  'secedit /export /cfg $tmp /quiet | Out-Null',
  '$sec=@{}',
  "if(Test-Path $tmp){ Get-Content $tmp | ForEach-Object { if($_ -match '=' -and $_ -notmatch '^\\s*[;\\[]'){ $i=$_.IndexOf('='); $k=$_.Substring(0,$i).Trim(); $sec[$k]=$_.Substring($i+1).Trim().Trim('\"') } }; Remove-Item $tmp -Force }",
  "$rg={ param($p,$v) try{ '0x{0:x}' -f [long](Get-ItemPropertyValue -Path $p -Name $v -ErrorAction Stop) }catch{ $null } }",
  "$lsap='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa'",
  "$sysp='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'",
  "$guest=''",
  "foreach($g in @('Convidado','Guest')){ $u=Get-LocalUser -Name $g -ErrorAction SilentlyContinue; if($u -and $null -ne $u.Enabled){ $guest=[string]$u.Enabled; break } }",
  "$audit=$false; try{ $audit=([string](auditpol /get /subcategory:'Logon' 2>$null)).ToLower().Contains('success') }catch{}",
  '$wua=$null; try{ $wua=[string](Get-Service -Name wuauserv -ErrorAction Stop).StartType }catch{}',
  '$bl=$null; try{ $bl=[string](Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop).ProtectionStatus }catch{}',
  '$fw=0; try{ $fw=@(Get-NetFirewallProfile | Where-Object { $_.Enabled }).Count }catch{}',
  "[pscustomobject]@{ secedit=$sec; lsaClearText=(& $rg $lsap 'ClearTextPassword'); lsaNoLMHash=(& $rg $lsap 'NoLMHash'); smb1=(& $rg 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' 'SMB1'); uacEnableLUA=(& $rg $sysp 'EnableLUA'); uacConsentPrompt=(& $rg $sysp 'ConsentPromptBehaviorAdmin'); guestEnabled=$guest; auditSuccess=$audit; wuauservStartType=$wua; bitlockerStatus=$bl; firewallEnabledCount=$fw } | ConvertTo-Json -Depth 3 -Compress",
].join('; ')

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
    evaluate: (d) => {
      const val = d.secedit?.PasswordComplexity
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
    evaluate: (d) => {
      const val = Number.parseInt(d.secedit?.MinimumPasswordLength ?? '', 10)
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
    evaluate: (d) => {
      const val = Number.parseInt(d.secedit?.MaximumPasswordAge ?? '', 10)
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
    evaluate: (d) => {
      const val = Number.parseInt(d.secedit?.LockoutBadCount ?? '', 10)
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
    evaluate: (d) => {
      const val = Number.parseInt(d.secedit?.LockoutDuration ?? '', 10)
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
    evaluate: (d) => {
      const intVal = d.lsaClearText == null ? 0 : regValueToInt(d.lsaClearText)
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
    evaluate: (d) => {
      const intVal = regValueToInt(d.lsaNoLMHash)
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
    evaluate: (d) => {
      const g = d.guestEnabled
      const enabled = typeof g === 'boolean' ? g : g != null && String(g).trim().toLowerCase() === 'true'
      return {
        compliant: !enabled,
        value: enabled ? 'Ativada' : 'Desativada',
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
    evaluate: (d) => {
      const ok = d.auditSuccess === true
      return { compliant: ok, value: ok ? 'Ativada' : 'Desativada' }
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
    evaluate: (d) => {
      const intVal = regValueToInt(d.smb1)
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
    evaluate: (d) => {
      const st = (d.wuauservStartType ?? '').trim()
      return { compliant: st.toLowerCase() !== 'disabled', value: st || 'Desconhecido' }
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
    evaluate: (d) => {
      const on = String(d.bitlockerStatus ?? '') === '1'
      return { compliant: on, value: on ? 'Ativado' : 'Desativado' }
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
    evaluate: (d) => {
      return { compliant: d.firewallEnabledCount === 3, value: `${d.firewallEnabledCount}/3 perfis` }
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
    evaluate: (d) => {
      const intVal = regValueToInt(d.uacEnableLUA)
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
    evaluate: (d) => {
      const intVal = regValueToInt(d.uacConsentPrompt)
      return { compliant: intVal === 2, value: Number.isNaN(intVal) ? 'Desconhecido' : `Nível ${intVal}` }
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

  onProgress?.({
    current: 0,
    total: CHECKS.length,
    currentLabel: 'Coletando informações do sistema',
    category: 'password',
  })

  let stdout = ''
  try {
    stdout = (
      await execNativeUtf8('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT], {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      })
    ).stdout
  } catch {
    stdout = ''
  }

  const parsed = parseProbeOutput(stdout)
  const data =
    parsed == null ? null : { ...parsed, secedit: Array.isArray(parsed.secedit) ? {} : (parsed.secedit ?? {}) }

  for (let i = 0; i < CHECKS.length; i++) {
    const def = CHECKS[i]!
    onProgress?.({ current: i + 1, total: CHECKS.length, currentLabel: def.label, category: def.category })

    let compliant = false
    let value = 'Erro'
    if (data) {
      try {
        const result = def.evaluate(data)
        compliant = result.compliant
        value = result.value
      } catch {
        compliant = false
      }
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
    if (!def?.apply) {
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
    if (!def?.revert) {
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
