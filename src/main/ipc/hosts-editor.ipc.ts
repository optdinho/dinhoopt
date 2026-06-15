import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { IPC } from '@shared/channels'
import type { HostsEntry, HostsFileData, HostsWriteRequest } from '@shared/types'
import { ipcMain } from 'electron'
import { isAdmin } from '../services/elevation'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

const execFileAsync = promisify(execFile)

const HOSTS_PATH = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\drivers\\etc\\hosts`

export function parseHostsForTest(content: string): HostsFileData {
  const lines = content.split(/\r?\n/)
  const entries: HostsEntry[] = []
  const headerLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    const isComment = trimmed.startsWith('#') || trimmed.startsWith(';')
    const isEmpty = trimmed.length === 0

    if (isEmpty) continue

    if (isComment) {
      headerLines.push(line)
      continue
    }

    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) {
      headerLines.push(line)
      continue
    }

    const ip = parts[0]!
    const hostname = parts[1]!
    const comment = parts.length > 2 ? `# ${parts.slice(2).join(' ')}` : ''
    const id = `${hostname}-${ip}`.toLowerCase().replace(/[^a-z0-9.-]/g, '_')

    entries.push({ id, ip, hostname, comment, enabled: true })
  }

  return { headerComment: headerLines.length > 0 ? headerLines.join('\n') : '', entries }
}

export function serializeHostsForTest(data: HostsWriteRequest): string {
  const lines: string[] = []

  if (data.headerComment) {
    lines.push(data.headerComment)
    lines.push('')
  }

  for (const entry of data.entries) {
    const prefix = entry.enabled ? '' : '# '
    const comment = entry.comment ? ` ${entry.comment}` : ''
    lines.push(`${prefix}${entry.ip} ${entry.hostname}${comment}`)
  }

  return `${lines.join('\n')}\n`
}

export function registerHostsEditorIpc(_getWindow: WindowGetter): void {
  ipcMain.handle(IPC.HOSTS_READ, async (): Promise<HostsFileData> => {
    getLogger().info('hosts-editor', 'Reading hosts file')
    try {
      const content = readFileSync(HOSTS_PATH, 'utf-8')
      return parseHostsForTest(content)
    } catch (err) {
      getLogger().error('hosts-editor', `Failed to read hosts file: ${err}`)
      return { headerComment: '', entries: [] }
    }
  })

  ipcMain.handle(IPC.HOSTS_WRITE, async (_event, request: unknown): Promise<{ success: boolean; error?: string }> => {
    getLogger().info('hosts-editor', 'Writing hosts file')
    if (!isAdmin()) {
      return { success: false, error: 'Acesso negado — execute o DiNho Optimizer como administrador.' }
    }
    try {
      const raw = request as Record<string, unknown>
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { success: false, error: 'Invalid request payload' }
      }
      if (!Array.isArray(raw.entries)) {
        return { success: false, error: 'entries must be an array' }
      }
      for (const entry of raw.entries) {
        if (!entry || typeof entry !== 'object') {
          return { success: false, error: 'Each entry must be an object' }
        }
        if (typeof entry.id !== 'string' || !entry.id) {
          return { success: false, error: 'Entry must have an id' }
        }
        const ip = entry.ip || entry.address
        if (typeof ip !== 'string') {
          return { success: false, error: 'Invalid IP address' }
        }
        if (!/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|0\.0\.0\.0)$/.test(ip) && !ip.startsWith('#')) {
          return { success: false, error: 'Invalid IP format' }
        }
      }
      const data = request as HostsWriteRequest
      const content = serializeHostsForTest(data)
      writeFileSync(HOSTS_PATH, content, 'utf-8')
      getLogger().success('hosts-editor', 'Hosts file written successfully')
      return { success: true }
    } catch (err) {
      getLogger().error('hosts-editor', `Failed to write hosts file: ${err}`)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle(IPC.HOSTS_FLUSH_DNS, async (): Promise<{ success: boolean; error?: string }> => {
    getLogger().info('hosts-editor', 'Flushing DNS cache')
    try {
      await execFileAsync('ipconfig', ['/flushdns'], { timeout: 10000, windowsHide: true })
      getLogger().success('hosts-editor', 'DNS cache flushed')
      return { success: true }
    } catch (err) {
      getLogger().error('hosts-editor', `Failed to flush DNS: ${err}`)
      return { success: false, error: String(err) }
    }
  })
}
