import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { getHwidSync } from '../hwid'
import { getLogger } from '../logger.service'

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
    if (raw.machineId !== getHwidSync()) {
      // Snapshot de outra máquina (perfil copiado): reverter com ele aplicaria
      // valores errados, por isso é ignorado — mas registado, não em silêncio.
      getLogger().warning('windows-tweaks', 'Snapshot ignored: machine id mismatch')
      return {}
    }
    return raw.entries ?? {}
  } catch (err) {
    getLogger().warning('windows-tweaks', `Snapshot read failed: ${err}`)
    return {}
  }
}

export function saveSnapshotEntry(tweakId: string, entry: RegistryValueSnapshot): void {
  const filePath = getSnapshotFilePath()
  const current = loadSnapshotEntries()
  const next: SnapshotFile = { machineId: getHwidSync(), entries: { ...current, [tweakId]: entry } }
  mkdirSync(dirname(filePath), { recursive: true })
  // Escrita atómica: se o processo morrer a meio, o ficheiro antigo fica intacto
  // (um snapshot truncado faria o revert recair no valor de fábrica).
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
}

export function getSnapshotEntry(tweakId: string): RegistryValueSnapshot | undefined {
  return loadSnapshotEntries()[tweakId]
}
