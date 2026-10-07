import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { machineId, machineIdSync } from 'node-machine-id'
import { getLogger } from './logger.service'

export async function generateHwid(): Promise<string> {
  try {
    return await machineId()
  } catch {
    const hwidFile = join(app.getPath('userData'), '.hwid')
    let cachedUnreadable = false
    try {
      if (existsSync(hwidFile)) {
        return readFileSync(hwidFile, 'utf-8').trim()
      }
    } catch (err) {
      // O ficheiro existe mas nao consegue ser lido: gravar por cima destruiria
      // o HWID persistido e invalidaria a licenca. Devolve um valor so para esta
      // sessao e deixa a falha visivel.
      cachedUnreadable = true
      getLogger().warning('Hwid', `Failed to read cached HWID at ${hwidFile}, keeping the file: ${err}`)
    }

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

      // Sem randomBytes: o fallback tem de ser deterministico, senao cada arranque
      // (ou cada escrita falhada) gera um HWID novo e a licenca invalida-se.
      const hwid = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)

      if (cachedUnreadable) return hwid

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

/** HWID sincrono para caminhos que nao podem ser `async` (assinatura do cache
 *  de licenca). Deve produzir o MESMO valor que `generateHwid()` na mesma
 *  maquina, senao um cache escrito numa sessao deixaria de validar na seguinte. */
export function getHwidSync(): string {
  try {
    return machineIdSync(false)
  } catch {}
  const hwidFile = join(app.getPath('userData'), '.hwid')
  try {
    if (existsSync(hwidFile)) {
      const value = readFileSync(hwidFile, 'utf-8').trim()
      if (value) return value
    }
  } catch {
    // cai no derivacao deterministica em baixo
  }
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
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
  } catch {
    return 'unknown-hwid'
  }
}

export async function getHwProfileRaw(): Promise<string> {
  try {
    return await machineId()
  } catch {
    return 'unknown-hwid'
  }
}
