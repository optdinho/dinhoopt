import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { machineId } from 'node-machine-id'

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
        const { username } = require('node:os').userInfo()
        parts.push(username)
      } catch {}
      try {
        parts.push(process.env.MACHINE_GUID || '')
      } catch {}
      parts.push(randomBytes(16).toString('hex'))

      const hwid = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)

      try {
        writeFileSync(hwidFile, hwid, 'utf-8')
      } catch {}

      return hwid
    } catch {
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
