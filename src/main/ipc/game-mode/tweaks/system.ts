import type { GameModeSnapshot } from '@shared/types'
import { ps } from '../utils'

export async function captureAndDisableService(serviceName: string, snapshot: GameModeSnapshot): Promise<void> {
  const info = await ps(
    `Get-Service -Name '${serviceName}' -ErrorAction Stop | Select-Object -Property StartType,Status | ConvertTo-Json -Compress`,
  )
  const parsed = JSON.parse(info)
  const originalStartType = String(parsed.StartType ?? parsed.startType ?? 'Manual')
  const wasRunning = String(parsed.Status ?? parsed.status ?? '')
    .toLowerCase()
    .includes('running')

  snapshot.services.push({ name: serviceName, originalStartType, wasRunning })

  if (wasRunning) {
    await ps(`Stop-Service -Name '${serviceName}' -Force -ErrorAction SilentlyContinue`)
  }
  await ps(`Set-Service -Name '${serviceName}' -StartupType Disabled -ErrorAction Stop`)
}

export async function restoreService(entry: {
  name: string
  originalStartType: string
  wasRunning: boolean
}): Promise<void> {
  const typeMap: Record<string, string> = {
    Automatic: 'Automatic',
    Manual: 'Manual',
    Disabled: 'Disabled',
    Boot: 'Automatic',
    System: 'Automatic',
    '2': 'Automatic',
    '3': 'Manual',
    '4': 'Disabled',
  }
  const targetType = typeMap[entry.originalStartType] ?? 'Manual'
  await ps(`Set-Service -Name '${entry.name}' -StartupType ${targetType} -ErrorAction Stop`)
  if (entry.wasRunning && targetType !== 'Disabled') {
    await ps(`Start-Service -Name '${entry.name}' -ErrorAction SilentlyContinue`)
  }
}

export async function enableFocusAssist(snapshot: GameModeSnapshot): Promise<void> {
  try {
    const out = await ps(
      `$p = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'; ` +
        'if (Test-Path $p) { (Get-ItemProperty -Path $p -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED } else { 1 }',
    )
    const parsed = Number.parseInt(out, 10)
    snapshot.originalFocusAssistState = Number.isNaN(parsed) || parsed !== 0 ? 1 : 0
  } catch {
    snapshot.originalFocusAssistState = 1
  }

  await ps(
    `$p = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'; ` +
      'if (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }; ' +
      'Set-ItemProperty -Path $p -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -Value 0 -Type DWord -Force',
  )
}

export async function restoreFocusAssist(originalState: number | null): Promise<void> {
  if (originalState === null) return
  await ps(
    `$p = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'; Set-ItemProperty -Path $p -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -Value ${originalState} -Type DWord -Force`,
  )
}
