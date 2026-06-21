import { EventEmitter } from 'node:events'
import { type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'
import { getLogger } from './logger.service'

interface WatchedDirectory {
  path: string
  watcher: FSWatcher
}

export interface FileChangedEvent {
  filePath: string
  eventType: 'rename' | 'change'
  timestamp: number
}

export class FileWatcherService extends EventEmitter {
  private watchers: Map<string, WatchedDirectory> = new Map()
  private isWatching = false

  start(directories: string[]): void {
    for (const dirPath of directories) {
      if (this.watchers.has(dirPath)) continue
      try {
        const watcher = watch(dirPath, (eventType, filename) => {
          if (filename) {
            this.emit('file-changed', {
              filePath: join(dirPath, filename),
              eventType,
              timestamp: Date.now(),
            } satisfies FileChangedEvent)
          }
        })
        this.watchers.set(dirPath, { path: dirPath, watcher })
      } catch (err) {
        getLogger().warning(
          'file-watcher',
          `Failed to watch directory: ${dirPath}`,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
    this.isWatching = true
  }

  stop(): void {
    for (const [, { watcher }] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
    this.isWatching = false
  }

  isActive(): boolean {
    return this.isWatching
  }

  getWatchedCount(): number {
    return this.watchers.size
  }
}
