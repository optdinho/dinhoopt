import { execFile } from 'node:child_process'
import { isAdmin } from './elevation'
import { psUtf8 } from './exec-utf8'
import { getLogger } from './logger.service'

export interface RestorePointResult {
  success: boolean
  error?: string
  sequenceNumber?: number
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
          reject(new Error(stderr || err.message || 'Falha desconhecida'))
          return
        }
        resolve(stdout)
      },
    )
  })
}

const WMI_SR_ERROR =
  'A Restauração do Sistema não está disponível. Isso pode ocorrer porque: (1) a Proteção do Sistema está desabilitada em todas as unidades, (2) o serviço VSS (Volume Shadow Copy) não está em execução, ou (3) o componente WMI do System Restore não está instalado.'

function friendlyWmiError(raw: string): string {
  if (/Win32_SystemRestore|Invalid class|Get-WmiObject|ManagementException|Classe inválida|InvalidType/.test(raw)) {
    return WMI_SR_ERROR
  }
  return raw.slice(0, 500)
}

async function startVss(): Promise<string | null> {
  const script = `
    $vss = Get-Service VSS -ErrorAction SilentlyContinue
    if (-not $vss) { Write-Output 'VSS_NOT_FOUND'; return }
    if ($vss.Status -eq 'Running') { Write-Output 'OK'; return }
    try { Start-Service VSS -ErrorAction Stop; Write-Output 'OK' }
    catch { Write-Output ('VSS_START_FAILED:' + $_.Exception.Message) }
  `
  try {
    return (await runPs(script, 15_000)).trim()
  } catch {
    return 'VSS_CHECK_FAILED'
  }
}

async function bypassFrequencyLimit(): Promise<void> {
  const script = `
    $reg = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'
    $val = Get-ItemProperty -Path $reg -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue
    if (-not $val -or $val.SystemRestorePointCreationFrequency -ne 0) {
      Set-ItemProperty -Path $reg -Name SystemRestorePointCreationFrequency -Value 0 -Type DWord -Force
    }
  `
  try {
    await runPs(script, 10_000)
    getLogger().info('restore-point', 'Frequência de criação de ponto de restauração desabilitada')
  } catch {
    // falha ao definir a chave — prossegue mesmo assim
  }
}

async function enableSystemProtectionC(): Promise<string | null> {
  const script = `
    $prot = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name DisableSR -ErrorAction SilentlyContinue
    if ($prot -and $prot.DisableSR -eq 1) {
      try { Enable-ComputerRestore -Drive 'C:\\' -ErrorAction Stop; Write-Output 'ENABLED' }
      catch { Write-Output ('ENABLE_FAILED:' + $_.Exception.Message) }
    } else {
      try { Get-ComputerRestorePoint -ErrorAction Stop | Out-Null; Write-Output 'OK' }
      catch { try { Enable-ComputerRestore -Drive 'C:\\' -ErrorAction Stop; Write-Output 'ENABLED' }
      catch { Write-Output ('ENABLE_FAILED:' + $_.Exception.Message) } }
    }
  `
  try {
    return (await runPs(script, 30_000)).trim()
  } catch {
    return 'PROTECTION_CHECK_FAILED'
  }
}

async function verifyCreation(
  currentCount: number,
): Promise<{ verified: boolean; sequenceNumber: number; newCount: number }> {
  const script = `
    $points = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue)
    $count = $points.Count
    $lastSeq = if ($count -gt 0) { ($points | Sort-Object SequenceNumber -Descending | Select-Object -First 1).SequenceNumber } else { 0 }
    Write-Output "$count|$lastSeq"
  `
  try {
    const out = (await runPs(script, 15_000)).trim()
    const parts = out.split('|')
    const newCount = Number.parseInt(parts[0] ?? '0', 10)
    const seq = Number.parseInt(parts[1] ?? '0', 10)
    return { verified: newCount > currentCount, sequenceNumber: seq, newCount }
  } catch {
    return { verified: false, sequenceNumber: 0, newCount: 0 }
  }
}

async function getCurrentCount(): Promise<number> {
  try {
    const out = (await runPs('@(Get-ComputerRestorePoint -ErrorAction SilentlyContinue).Count', 10_000)).trim()
    return Number.parseInt(out, 10) || 0
  } catch {
    return 0
  }
}

async function isSystemRestoreAvailable(): Promise<boolean> {
  try {
    const script = `
      $vss = Get-Service VSS -ErrorAction SilentlyContinue
      if (-not $vss -or $vss.Status -ne 'Running') { Write-Output 'NO_VSS'; return }
      $prot = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name DisableSR -ErrorAction SilentlyContinue
      if (-not $prot -or $prot.DisableSR -ne 0) {
        try { Get-WmiObject -Class Win32_SystemRestore -ErrorAction Stop | Out-Null; Write-Output 'OK' }
        catch { try { Get-CimInstance -ClassName Win32_SystemRestore -ErrorAction Stop | Out-Null; Write-Output 'OK' }
        catch { Write-Output 'NO_WMI' } }
      } else { Write-Output 'NO_DISABLED' }
    `
    return (await runPs(script, 15_000)).trim() === 'OK'
  } catch {
    return false
  }
}

