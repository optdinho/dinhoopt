import { renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { StartupItem } from '@shared/types'
import { app } from 'electron'
import { getPlatform } from '../../platform'
import { execFileAsync, execNativeUtf8, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { readDisabledEntries, withDisabledFileLock, writeDisabledEntries } from './disabled-file'
import { ALLOWED_STARTUP_LOCATIONS, isSafeTaskName } from './utils'

export async function toggleStartupItem(
  name: string,
  location: string,
  command: string,
  source: StartupItem['source'],
  enabled: boolean,
): Promise<boolean> {
  getLogger().info('startup-manager', `${enabled ? 'Enabling' : 'Disabling'} startup item: ${name} (${source})`)

  if (process.platform !== 'win32') {
    return getPlatform().startup.toggleItem(name, location, command, source, enabled)
  }

  if (source === 'task-scheduler') {
    if (!isSafeTaskName(name)) return false
    try {
      const action = enabled ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask'
      await execFileAsync('powershell', psArgs(`${action} -TaskName '${name.replace(/'/g, "''")}' -ErrorAction Stop`), {
        timeout: 10000,
        windowsHide: true,
      })
    } catch {
      return false
    }
    return true
  }

  if (source === 'startup-folder') {
    const startupDir = resolve(
      join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    )
    const resolvedPath = resolve(command)
    if (!resolvedPath.toLowerCase().startsWith(`${startupDir.toLowerCase()}\\`)) {
      return false
    }
    const disabledPath = `${resolvedPath}.disabled`
    try {
      if (enabled) {
        renameSync(disabledPath, resolvedPath)
      } else {
        renameSync(resolvedPath, disabledPath)
      }
      return true
    } catch {
      return false
    }
  }

  if (!ALLOWED_STARTUP_LOCATIONS.has(location)) return false

  const isHklm = location.startsWith('HKLM\\')
  const regFlags: string[] = isHklm ? ['/reg:64'] : []

  const approvedKey =
    source === 'registry-hkcu'
      ? 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
      : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
  const approvedRegFlags: string[] = approvedKey.startsWith('HKLM\\') ? ['/reg:64'] : []

  if (!enabled) {
    let approvedOk = false
    let deleteOk = false
    try {
      await execNativeUtf8(
        'reg',
        [
          'add',
          approvedKey,
          '/v',
          name,
          '/t',
          'REG_BINARY',
          '/d',
          '030000000000000000000000',
          '/f',
          ...approvedRegFlags,
        ],
        { timeout: 10000 },
      )
      approvedOk = true
    } catch {
      /* may not exist yet */
    }

    try {
      await execNativeUtf8('reg', ['delete', location, '/v', name, '/f', ...regFlags], { timeout: 10000 })
      deleteOk = true
    } catch {
      /* permissions */
    }

    if (!approvedOk && !deleteOk) return false

    await withDisabledFileLock(() => {
      const disabled = readDisabledEntries()
      if (!disabled.some((e) => e.name === name && e.source === source)) {
        disabled.push({ name, command, location, source })
      }
      writeDisabledEntries(disabled)
    })
  } else {
    const disabled = readDisabledEntries()
    const stored = disabled.find((e) => e.name === name && e.source === source)
    if (!stored) {
      getLogger().info('startup-manager', `No stored entry for ${name} — enabling via StartupApproved only`)
      try {
        await execNativeUtf8(
          'reg',
          [
            'add',
            approvedKey,
            '/v',
            name,
            '/t',
            'REG_BINARY',
            '/d',
            '020000000000000000000000',
            '/f',
            ...approvedRegFlags,
          ],
          { timeout: 10000 },
        )
        return true
      } catch {
        return false
      }
    }
    const safeCommand = stored.command

    let addOk = false
    try {
      await execNativeUtf8('reg', ['add', location, '/v', name, '/t', 'REG_SZ', '/d', safeCommand, '/f', ...regFlags], {
        timeout: 10000,
      })
      addOk = true
    } catch {
      /* permissions */
    }

    try {
      await execNativeUtf8(
        'reg',
        [
          'add',
          approvedKey,
          '/v',
          name,
          '/t',
          'REG_BINARY',
          '/d',
          '020000000000000000000000',
          '/f',
          ...approvedRegFlags,
        ],
        { timeout: 10000 },
      )
    } catch {
      /* non-critical */
    }

    if (!addOk) return false

    await withDisabledFileLock(() => {
      const current = readDisabledEntries()
      writeDisabledEntries(current.filter((e) => !(e.name === name && e.source === source)))
    })
  }
  getLogger().success('startup-manager', `Toggle complete for: ${name}`)
  return true
}
