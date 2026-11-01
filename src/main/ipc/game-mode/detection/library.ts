import type { GameCpuPriority, GameIoPriority, GameModeSnapshot } from '@shared/types'
import { getDetectedGame } from '../../../services/game-detector'
import { ps } from '../utils'

const CPU_PRIORITY_TO_PS: Record<GameCpuPriority, string> = {
  normal: 'Normal',
  aboveNormal: 'AboveNormal',
  high: 'High',
}

const IO_PRIORITY_TO_NUMBER: Record<GameIoPriority, number> = {
  veryLow: 0,
  low: 1,
  normal: 2,
}

function buildIoPriorityScript(pid: number, priority: number): string {
  return [
    '$sig = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class DinhoIoPriority {',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  public static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  public static extern bool CloseHandle(IntPtr handle);',
    '  [DllImport("ntdll.dll")]',
    '  public static extern int NtSetInformationProcess(IntPtr handle, int infoClass, ref int value, int length);',
    '  public static int Set(int processId, int ioPriority) {',
    '    IntPtr handle = OpenProcess(0x0600, false, processId);',
    '    if (handle == IntPtr.Zero) { return -1; }',
    '    try { int value = ioPriority; return NtSetInformationProcess(handle, 33, ref value, 4); }',
    '    finally { CloseHandle(handle); }',
    '  }',
    '}',
    '"@',
    `Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue`,
    `[DinhoIoPriority]::Set(${pid}, ${priority}) | Out-Null`,
  ].join('\n')
}

async function setProcessIoPriority(pid: number, priority: GameIoPriority): Promise<void> {
  if (priority === 'normal') return
  await ps(buildIoPriorityScript(pid, IO_PRIORITY_TO_NUMBER[priority]), 8000)
}

export async function captureAndSetGamePriority(
  snapshot: GameModeSnapshot,
  cpuPriority: GameCpuPriority = 'high',
  ioPriority: GameIoPriority = 'normal',
): Promise<void> {
  const gameName = getDetectedGame()
  if (!gameName) return
  const processName = gameName.replace('.exe', '')

  try {
    const procsOut = await ps(
      `(Get-Process -Name '${processName}' -ErrorAction SilentlyContinue) | Select-Object Id, PriorityClass | ConvertTo-Json`,
      10000,
    )
    let procs: Array<{ Id?: number; PriorityClass?: string }> = []
    try {
      const parsed = JSON.parse(procsOut)
      procs = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return
    }

    for (const proc of procs) {
      if (!proc || typeof proc.Id !== 'number') continue
      const pid = proc.Id
      const originalPriority = typeof proc.PriorityClass === 'string' ? proc.PriorityClass : 'Normal'
      try {
        await ps(
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).PriorityClass = '${CPU_PRIORITY_TO_PS[cpuPriority]}'`,
          5000,
        )
        await setProcessIoPriority(pid, ioPriority)
        snapshot.gameProcessPriorities.push({
          name: gameName,
          pid,
          originalPriority,
        })
      } catch {
        /* process may have exited */
      }
    }
  } catch {
    /* no matching process */
  }
}

export async function restoreGamePriority(
  entries: Array<{ name: string; pid: number; originalPriority: string }>,
): Promise<void> {
  for (const entry of entries) {
    try {
      await ps(
        `$p = Get-Process -Id ${entry.pid} -ErrorAction SilentlyContinue; ` +
          `if ($p) { $p.PriorityClass = '${entry.originalPriority}' }`,
        5000,
      )
      await ps(buildIoPriorityScript(entry.pid, IO_PRIORITY_TO_NUMBER.normal), 8000)
    } catch {
      /* process may have exited — that's fine */
    }
  }
}

export async function applyRegistryTweak(
  snapshot: GameModeSnapshot,
  regPath: string,
  name: string,
  newValue: number,
): Promise<void> {
  let originalValue: number | null = null
  try {
    const out = await ps(
      `$v = (Get-ItemProperty -Path '${regPath}' -Name '${name}' -ErrorAction SilentlyContinue).'${name}'; if ($v -ne $null) { $v } else { 'NULL' }`,
    )
    if (out !== 'NULL' && out !== '') {
      const parsed = Number.parseInt(out, 10)
      if (!Number.isNaN(parsed)) originalValue = parsed
    }
  } catch {
    /* key doesn't exist yet — original is null */
  }

  snapshot.registryTweaks.push({ path: regPath, name, originalValue })

  await ps(
    `$p = '${regPath}'; if (!(Test-Path $p)) { New-Item -Path $p -Force | Out-Null }; Set-ItemProperty -Path $p -Name '${name}' -Value ${newValue} -Type DWord -Force`,
  )
}

export async function restoreRegistryTweaks(
  tweaks: GameModeSnapshot['registryTweaks'],
): Promise<{ restored: number; errors: Array<{ path: string; name: string; reason: string }> }> {
  let restored = 0
  const errors: Array<{ path: string; name: string; reason: string }> = []
  for (const tweak of tweaks) {
    try {
      if (tweak.originalValue !== null) {
        await ps(
          `Set-ItemProperty -Path '${tweak.path}' -Name '${tweak.name}' -Value ${tweak.originalValue} -Type DWord -Force`,
        )
      } else {
        await ps(`Remove-ItemProperty -Path '${tweak.path}' -Name '${tweak.name}' -ErrorAction SilentlyContinue`)
      }
      restored++
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown'
      errors.push({ path: tweak.path, name: tweak.name, reason })
    }
  }
  return { restored, errors }
}

export async function disableGameBar(snapshot: GameModeSnapshot): Promise<void> {
  await applyRegistryTweak(
    snapshot,
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
    'AppCaptureEnabled',
    0,
  )
  await applyRegistryTweak(snapshot, 'HKCU:\\System\\GameConfigStore', 'GameDVR_Enabled', 0)
}

export async function disableFullscreenOptimizations(snapshot: GameModeSnapshot): Promise<void> {
  await applyRegistryTweak(snapshot, 'HKCU:\\System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 2)
  await applyRegistryTweak(snapshot, 'HKCU:\\System\\GameConfigStore', 'GameDVR_HonorUserFSEBehaviorMode', 1)
  await applyRegistryTweak(snapshot, 'HKCU:\\System\\GameConfigStore', 'GameDVR_DXGIHonorFSEWindowsCompatible', 1)
  await applyRegistryTweak(snapshot, 'HKCU:\\System\\GameConfigStore', 'GameDVR_EFSEFeatureFlags', 0)
}

export async function disableTransparency(snapshot: GameModeSnapshot): Promise<void> {
  await applyRegistryTweak(
    snapshot,
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
    'EnableTransparency',
    0,
  )
}
