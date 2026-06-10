import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs, { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { initStore, encryptLicense, decryptLicense, readSavedKey, writeSavedKey, deleteSavedKey } from './license-store'

const ROOT = path.join(tmpdir(), 'dinho-license-store-test')

beforeEach(() => {
  try { rmSync(ROOT, { recursive: true, force: true }) } catch {}
  mkdirSync(ROOT, { recursive: true })
  initStore({
    keyFile: path.join(ROOT, 'remote-license.key'),
    saltFile: path.join(ROOT, '.store-salt'),
  })
})

afterEach(() => {
  try { rmSync(ROOT, { recursive: true, force: true }) } catch {}
})

describe('license-store', () => {
  it('encrypt produces binary blob; decrypt recovers same plaintext', () => {
    const blob = encryptLicense('my-super-secret-key')
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blob.length).toBeGreaterThanOrEqual(29)
    expect(decryptLicense(blob)).toBe('my-super-secret-key')
  })

  it('decrypt returns null on tampered payload', () => {
    const blob = encryptLicense('my-super-secret-key')
    const tampered = Buffer.concat([Buffer.from([0xff]), blob.slice(1)])
    expect(decryptLicense(tampered)).toBeNull()
  })

  it('legacy plaintext key file is still readable', () => {
    writeFileSync(path.join(ROOT, 'remote-license.key'), 'OLD-PLAINTEXT-KEY', 'utf-8')
    initStore({
      keyFile: path.join(ROOT, 'remote-license.key'),
      saltFile: path.join(ROOT, '.store-salt'),
      getMachineId: () => Buffer.from('legacy-test-id', 'utf8').slice(0, 32),
    })
    expect(readSavedKey(path.join(ROOT, 'remote-license.key'))).toBe('OLD-PLAINTEXT-KEY')
  })

  it('round-trip via disk with encrypted key', () => {
    const key = 'TEST-KEY-12345'
    writeSavedKey(path.join(ROOT, 'remote-license.key'), key)
    initStore({
      keyFile: path.join(ROOT, 'remote-license.key'),
      saltFile: path.join(ROOT, '.store-salt'),
    })
    expect(readSavedKey(path.join(ROOT, 'remote-license.key'))).toBe(key)
    deleteSavedKey(path.join(ROOT, 'remote-license.key'))
    expect(readSavedKey(path.join(ROOT, 'remote-license.key'))).toBeNull()
  })

  it('encrypt/decrypt roundtrip with empty string', () => {
    const blob = encryptLicense('')
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(decryptLicense(blob)).toBe('')
  })

  it('readSavedKey returns null for non-existent file', () => {
    expect(readSavedKey(path.join(ROOT, 'nonexistent.key'))).toBeNull()
  })

  it('deleteSavedKey does not throw on non-existent file', () => {
    expect(() => deleteSavedKey(path.join(ROOT, 'nonexistent.key'))).not.toThrow()
  })

  it('readSavedKey returns null for binary garbage (non-legacy)', () => {
    const garbage = Buffer.from([0xff, 0xfe, 0x80, 0x81, 0x00, 0x01])
    const f = path.join(ROOT, 'remote-license.key')
    fs.writeFileSync(f, garbage)
    expect(readSavedKey(f)).toBeNull()
  })

  it('writeSavedKey overwrites existing key', () => {
    const f = path.join(ROOT, 'remote-license.key')
    writeSavedKey(f, 'FIRST-KEY')
    writeSavedKey(f, 'SECOND-KEY')
    expect(readSavedKey(f)).toBe('SECOND-KEY')
  })

  it('legacy plaintext key with leading/trailing whitespace is trimmed', () => {
    const f = path.join(ROOT, 'remote-license.key')
    fs.writeFileSync(f, '  MY-LEGACY-KEY  ', 'utf-8')
    initStore({
      keyFile: f,
      saltFile: path.join(ROOT, '.store-salt'),
      getMachineId: () => Buffer.from('legacy-test-id', 'utf8').slice(0, 32),
    })
    expect(readSavedKey(f)).toBe('MY-LEGACY-KEY')
  })

  it('decrypt returns null for empty payload', () => {
    expect(decryptLicense(Buffer.alloc(0))).toBeNull()
  })

  it('decrypt returns null for short payload (< 36 bytes)', () => {
    expect(decryptLicense(Buffer.from('short'))).toBeNull()
  })
})
