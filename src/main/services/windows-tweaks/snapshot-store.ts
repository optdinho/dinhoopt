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

export interface PowerCfgValueSnapshot {
  schemeGuid: string
  values: Array<{ subgroup: string; setting: string; ac: number; dc: number }>
}

interface SnapshotFile {
  machineId: string
  entries: Record<string, RegistryValueSnapshot>
  powerCfg?: Record<string, PowerCfgValueSnapshot>
}

export function getSnapshotFilePath(): string {
  return join(app.getPath('userData'), 'tweaks-snapshot.json')
}

function loadSnapshotFile(): SnapshotFile {
  try {
    const filePath = getSnapshotFilePath()
    if (!existsSync(filePath)) return { machineId: getHwidSync(), entries: {} }
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as SnapshotFile
    if (raw.machineId !== getHwidSync()) {
      // Snapshot de outra maquina (perfil copiado): reverter com ele aplicaria
      // valores errados, por isso e ignorado -- mas registado, nao em silencio.
      getLogger().warning('windows-tweaks', 'Snapshot ignored: machine id mismatch')
      return { machineId: getHwidSync(), entries: {} }
    }
    return {
      machineId: raw.machineId,
      entries: raw.entries ?? {},
      powerCfg: raw.powerCfg ?? {},
    }
  } catch (err) {
    getLogger().warning('windows-tweaks', `Snapshot read failed: ${err}`)
    return { machineId: getHwidSync(), entries: {} }
  }
}

function saveSnapshotFile(next: SnapshotFile): void {
  const filePath = getSnapshotFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  // Escrita atomica: se o processo morrer a meio, o ficheiro antigo fica intacto
  // (um snapshot truncado faria o revert recair no valor de fabrica).
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
}

export function loadSnapshotEntries(): Record<string, RegistryValueSnapshot> {
  return loadSnapshotFile().entries
}

export function saveSnapshotEntry(tweakId: string, entry: RegistryValueSnapshot): void {
  const current = loadSnapshotFile()
  saveSnapshotFile({ ...current, entries: { ...current.entries, [tweakId]: entry } })
}

export function getSnapshotEntry(tweakId: string): RegistryValueSnapshot | undefined {
  return loadSnapshotFile().entries[tweakId]
}

export function getPowerCfgSnapshot(tweakId: string): PowerCfgValueSnapshot | undefined {
  return loadSnapshotFile().powerCfg?.[tweakId]
}

export function savePowerCfgSnapshot(tweakId: string, snapshot: PowerCfgValueSnapshot): void {
  const current = loadSnapshotFile()
  saveSnapshotFile({
    ...current,
    powerCfg: { ...current.powerCfg, [tweakId]: snapshot },
  })
}

export function deletePowerCfgSnapshot(tweakId: string): void {
  const current = loadSnapshotFile()
  if (!current.powerCfg || !(tweakId in current.powerCfg)) return
  const next = { ...current.powerCfg }
  delete next[tweakId]
  saveSnapshotFile({ ...current, powerCfg: next })
}
