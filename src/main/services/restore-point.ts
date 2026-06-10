import { execFile } from 'child_process'
import { isAdmin } from './elevation'
import { psUtf8 } from './exec-utf8'

export interface RestorePointResult {
  success: boolean
  error?: string
}

export interface RestorePointInfo {
  sequenceNumber: number
  description: string
  creationTime: string
  restorePointType: string
}

function runPs(script: string, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
      { timeout },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message || 'Unknown error'))
          return
        }
        resolve(stdout)
      }
    )
  })
}

const WMI_SR_ERROR = 'A Restauração do Sistema não está disponível. Isso pode ocorrer porque: (1) a Proteção do Sistema está desabilitada em todas as unidades, (2) o serviço VSS (Volume Shadow Copy) não está em execução, ou (3) o componente WMI do System Restore não está instalado. Para ativar, vá em: Configurações > Sistema > Sobre > Proteção do Sistema > Configurar > Ativar a proteção do sistema.'

function friendlyWmiError(raw: string): string {
  if (/Win32_SystemRestore|Invalid class|Get-WmiObject|ManagementException|Classe inválida|InvalidType/.test(raw)) {
    return WMI_SR_ERROR
  }
  return raw.slice(0, 500)
}

/**
 * Checks if System Restore is actually functional by verifying:
 * 1. VSS service is running
 * 2. The Win32_SystemRestore WMI class is available
 * 3. At least one drive has system protection enabled (via registry)
 */
async function isSystemRestoreAvailable(): Promise<boolean> {
  try {
    const script = `
      $vss = Get-Service VSS -ErrorAction SilentlyContinue
      if (-not $vss -or $vss.Status -ne 'Running') { Write-Output 'NO_VSS'; return }

      $prot = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name 'DisableSR' -ErrorAction SilentlyContinue
      if (-not $prot -or $prot.DisableSR -ne 0) {
        try { Get-WmiObject -Class Win32_SystemRestore -ErrorAction Stop | Out-Null; Write-Output 'OK' }
        catch { try { Get-CimInstance -ClassName Win32_SystemRestore -ErrorAction Stop | Out-Null; Write-Output 'OK' }
        catch { Write-Output 'NO_WMI' } }
      } else {
        Write-Output 'NO_DISABLED'
      }
    `
    const result = await runPs(script, 15_000)
    return result.trim() === 'OK'
  } catch {
    return false
  }
}

/**
 * Returns a diagnostic string about why System Restore is not available.
 * Used to provide specific guidance to the user.
 */
async function systemRestoreDiagnostic(): Promise<string> {
  try {
    const script = `
      $vss = Get-Service VSS -ErrorAction SilentlyContinue
      if (-not $vss) { Write-Output 'VSS_NOT_FOUND'; return }
      if ($vss.Status -ne 'Running') { Write-Output 'VSS_NOT_RUNNING'; return }

      $prot = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name 'DisableSR' -ErrorAction SilentlyContinue
      if ($prot -and $prot.DisableSR -eq 1) { Write-Output 'DISABLED'; return }

      try { Get-WmiObject -Class Win32_SystemRestore -ErrorAction Stop | Out-Null }
      catch { try { Get-CimInstance -ClassName Win32_SystemRestore -ErrorAction Stop | Out-Null }
      catch { Write-Output 'NO_WMI'; return } }

      Write-Output 'OK'
    `
    const result = (await runPs(script, 15_000)).trim()
    switch (result) {
      case 'VSS_NOT_FOUND': return 'O serviço Volume Shadow Copy (VSS) não está instalado.'
      case 'VSS_NOT_RUNNING': return 'O serviço VSS (Volume Shadow Copy) não está em execução.'
      case 'DISABLED': return 'A Proteção do Sistema está desabilitada em todas as unidades.'
      case 'NO_WMI': return 'O componente WMI do System Restore não está instalado.'
      default: return 'A Restauração do Sistema não está disponível.'
    }
  } catch {
    return 'Não foi possível verificar a disponibilidade da Restauração do Sistema.'
  }
}

/**
 * Enables System Protection on the C: drive.
 * Requires admin. Returns true if successful or if already enabled.
 */
export async function enableSystemProtection(): Promise<RestorePointResult> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para ativar a Proteção do Sistema.' }
  }

  try {
    const script = 'Enable-ComputerRestore -Drive "C:\\" -ErrorAction Stop'
    await runPs(script, 60_000)
    return { success: true }
  } catch (err) {
    const msg = String(err)
    return { success: false, error: friendlyWmiError(msg) }
  }
}

