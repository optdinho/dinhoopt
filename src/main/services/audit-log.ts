import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

interface AuditEntry {
  timestamp: string
  action: string
  category: string
  details: Record<string, unknown>
  admin: boolean
}

let auditPath: string | null = null

export function initAuditLog(): void {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  auditPath = join(dir, 'audit.jsonl')
}

export function logAudit(action: string, category: string, details: Record<string, unknown> = {}): void {
  if (!auditPath) return
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    category,
    details,
    admin: process.env.ELEVATED === '1',
  }
  try {
    appendFileSync(auditPath, `${JSON.stringify(entry)}\n`)
  } catch (err) {
    /* best effort — audit logging must never crash the app */
    console.error('Audit log write failed:', err)
  }
}
