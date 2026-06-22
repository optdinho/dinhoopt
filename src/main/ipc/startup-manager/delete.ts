import { unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { StartupItem } from '@shared/types'
import { app } from 'electron'
import { getPlatform } from '../../platform'
import { execFileAsync, execNativeUtf8, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { readDisabledEntries, withDisabledFileLock, writeDisabledEntries } from './disabled-file'
import { ALLOWED_STARTUP_LOCATIONS, isSafeTaskName } from './utils'

export async function deleteStartupItem(
  name: string,
  location: string,
  source: StartupItem['source'],
): Promise<boolean> {
  getLogger().info('startup-manager', `Deleting startup item: ${name} (${source})`)

  if (process.platform !== 'win32') {
    return getPlatform().startup.deleteItem?.(name, location, source) ?? false
  }

  let deletedSource = false

  try {
    if (source === 'task-scheduler') {
      if (!isSafeTaskName(name)) return false
      await execFileAsync(
        'powershell',
        psArgs(`Unregister-ScheduledTask -TaskName '${name.replace(/'/g, "''")}' -Confirm:$false -ErrorAction Stop`),
        { timeout: 10000, windowsHide: true },
      )
      deletedSource = true
    } else if (source === 'startup-folder') {
      const startupDir = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
      const resolvedLocation = resolve(location)
      const resolvedStartupDir = resolve(startupDir)
      if (!resolvedLocation.toLowerCase().startsWith(`${resolvedStartupDir.toLowerCase()}\\`)) {
        return false
      }
      try {
        unlinkSync(resolvedLocation)
        deletedSource = true
      } catch (err: unknown) {
        const nodeErr = err as { code?: string }
        if (nodeErr.code === 'ENOENT') deletedSource = true
      }
    } else {
      if (!ALLOWED_STARTUP_LOCATIONS.has(location)) return false
      try {
        await execNativeUtf8('reg', ['delete', location, '/v', name, '/f'], { timeout: 10000 })
        deletedSource = true
      } catch {
        deletedSource = true
      }
      const approvedKey =
        source === 'registry-hkcu'
          ? 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
          : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
      try {
        await execNativeUtf8('reg', ['delete', approvedKey, '/v', name, '/f'], { timeout: 5000 })
      } catch {
        /* may not exist */
      }
    }
  } catch {
    return false
  }

  try {
    await withDisabledFileLock(() => {
      const disabled = readDisabledEntries()
      writeDisabledEntries(disabled.filter((e) => !(e.name === name && e.source === source)))
    })
  } catch {
    /* ignore */
  }

  getLogger().info('startup-manager', `Delete ${deletedSource ? 'succeeded' : 'failed'} for: ${name}`)
  return deletedSource
}
