import type { GameModeSnapshot } from '@shared/types'
import { getDetectedGame } from '../../../services/game-detector'
import { getLogger } from '../../../services/logger.service'
import { ps } from '../utils'

export async function captureAndSetGamePriority(snapshot: GameModeSnapshot): Promise<void> {
  const gameName = getDetectedGame()
  if (!gameName) return

  try {
    const out = await ps(
      `$procs = Get-Process -Name '${gameName.replace('.exe', '')}' -ErrorAction SilentlyContinue; foreach ($p in $procs) { $p.PriorityClass; }`,
      10000,
    )
    const lines = out.trim().split(/\r?\n/).filter(Boolean)

    for (const line of lines) {
      const originalPriority = line.trim()
      if (!originalPriority) continue
      const procsOut = await ps(
        `(Get-Process -Name '${gameName.replace('.exe', '')}' -ErrorAction SilentlyContinue) | Select-Object Id, PriorityClass | ConvertTo-Json`,
        10000,
      )
      let procs: Array<{ Id?: number }> = []
      try {
        const parsed = JSON.parse(procsOut)
        procs = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return
      }

      for (const proc of procs) {
        if (!proc || typeof proc.Id !== 'number') continue
        const pid = proc.Id
        try {
          await ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).PriorityClass = 'High'`, 5000)
          snapshot.gameProcessPriorities.push({
            name: gameName,
            pid,
            originalPriority,
          })
        } catch {
          /* process may have exited */
        }
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