async function systemRestoreDiagnostic(): Promise<string> {
  try {
    const script = `
      $vss = Get-Service VSS -ErrorAction SilentlyContinue
      if (-not $vss) { Write-Output 'VSS_NOT_FOUND'; return }
      if ($vss.Status -ne 'Running') { Write-Output 'VSS_NOT_RUNNING'; return }
      $prot = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name DisableSR -ErrorAction SilentlyContinue
      if ($prot -and $prot.DisableSR -eq 1) { Write-Output 'DISABLED'; return }
      try { Get-WmiObject -Class Win32_SystemRestore -ErrorAction Stop | Out-Null }
      catch { try { Get-CimInstance -ClassName Win32_SystemRestore -ErrorAction Stop | Out-Null }
      catch { Write-Output 'NO_WMI'; return } }
      Write-Output 'OK'
    `
    const result = (await runPs(script, 15_000)).trim()
    switch (result) {
      case 'VSS_NOT_FOUND':
        return 'O serviço Volume Shadow Copy (VSS) não está instalado.'
      case 'VSS_NOT_RUNNING':
        return 'O serviço VSS (Volume Shadow Copy) não está em execução.'
      case 'DISABLED':
        return 'A Proteção do Sistema está desabilitada em todas as unidades.'
      case 'NO_WMI':
        return 'O componente WMI do System Restore não está instalado.'
      default:
        return 'A Restauração do Sistema não está disponível.'
    }
  } catch {
    return 'Não foi possível verificar a disponibilidade da Restauração do Sistema.'
  }
}

export async function enableSystemProtection(): Promise<RestorePointResult> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para ativar a Proteção do Sistema.' }
  }
  try {
    const script = 'Enable-ComputerRestore -Drive "C:\\" -ErrorAction Stop'
    await runPs(script, 60_000)
    getLogger().success('restore-point', 'Proteção do Sistema ativada em C:')
    return { success: true }
  } catch (err) {
    const msg = String(err)
    getLogger().error('restore-point', 'Falha ao ativar Proteção do Sistema', msg)
    return { success: false, error: friendlyWmiError(msg) }
  }
}

export async function createRestorePoint(description: string): Promise<RestorePointResult> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para criar um ponto de restauração.' }
  }

  const sanitized =
    description.replace(/[^\w\s.\-(),À-ÿœŒæÆ]/g, '').slice(0, 200) || 'Ponto de restauração DiNho Optimizer'

  getLogger().info('restore-point', `Criando ponto de restauração: "${sanitized}"`)

  // --- Pré-verificação ---
  if (!(await isSystemRestoreAvailable())) {
    const diagnostic = await systemRestoreDiagnostic()
    getLogger().warning('restore-point', `System Restore indisponível: ${diagnostic}`)
    return {
      success: false,
      error: `${diagnostic} Para ativar, vá em: Configurações > Sistema > Sobre > Proteção do Sistema > Configurar > Ativar a proteção do sistema.`,
    }
  }

  // --- Passo 1: Garantir que VSS está rodando ---
  const vssStatus = await startVss()
  if (vssStatus && vssStatus !== 'OK') {
    if (vssStatus === 'VSS_NOT_FOUND') {
      return {
        success: false,
        error:
          'O serviço VSS (Volume Shadow Copy) não está instalado. A Restauração do Sistema não pode funcionar sem ele.',
      }
    }
    getLogger().warning('restore-point', `VSS auto-start: ${vssStatus}`)
  }

  // --- Passo 2: Bypass do limite de frequência ---
  await bypassFrequencyLimit()

  // --- Passo 3: Ativar Proteção do Sistema se necessário ---
  const protResult = await enableSystemProtectionC()
  if (protResult?.startsWith('ENABLE_FAILED')) {
    getLogger().warning('restore-point', `Ativação de proteção: ${protResult}`)
  }

  // --- Passo 4: Contar pontos atuais para verificação ---
  const beforeCount = await getCurrentCount()

  // --- Passo 5: Criar o ponto de restauração (CIM first, fallback Checkpoint-Computer) ---
  const escapedDesc = sanitized.replace(/'/g, "''")

  // Tenta CIM primeiro (moderno, recomendado pela Microsoft)
  const cimScript = `
    $params = @{ Description = '${escapedDesc}'; RestorePointType = [uint32]12; EventType = [uint32]100 }
    try {
      $null = Invoke-CimMethod -Namespace 'root/default' -ClassName SystemRestore -MethodName CreateRestorePoint -Arguments $params -ErrorAction Stop
      $params.EventType = [uint32]101
      $null = Invoke-CimMethod -Namespace 'root/default' -ClassName SystemRestore -MethodName CreateRestorePoint -Arguments $params -ErrorAction Stop
      Write-Output 'CIM_OK'
    } catch {
      Write-Output ('CIM_FAILED:' + $_.Exception.Message)
    }
  `
  const cimOut = (await runPs(cimScript, 60_000)).trim()

  if (cimOut === 'CIM_OK') {
    const { verified, sequenceNumber } = await verifyCreation(beforeCount)
    if (verified) {
      getLogger().success('restore-point', `Ponto de restauração criado via CIM (seq: ${sequenceNumber})`)
      return { success: true, sequenceNumber }
    }
    getLogger().warning('restore-point', 'CIM retornou OK mas ponto não foi criado — tentando Checkpoint-Computer')
  } else {
    getLogger().warning('restore-point', `CIM falhou: ${cimOut}`)
  }

  // Fallback: Checkpoint-Computer
  try {
    const script = `Checkpoint-Computer -Description '${escapedDesc}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop`
    await runPs(script)
    const { verified, sequenceNumber } = await verifyCreation(beforeCount)
    if (verified) {
      getLogger().success(
        'restore-point',
        `Ponto de restauração criado via Checkpoint-Computer (seq: ${sequenceNumber})`,
      )
      return { success: true, sequenceNumber }
    }
    getLogger().warning('restore-point', 'Checkpoint-Computer não criou o ponto (silenciosamente)')
    return {
      success: false,
      error: 'O ponto de restauração não foi criado. Verifique se a Proteção do Sistema está ativada.',
    }
  } catch (err) {
    const msg = String(err)

    if (
      /frequency|1440|already created|cannot be created.*within the last|já foi criado|não.*possível criar.*porque.*já/i.test(
        msg,
      )
    ) {
      return {
        success: false,
        error:
          'Um ponto de restauração já foi criado recentemente. O Windows limita a criação a um a cada 15 minutos (ou 24 horas em versões anteriores).',
      }
    }
    if (/protection is not enabled|proteção.*desabilitada|disable/i.test(msg)) {
      return {
        success: false,
        error:
          'A Restauração do Sistema está desabilitada. Use a opção "Ativar Proteção do Sistema" nesta página para ativar automaticamente.',
      }
    }
    if (/VSS|Volume Shadow Copy|shadow copy/i.test(msg)) {
      return {
        success: false,
        error:
          'O serviço VSS (Volume Shadow Copy) não está disponível. Verifique se o serviço "Volume Shadow Copy" está em execução (services.msc).',
      }
    }

    getLogger().error('restore-point', 'Falha ao criar ponto de restauração', msg)
    return { success: false, error: friendlyWmiError(msg) }
  }
}

