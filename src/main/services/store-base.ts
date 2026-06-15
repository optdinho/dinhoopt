import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface JsonStoreOptions<T> {
  name: string
  defaults: T
  devSuffix?: string
}

export interface JsonStore<T> {
  load(): T
  save(data: T): void
  update(updater: (data: T) => T): T
  path: string
  resetCache(): void
}

export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const { name, defaults, devSuffix = 'DiNho-Dev' } = options

  let _dataDir: string | null = null
  let _path: string | null = null

  function getDataDir(): string {
    if (!_dataDir) {
      _dataDir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), devSuffix)
    }
    return _dataDir
  }

  function storePath(): string {
    if (!_path) _path = join(getDataDir(), name)
    return _path
  }

  function ensureDir(): void {
    mkdirSync(getDataDir(), { recursive: true })
  }

  return {
    get path() {
      return storePath()
    },

    load(): T {
      try {
        const p = storePath()
        if (!existsSync(p)) return JSON.parse(JSON.stringify(defaults))
        const raw = readFileSync(p, 'utf-8')
        return JSON.parse(raw) as T
      } catch {
        return JSON.parse(JSON.stringify(defaults))
      }
    },

    save(data: T): void {
      ensureDir()
      writeFileSync(storePath(), JSON.stringify(data, null, 2))
    },

    update(updater: (data: T) => T): T {
      const current = this.load()
      const updated = updater(current)
      this.save(updated)
      return updated
    },

    resetCache(): void {
      _dataDir = null
      _path = null
    },
  }
}
