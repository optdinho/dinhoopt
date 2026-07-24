import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileWatcherService } from './file-watcher.service'

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

interface MockWatcher {
  close: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
}

const emittedWatchers: MockWatcher[] = []

vi.mock('node:fs', () => ({
  watch: vi.fn((_path: string, _listener: (eventType: string, filename: string | null) => void) => {
    const watcher: MockWatcher = {
      close: vi.fn(),
      emit: vi.fn((event: string, eventType: string, filename: string | null) => {
        if (event === 'change' && _listener) {
          _listener(eventType, filename)
        }
      }),
    }
    emittedWatchers.push(watcher)
    return watcher
  }),
}))

function triggerWatchEvent(eventType: string, filename: string | null): void {
  const watcher = emittedWatchers[0]
  if (watcher) {
    ;(watcher.emit as unknown as (...args: unknown[]) => void)('change', eventType, filename)
  }
}

describe('FileWatcherService', () => {
  let service: FileWatcherService

  beforeEach(() => {
    emittedWatchers.length = 0
    service = new FileWatcherService()
  })

  afterEach(() => {
    service.stop()
  })

  it('starts watching directories', () => {
    expect(service.getWatchedCount()).toBe(0)
    service.start(['C:\\test-dir'])
    expect(service.getWatchedCount()).toBe(1)
  })

  it('stop clears all watchers', () => {
    service.start(['C:\\test-dir'])
    expect(service.getWatchedCount()).toBe(1)
    service.stop()
    expect(service.getWatchedCount()).toBe(0)
  })

  it('getWatchedCount returns correct count for multiple directories', () => {
    service.start(['C:\\dir1', 'C:\\dir2'])
    expect(service.getWatchedCount()).toBe(2)
    service.stop()
    expect(service.getWatchedCount()).toBe(0)
  })

  it('handles invalid directory gracefully', async () => {
    const { watch } = await import('node:fs')
    const mockWatch = watch as unknown as ReturnType<typeof vi.fn>
    mockWatch.mockImplementationOnce(() => {
      throw new Error('ENOENT: permission denied')
    })
    expect(() => service.start(['Z:\\nonexistent\\path'])).not.toThrow()
    expect(service.getWatchedCount()).toBe(0)
  })

  it('does not duplicate watchers for the same directory', () => {
    service.start(['C:\\test-dir'])
    const count1 = service.getWatchedCount()
    service.start(['C:\\test-dir'])
    expect(service.getWatchedCount()).toBe(count1)
  })

  it('emits file-changed when watcher emits rename event', () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.removeAllListeners()
        reject(new Error('Timeout waiting for file-changed event'))
      }, 500)

      service.start(['C:\\test-dir'])

      service.on('file-changed', (event) => {
        clearTimeout(timer)
        try {
          expect(event).toBeDefined()
          expect(event.filePath).toBe('C:\\test-dir\\new-file.txt')
          expect(event.eventType).toBe('rename')
          expect(typeof event.timestamp).toBe('number')
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      triggerWatchEvent('rename', 'new-file.txt')
    }))

  it('emits file-changed when watcher emits change event', () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        service.removeAllListeners()
        reject(new Error('Timeout waiting for file-changed event'))
      }, 500)

      service.start(['C:\\test-dir'])

      service.on('file-changed', (event) => {
        clearTimeout(timer)
        try {
          expect(event.eventType).toBe('change')
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      triggerWatchEvent('change', 'modified.txt')
    }))

  it('ignores events with null filename', () =>
    new Promise<void>((resolve) => {
      const handler = vi.fn()
      service.on('file-changed', handler)
      service.start(['C:\\test-dir'])

      triggerWatchEvent('rename', null)

      setTimeout(() => {
        expect(handler).not.toHaveBeenCalled()
        service.stop()
        resolve()
      }, 50)
    }))

  it('supports restart after stop', () => {
    service.start(['C:\\dir1'])
    expect(service.getWatchedCount()).toBe(1)
    service.stop()
    expect(service.getWatchedCount()).toBe(0)
    service.start(['C:\\dir2'])
    expect(service.getWatchedCount()).toBe(1)
  })
})