export async function listRestorePoints(): Promise<{ success: boolean; points: RestorePointInfo[]; error?: string }> {
  if (!isAdmin()) {
    return {
      success: false,
      points: [],
      error: 'Privilégios de administrador necessários para listar pontos de restauração.',
    }
  }

  await startVss()

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
    const raw = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    const points: RestorePointInfo[] = raw.map((r: Record<string, unknown>) => ({
      sequenceNumber: Number(r.SequenceNumber),
      description: String(r.Description || ''),
      creationTime: String(r.CreationTime || ''),
      restorePointType: String(r.RestorePointType || ''),
    }))
    getLogger().info('restore-point', `Listados ${points.length} ponto(s) de restauração`)
    return { success: true, points }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('no restore points')) {
      return { success: true, points: [] }
    }
    getLogger().error('restore-point', 'Falha ao listar pontos de restauração', msg)
    return { success: false, points: [], error: friendlyWmiError(msg) }
  }
}

export async function deleteRestorePoint(sequenceNumber: number): Promise<{ success: boolean; error?: string }> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para excluir um ponto de restauração.' }
  }

  await startVss()

  if (!(await isSystemRestoreAvailable())) {
    return { success: false, error: 'A Restauração do Sistema está desabilitada.' }
  }

  try {
    const script = `Get-WmiObject -Class Win32_SystemRestore -Filter "SequenceNumber = ${sequenceNumber}" | ForEach-Object { $_.Delete() }`
    await runPs(script, 60_000)
    getLogger().success('restore-point', `Ponto de restauração ${sequenceNumber} excluído`)
    return { success: true }
  } catch (err) {
    const msg = String(err)
    getLogger().error('restore-point', `Falha ao excluir ponto ${sequenceNumber}`, msg)
    return { success: false, error: friendlyWmiError(msg) }
  }
}

export async function restoreToPoint(sequenceNumber: number): Promise<{ success: boolean; error?: string }> {
  if (!isAdmin()) {
    return { success: false, error: 'Privilégios de administrador necessários para restaurar o sistema.' }
  }

  await startVss()

  if (!(await isSystemRestoreAvailable())) {
    return { success: false, error: 'A Restauração do Sistema está desabilitada.' }
  }

  try {
    const script = `Restore-Computer -RestorePoint ${sequenceNumber} -Confirm:$false -ErrorAction Stop`
    await runPs(script, 300_000)
    getLogger().success('restore-point', `Restauração para o ponto ${sequenceNumber} iniciada`)
    return { success: true }
  } catch (err) {
    const msg = String(err)
    getLogger().error('restore-point', `Falha ao restaurar para o ponto ${sequenceNumber}`, msg)
    return { success: false, error: friendlyWmiError(msg) }
  }
}
