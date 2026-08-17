import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { machineId } from 'node-machine-id'
import { getLogger } from './logger.service'

export async function generateHwid(): Promise<string> {
  try {
    return await machineId()
  } catch {
    const hwidFile = join(app.getPath('userData'), '.hwid')
    try {
      if (existsSync(hwidFile)) {
        return readFileSync(hwidFile, 'utf-8').trim()
      }
    } catch {}

    try {
      const parts: string[] = []
      try {
        parts.push(hostname())
      } catch {}
      try {
        const { username } = userInfo()
        parts.push(username)
      } catch {}
      try {
        parts.push(process.env.MACHINE_GUID || '')
      } catch {}
      parts.push(randomBytes(16).toString('hex'))

      const hwid = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)

      try {
        writeFileSync(hwidFile, hwid, 'utf-8')
      } catch (err) {
        getLogger().warning('Hwid', `Failed to persist fallback HWID: ${err}`)
      }

      return hwid
    } catch (err) {
      getLogger().warning('Hwid', `All HWID sources failed, using 'unknown-hwid': ${err}`)
      return 'unknown-hwid'
    }
  }
}

export async function getHwProfileRaw(): Promise<string> {
  try {
    return await machineId()
  } catch {
    return 'unknown-hwid'
  }
}