export async function createRestorePoint(description: string): Promise<RestorePointResult> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para criar um ponto de restauração.' }
  }

  if (!(await isSystemRestoreAvailable())) {
    const diagnostic = await systemRestoreDiagnostic()
    return { success: false, error: `${diagnostic} Para ativar, vá em: Configurações > Sistema > Sobre > Proteção do Sistema > Configurar > Ativar a proteção do sistema.` }
  }

  try {
    const script = `Checkpoint-Computer -Description '${description.replace(/'/g, "''")}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop`
    await runPs(script)
    return { success: true }
  } catch (err) {
    const msg = String(err)

    // Frequency throttle — modern Windows 10/11 uses 15 min, older uses 1440 min (24h)
    if (/frequency|1440|already created|cannot be created.*within the last|já foi criado|não.*possível criar.*porque.*já/i.test(msg)) {
      return { success: false, error: 'Um ponto de restauração já foi criado recentemente. O Windows limita a criação a um a cada 15 minutos (ou 24 horas em versões anteriores).' }
    }

    // System Protection disabled explicitly by Checkpoint-Computer
    if (/protection is not enabled|proteção.*desabilitada|disable/i.test(msg)) {
      return { success: false, error: `${SR_DISABLED_MSG} Use a opção "Ativar Proteção do Sistema" nesta página para ativar automaticamente.` }
    }

    // VSS-related errors
    if (/VSS|Volume Shadow Copy|shadow copy/i.test(msg)) {
      return { success: false, error: 'O serviço VSS (Volume Shadow Copy) não está disponível. Verifique se o serviço "Volume Shadow Copy" está em execução (services.msc).' }
    }

    return { success: false, error: friendlyWmiError(msg) }
  }
}

const SR_DISABLED_MSG = 'A Restauração do Sistema está desabilitada. Para gerenciar pontos de restauração, ative a Proteção do Sistema em: Configurações > Sistema > Sobre > Proteção do Sistema > Configurar > Ativar a proteção do sistema.'

export async function listRestorePoints(): Promise<{ success: boolean; points: RestorePointInfo[]; error?: string }> {
  if (!isAdmin()) {
    return { success: false, points: [], error: 'Privilégios de administrador necessários para listar pontos de restauração.' }
  }

  if (!(await isSystemRestoreAvailable())) {
    const diagnostic = await systemRestoreDiagnostic()
    return { success: false, points: [], error: diagnostic }
  }

  try {
    const script = `
Get-ComputerRestorePoint | Select-Object SequenceNumber, Description, CreationTime, RestorePointType | ConvertTo-Json
`
    const stdout = await runPs(script, 30_000)
    const parsed = JSON.parse(stdout.trim())
    const raw = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
    const points: RestorePointInfo[] = raw.map((r: Record<string, unknown>) => ({
      sequenceNumber: Number(r.SequenceNumber),
      description: String(r.Description || ''),
      creationTime: String(r.CreationTime || ''),
      restorePointType: String(r.RestorePointType || ''),
    }))
    return { success: true, points }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('no restore points')) {
      return { success: true, points: [] }
    }
    return { success: false, points: [], error: friendlyWmiError(msg) }
  }
}

export async function deleteRestorePoint(sequenceNumber: number): Promise<{ success: boolean; error?: string }> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para excluir um ponto de restauração.' }
  }

  if (!(await isSystemRestoreAvailable())) {
    return { success: false, error: SR_DISABLED_MSG }
  }

  try {
    const script = `Get-WmiObject -Class Win32_SystemRestore -Filter "SequenceNumber = ${sequenceNumber}" | ForEach-Object { $_.Delete() }`
    await runPs(script, 60_000)
    return { success: true }
  } catch (err) {
    const msg = String(err)
    return { success: false, error: friendlyWmiError(msg) }
  }
}

export async function restoreToPoint(sequenceNumber: number): Promise<{ success: boolean; error?: string }> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para restaurar o sistema.' }
  }

  if (!(await isSystemRestoreAvailable())) {
    return { success: false, error: SR_DISABLED_MSG }
  }

  try {
    const script = `Restore-Computer -RestorePoint ${sequenceNumber} -Confirm:$false -ErrorAction Stop`
    await runPs(script, 300_000)
    return { success: true }
  } catch (err) {
    const msg = String(err)
    return { success: false, error: friendlyWmiError(msg) }
  }
}
