#!/usr/bin/env npx tsx

import { createSign, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import Database from 'better-sqlite3'

const DB_PATH = join(__dirname, '..', '..', 'resources', 'licenses', 'admin-licenses.db')

// Caminho do JSON do app (userData do Electron) - para gerar arquivo compatível
function getAppLicensesJsonPath(): string {
  // Em desenvolvimento, userData fica em %APPDATA%/dinho-optimizer
  // Em produção, Electron define automaticamente
  const appData =
    process.env.APPDATA ||
    (process.platform === 'win32' ? `${process.env.USERPROFILE}\\AppData\\Roaming` : `${process.env.HOME}/.config`)
  return join(appData, 'dinho-optimizer', 'licenses.json')
}

function saveToAppJson(license: any): void {
  const jsonPath = getAppLicensesJsonPath()
  const dir = join(jsonPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let licenses: any[] = []
  if (existsSync(jsonPath)) {
    try {
      licenses = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    } catch {}
  }

  // Remove duplicata se existir
  licenses = licenses.filter((l) => l.key !== license.key)
  licenses.push(license)

  writeFileSync(jsonPath, JSON.stringify(licenses, null, 2), 'utf-8')
}

const LICENSE_TYPES = ['trial', 'permanent', '30d', '90d', '180d', '365d'] as const
type LicenseType = (typeof LICENSE_TYPES)[number]

const LICENSE_TYPE_DURATION: Record<LicenseType, number | null> = {
  trial: 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
  permanent: null,
}

function ensureDb(): Database.Database {
  const dir = join(__dirname, '..', '..', 'resources', 'licenses')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      key TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      hwid TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_validation TEXT,
      activated_at TEXT,
      metadata TEXT DEFAULT '{}'
    )
  `)

  // Migrações robustas para bancos existentes
  const columns = ['status', 'hwid', 'last_validation', 'activated_at', 'metadata']
  for (const col of columns) {
    try {
      db.prepare(`SELECT ${col} FROM licenses LIMIT 1`).get()
    } catch {
      try {
        const def = col === 'status' ? "DEFAULT 'active'" : col === 'metadata' ? "DEFAULT '{}'" : ''
        db.exec(`ALTER TABLE licenses ADD COLUMN ${col} TEXT ${def}`)
      } catch (e) {}
    }
  }

  return db
}

function generateLicenseKey(): string {
  const segments: string[] = []
  const { randomBytes } = require('node:crypto')
  for (let i = 0; i < 5; i++) {
    segments.push(randomBytes(4).toString('hex').toUpperCase())
  }
  return segments.join('-')
}

function computeExpiration(type: LicenseType): string | null {
  const days = LICENSE_TYPE_DURATION[type]
  if (days === null) return null
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function generateKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

function rl(): ReturnType<typeof createInterface> {
  return createInterface({ input: process.stdin, output: process.stdout })
}

function ask(q: string): Promise<string> {
  const r = rl()
  return new Promise((resolve) =>
    r.question(q, (a: string) => {
      r.close()
      resolve(a.trim())
    }),
  )
}

async function menu() {
  console.clear()
  const opt = await ask('Escolha uma opção: ')
  const handlers: Record<string, () => Promise<void>> = {
    '1': generateSingle,
    '2': generateBatch,
    '3': listAll,
    '4': searchKey,
    '5': revokeKey,
    '6': resetHwid,
    '7': renewKey,
    '8': exportDb,
    '9': generateRsaKeys,
    '10': showStats,
    '0': async () => process.exit(0),
  }
  if (handlers[opt]) {
    try {
      await handlers[opt]()
    } catch (err: any) {
      console.error(`\n❌ Erro ao executar a operação: ${err?.message || err}`)
    }
  } else {
  }
  await ask('Pressione Enter para continuar...')
  menu()
}

async function askType(): Promise<LicenseType> {
  LICENSE_TYPES.forEach((t, i) => {
    const desc = t === 'trial' ? '7 dias' : t === 'permanent' ? 'Permanente' : t
  })
  const opt = Number.parseInt(await ask('Escolha o tipo: '))
  const idx = opt - 1
  if (idx >= 0 && idx < LICENSE_TYPES.length) return LICENSE_TYPES[idx]
  return 'permanent'
}

function getDb() {
  return ensureDb()
}

async function generateSingle() {
  const type = await askType()

  let key = await ask('Digite uma chave personalizada (ou pressione Enter para gerar automaticamente): ')
  if (!key) {
    key = generateLicenseKey()
  } else {
    key = key.toUpperCase().trim()
  }

  const hwid = await ask('Deseja vincular a um HWID (ID de Hardware) agora? (Pressione Enter para deixar em branco): ')

  const db = getDb()
  const now = new Date().toISOString()
  const expiresAt = computeExpiration(type)

  db.prepare(`
    INSERT INTO licenses (key, type, status, hwid, created_at, expires_at, activated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?)
  `).run(key, type, hwid ? hwid : null, now, expiresAt, hwid ? now : null)

  // Também salva no JSON do app
  const licenseObj = {
    key,
    type,
    status: 'active',
    hwid: hwid ? hwid : null,
    createdAt: now,
    expiresAt,
    lastValidation: null,
    activatedAt: hwid ? now : null,
    metadata: {},
  }
  saveToAppJson(licenseObj)
}

async function generateBatch() {
  const type = await askType()
  const count = Number.parseInt(await ask('Quantas chaves? '))
  if (Number.isNaN(count) || count < 1 || count > 1000) {
    return
  }
  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO licenses (key, type, status, created_at, expires_at)
    VALUES (?, ?, 'active', ?, ?)
  `)
  const now = new Date().toISOString()
  const expiresAt = computeExpiration(type)
  const keys: string[] = []
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const key = generateLicenseKey()
      keys.push(key)
      insert.run(key, type, now, expiresAt)

      // Também salva no JSON do app
      const licenseObj = {
        key,
        type,
        status: 'active',
        hwid: null,
        createdAt: now,
        expiresAt,
        lastValidation: null,
        activatedAt: null,
        metadata: {},
      }
      saveToAppJson(licenseObj)
    }
  })
  tx()

  const show = await ask('Exibir chaves? (s/N): ')
  if (show.toLowerCase() === 's') {
    for (const k of keys) {
    }
  }
}

