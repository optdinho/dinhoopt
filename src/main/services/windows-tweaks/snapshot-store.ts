import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { getHwidSync } from '../hwid'

export interface RegistryValueSnapshot {
  exists: boolean
  data?: string
  regType?: 'REG_DWORD' | 'REG_SZ'
}

interface SnapshotFile {
  machineId: string
  entries: Record<string, RegistryValueSnapshot>
}

export function getSnapshotFilePath(): string {
  return join(app.getPath('userData'), 'tweaks-snapshot.json')
}

export function loadSnapshotEntries(): Record<string, RegistryValueSnapshot> {
  try {
    const filePath = getSnapshotFilePath()
    if (!existsSync(filePath)) return {}
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as SnapshotFile
    if (raw.machineId !== getHwidSync()) return {}
    return raw.entries ?? {}
  } catch {
    return {}
  }
}

export function saveSnapshotEntry(tweakId: string, entry: RegistryValueSnapshot): void {
  const filePath = getSnapshotFilePath()
  const current = loadSnapshotEntries()
  const next: SnapshotFile = { machineId: getHwidSync(), entries: { ...current, [tweakId]: entry } }
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8')
}

export function getSnapshotEntry(tweakId: string): RegistryValueSnapshot | undefined {
  return loadSnapshotEntries()[tweakId]
}
