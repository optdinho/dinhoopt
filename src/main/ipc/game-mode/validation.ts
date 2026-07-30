import type { GameModeConfig } from '@shared/types'

export const VALID_OPTIMIZATION_IDS = new Set<string>([
  'svc-wsearch',
  'svc-sysmain',
  'svc-wuauserv',
  'svc-spooler',
  'svc-diagtrack',
  'proc-kill-browsers',
  'proc-kill-chat',
  'proc-kill-updaters',
  'proc-kill-custom',
  'proc-kill-background',
  'mem-clear-standby',
  'mem-empty-working-set',
  'sys-focus-assist',
  'sys-power-plan',
  'sys-prevent-sleep',
  'sys-timer-resolution',
  'sys-disable-game-bar',
  'sys-disable-fse-opt',
  'sys-disable-transparency',
  'cpu-game-priority',
  'net-flush-dns',
  'net-disable-nagle',
  'pcie-aspm-off',
  'usb-selective-suspend-off',
  'processor-min-max',
  'vbs-enable',
])

const PROCESS_NAME_RE = /^[A-Za-z0-9._\- ]+$/

export function validateGameModeConfig(input: unknown): GameModeConfig | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>

  if (!Array.isArray(obj.enabledOptimizations)) return null
  if (obj.enabledOptimizations.length > 30) return null
  if (!obj.enabledOptimizations.every((v: unknown) => typeof v === 'string' && VALID_OPTIMIZATION_IDS.has(v as string)))
    return null

  if (!Array.isArray(obj.customProcessKillList)) return null
  if (obj.customProcessKillList.length > 50) return null
  if (
    !obj.customProcessKillList.every(
      (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100 && PROCESS_NAME_RE.test(v as string),
    )
  )
    return null

  if ('autoDetect' in obj && typeof obj.autoDetect !== 'boolean') return null
  if ('autoDeactivate' in obj && typeof obj.autoDeactivate !== 'boolean') return null
  if ('customGameProcesses' in obj) {
    if (!Array.isArray(obj.customGameProcesses)) return null
    if (obj.customGameProcesses.length > 50) return null
    if (
      !obj.customGameProcesses.every(
        (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100 && PROCESS_NAME_RE.test(v as string),
      )
    )
      return null
  }

  if ('gameProfiles' in obj) {
    if (typeof obj.gameProfiles !== 'object' || obj.gameProfiles === null || Array.isArray(obj.gameProfiles))
      return null
    const profileKeys = Object.keys(obj.gameProfiles as Record<string, unknown>)
    if (profileKeys.length > 30) return null
    for (const key of profileKeys) {
      if (!PROCESS_NAME_RE.test(key)) return null
      const profile = (obj.gameProfiles as Record<string, unknown>)[key] as Record<string, unknown>
      if (typeof profile !== 'object' || profile === null) return null
      if (typeof profile.gameName !== 'string' || profile.gameName.length > 100) return null
      if (!Array.isArray(profile.enabledOptimizations)) return null
      if (profile.enabledOptimizations.length > 30) return null
      if (
        !profile.enabledOptimizations.every(
          (v: unknown) => typeof v === 'string' && VALID_OPTIMIZATION_IDS.has(v as string),
        )
      )
        return null
    }
  }

  return obj as unknown as GameModeConfig
}
