import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { execFileAsync, psUtf8 } from '../../../services/exec-utf8'
import { getLogger } from '../../../services/logger.service'
import type { WindowGetter } from '../../index'

export interface GamingTimerStatus {
  hpetOff: boolean
  tscSyncPolicy: 'legacy' | 'enhanced' | 'default'
  dynamicTickDisabled: boolean
  autoTuningDisabled: boolean
}

async function queryBcdEditEnum(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('bcdedit', ['/enum'], {
      timeout: 10000,
      windowsHide: true,
    })
    return stdout
  } catch {
    return ''
  }
}

function parseBcdValue(output: string, key: string): string | null {
  const regex = new RegExp(`^\\s*${key}\\s+(.+?)\\s*$`, 'im')
  const match = output.match(regex)
  return match?.[1]?.trim() ?? null
}

async function getTimerStatus(): Promise<GamingTimerStatus> {
  try {
    const [bcdOut, tuningOut] = await Promise.all([
      queryBcdEditEnum(),
      execFileAsync('netsh', ['int', 'tcp', 'show', 'global'], { timeout: 10000, windowsHide: true })
        .then((r) => r.stdout)
        .catch(() => ''),
    ])

    const hpetValue = parseBcdValue(bcdOut, 'useplatformclock')
    const hpetOff = hpetValue !== null ? /No/i.test(hpetValue) : false

    const tickValue = parseBcdValue(bcdOut, 'disabledynamictick')
    const dynamicTickDisabled = tickValue !== null ? /Yes/i.test(tickValue) : false

    const tscValue = parseBcdValue(bcdOut, 'tscsyncpolicy')
    let tscSyncPolicy: GamingTimerStatus['tscSyncPolicy'] = 'default'
    if (tscValue) {
      if (/legacy/i.test(tscValue)) tscSyncPolicy = 'legacy'
      else if (/enhanced/i.test(tscValue)) tscSyncPolicy = 'enhanced'
    }

    const autoTuningDisabled = /disabled/i.test(tuningOut) && !/normal/i.test(tuningOut)

    return { hpetOff, tscSyncPolicy, dynamicTickDisabled, autoTuningDisabled }
  } catch (err) {
    getLogger().error('windows-tweaks', `getTimerStatus failed: ${err}`)
    return { hpetOff: false, tscSyncPolicy: 'default', dynamicTickDisabled: false, autoTuningDisabled: false }
  }
}

async function setHpetOff(off: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    if (off) {
      await execFileAsync('bcdedit', ['/set', 'useplatformclock', 'false'], {
        timeout: 10000,
        windowsHide: true,
      })
    } else {
      await execFileAsync('bcdedit', ['/deletevalue', 'useplatformclock'], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {
        // Value may not exist — that's fine, it means default (TSC)
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function setTscSyncPolicy(
  policy: 'legacy' | 'enhanced' | 'default',
): Promise<{ success: boolean; error?: string }> {
  try {
    if (policy === 'default') {
      await execFileAsync('bcdedit', ['/deletevalue', 'tscsyncpolicy'], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {})
    } else {
      await execFileAsync('bcdedit', ['/set', 'tscsyncpolicy', policy], {
        timeout: 10000,
        windowsHide: true,
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function setDynamicTick(disabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    if (disabled) {
      await execFileAsync('bcdedit', ['/set', 'disabledynamictick', 'yes'], {
        timeout: 10000,
        windowsHide: true,
      })
    } else {
      await execFileAsync('bcdedit', ['/deletevalue', 'disabledynamictick'], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {})
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function setAutoTuning(
  disabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const level = disabled ? 'disabled' : 'normal'
    await execFileAsync('netsh', ['int', 'tcp', 'set', 'global', `autotuninglevel=${level}`], {
      timeout: 10000,
      windowsHide: true,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export function registerGamingTweaks(_getWindow: WindowGetter): void {
  getLogger().info('windows-tweaks', 'Registering gaming/timer tweak handlers')

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET,
    async (): Promise<GamingTimerStatus> => {
      getLogger().info('windows-tweaks', 'Gaming timer status requested')
      return getTimerStatus()
    },
  )

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET,
    async (
      _event,
      settings: Partial<Pick<GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>>,
    ): Promise<{ success: boolean; errors: string[] }> => {
      getLogger().info('windows-tweaks', `Gaming timer set: ${JSON.stringify(settings)}`)
      const errors: string[] = []

      if (settings.hpetOff !== undefined) {
        const r = await setHpetOff(settings.hpetOff)
        if (!r.success) errors.push(`HPET: ${r.error}`)
      }
      if (settings.tscSyncPolicy !== undefined) {
        const r = await setTscSyncPolicy(settings.tscSyncPolicy)
        if (!r.success) errors.push(`TSC Sync: ${r.error}`)
      }
      if (settings.dynamicTickDisabled !== undefined) {
        const r = await setDynamicTick(settings.dynamicTickDisabled)
        if (!r.success) errors.push(`Dynamic Tick: ${r.error}`)
      }

      if (errors.length > 0) {
        getLogger().error('windows-tweaks', `Gaming timer errors: ${errors.join('; ')}`)
        return { success: false, errors }
      }
      getLogger().success('windows-tweaks', 'Gaming timer settings applied')
      return { success: true, errors: [] }
    },
  )

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT,
    async (): Promise<{ success: boolean; errors: string[] }> => {
      getLogger().info('windows-tweaks', 'Gaming timer revert requested')
      const errors: string[] = []

      const r1 = await setHpetOff(false)
      if (!r1.success) errors.push(`HPET revert: ${r1.error}`)

      const r2 = await setTscSyncPolicy('default')
      if (!r2.success) errors.push(`TSC Sync revert: ${r2.error}`)

      const r3 = await setDynamicTick(false)
      if (!r3.success) errors.push(`Dynamic Tick revert: ${r3.error}`)

      const r4 = await setAutoTuning(false)
      if (!r4.success) errors.push(`TCP AutoTuning revert: ${r4.error}`)

      if (errors.length > 0) {
        getLogger().error('windows-tweaks', `Gaming timer revert errors: ${errors.join('; ')}`)
        return { success: false, errors }
      }
      getLogger().success('windows-tweaks', 'Gaming timer reverted to defaults')
      return { success: true, errors: [] }
    },
  )

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING,
    async (
      _event,
      action: 'apply' | 'revert',
    ): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('windows-tweaks', `AutoTuning ${action}`)
      return setAutoTuning(action === 'apply')
    },
  )
}
