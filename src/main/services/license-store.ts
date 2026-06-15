import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { userInfo } from 'node:os'

export interface StoreOpts {
  keyFile: string
  saltFile: string
  getMachineId?: () => Buffer
}

let salt: Buffer | undefined
let machineId: Buffer | undefined

export function initStore(opts: StoreOpts): void {
  salt = loadOrCreateSalt(opts.saltFile)
  machineId = (opts.getMachineId || defaultMachineId)()
}

export function getSalt(): Buffer {
  if (!salt) throw new Error('license-store not initialized')
  return salt
}

export function getMachineIdBuf(): Buffer {
  if (!machineId) throw new Error('license-store not initialized')
  return machineId
}

function defaultMachineId(): Buffer {
  const parts: string[] = []

  try {
    parts.push(hostname())
  } catch {}
  try {
    parts.push(userInfo().username)
  } catch {}

  const envParts = [
    process.env.MACHINE_GUID,
    process.env.MACHINEID,
    process.env.COMPUTERNAME,
    process.env.HOSTNAME,
  ].filter((v): v is string => !!v)
  parts.push(...envParts)

  const raw = parts.join('|')
  const buf = Buffer.from(raw, 'utf8')
  if (buf.length >= 32) return buf.subarray(0, 32)
  return Buffer.concat([buf, Buffer.alloc(32 - buf.length, 0)]).slice(0, 32)
}

function legacyMachineId(): Buffer {
  const raw =
    process.env.MACHINE_GUID ||
    process.env.MACHINEID ||
    process.env.COMPUTERNAME ||
    process.env.HOSTNAME ||
    'dinho-default-machine-id'
  const buf = Buffer.from(raw, 'utf8')
  if (buf.length >= 32) return buf.subarray(0, 32)
  return Buffer.concat([buf, Buffer.alloc(32 - buf.length, 0)]).slice(0, 32)
}

function loadOrCreateSalt(saltFile: string): Buffer {
  try {
    if (existsSync(saltFile)) return readFileSync(saltFile)
  } catch {}
  const s = randomBytes(16)
  try {
    writeFileSync(saltFile, s)
  } catch {}
  return s
}

export function encryptLicense(plaintext: string): Buffer {
  if (!salt) throw new Error('license-store not initialized')
  const iv = randomBytes(12)
  const key = scryptSync(getMachineIdBuf(), salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
}

export function decryptLicense(payload: Buffer): string | null {
  if (!salt) throw new Error('license-store not initialized')
  if (!payload || payload.length < 28) return null
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const enc = payload.subarray(28)
  const localSalt = salt
  const tryDecrypt = (machineIdBuf: Buffer): string | null => {
    try {
      const key = scryptSync(machineIdBuf, localSalt, 32)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }
  const result = tryDecrypt(getMachineIdBuf())
  if (result !== null) return result
  return tryDecrypt(legacyMachineId())
}

export function readSavedKey(keyFile: string): string | null {
  try {
    if (!existsSync(keyFile)) return null
    const raw = readFileSync(keyFile)
    const dec = decryptLicense(raw)
    if (dec) return dec
    if (raw.length && raw[0]! > 0 && raw[0]! < 127) {
      return raw.toString('utf8').trim() || null
    }
    return null
  } catch {
    return null
  }
}

export function writeSavedKey(keyFile: string, key: string): void {
  writeFileSync(keyFile, encryptLicense(key.trim()))
}

export function deleteSavedKey(keyFile: string): void {
  try {
    unlinkSync(keyFile)
  } catch {}
}