async function listAll() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all() as any[]
  if (rows.length === 0) {
    return
  }
  for (const r of rows) {
    const expires = r.expires_at ? new Date(r.expires_at).toLocaleDateString('pt-BR') : 'Nunca'
    const hwid = r.hwid ? `${r.hwid.slice(0, 16)}...` : '-'
  }
}

async function searchKey() {
  const q = await ask('Pesquisar (chave, HWID, tipo, status): ')
  const db = getDb()
  const pattern = `%${q}%`
  const rows = db
    .prepare(`
    SELECT * FROM licenses
    WHERE key LIKE ? OR hwid LIKE ? OR type LIKE ? OR status LIKE ?
    ORDER BY created_at DESC
  `)
    .all(pattern, pattern, pattern, pattern) as any[]
  if (rows.length === 0) {
    return
  }
  for (const r of rows) {
  }
}

async function revokeKey() {
  const key = await ask('Chave para revogar: ')
  const db = getDb()
  const result = db.prepare('UPDATE licenses SET status = ? WHERE key = ?').run('revoked', key.toUpperCase())
  if (result.changes > 0) {
  } else {
  }
}

async function resetHwid() {
  const key = await ask('Chave para resetar HWID: ')
  const db = getDb()
  const result = db
    .prepare('UPDATE licenses SET hwid = NULL, status = ?, activated_at = NULL WHERE key = ?')
    .run('active', key.toUpperCase())
  if (result.changes > 0) {
  } else {
  }
}

async function renewKey() {
  const key = await ask('Chave para renovar: ')
  const db = getDb()
  const existing = db.prepare('SELECT * FROM licenses WHERE key = ?').get(key.toUpperCase()) as any
  if (!existing) {
    return
  }
  const newType = await askType()
  const expiresAt = computeExpiration(newType)
  db.prepare(`
    UPDATE licenses SET type = ?, expires_at = ?, status = 'active', last_validation = ?
    WHERE key = ?
  `).run(newType, expiresAt, new Date().toISOString(), key.toUpperCase())
}

async function exportDb() {
  const dbPath = DB_PATH
  const exportPath = join(__dirname, '..', '..', 'resources', 'licenses', `licenses-export-${Date.now()}.db`)
  const { copyFileSync } = require('node:fs')
  copyFileSync(dbPath, exportPath)
}

async function generateRsaKeys() {
  const { publicKey, privateKey } = generateKeys()
  const dir = join(__dirname, '..', '..', 'resources', 'licenses')
  writeFileSync(join(dir, 'public.pem'), publicKey)
  writeFileSync(join(dir, 'private.pem'), privateKey)
}

async function showStats() {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM licenses').get() as any).c
  const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM licenses GROUP BY status').all() as any[]
  const byType = db.prepare('SELECT type, COUNT(*) as c FROM licenses GROUP BY type').all() as any[]
  for (const s of byStatus) {
  }
  for (const t of byType) {
  }
  const activated = (db.prepare('SELECT COUNT(*) as c FROM licenses WHERE hwid IS NOT NULL').get() as any).c
  const pending = (
    db.prepare('SELECT COUNT(*) as c FROM licenses WHERE hwid IS NULL AND status = ?').get('active') as any
  ).c
}

menu()
