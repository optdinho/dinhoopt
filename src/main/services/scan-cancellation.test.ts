import { describe, expect, it, vi } from 'vitest'

// ─── ReadWriteLock (replica from yara-engine.ts) ───────────────

class ReadWriteLock {
  private readers = 0
  private writers = 0
  private writeQueue: (() => void)[] = []

  async acquireRead(): Promise<void> {
    while (this.writers > 0 || this.writeQueue.length > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
    this.readers++
  }

  releaseRead(): void {
    this.readers--
    this._tryAcquireWrite()
  }

  async acquireWrite(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.writeQueue.push(() => {
        this.writers++
        resolve()
      })
      this._tryAcquireWrite()
    })
  }

  private _tryAcquireWrite(): void {
    if (this.readers === 0 && this.writers === 0 && this.writeQueue.length > 0) {
      const next = this.writeQueue.shift()
      next?.()
    }
  }

  releaseWrite(): void {
    this.writers--
    this._tryAcquireWrite()
  }
}

// ─── ScanCancelledError (replica) ──────────────────────────────

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled by user')
    this.name = 'ScanCancelledError'
  }
}

// ─── checkCancelled (replica) ──────────────────────────────────

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ScanCancelledError()
  }
}

// ─── cancelScan / cancelAllScans (replica) ─────────────────────

const activeScanControllers = new Map<string, AbortController>()

function cancelScan(scanId: string): boolean {
  const controller = activeScanControllers.get(scanId)
  if (controller) {
    controller.abort()
    activeScanControllers.delete(scanId)
    return true
  }
  return false
}

function cancelAllScans(): void {
  for (const [, controller] of activeScanControllers) {
    controller.abort()
  }
  activeScanControllers.clear()
}

// ───────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────

describe('cancelScan', () => {
  it('returns true for a valid scanId', () => {
    const controller = new AbortController()
    const id = 'test-scan-1'
    activeScanControllers.set(id, controller)

    const result = cancelScan(id)

    expect(result).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(activeScanControllers.has(id)).toBe(false)
  })

  it('returns false for an invalid scanId', () => {
    const result = cancelScan('non-existent-id')
    expect(result).toBe(false)
  })

  it('does not throw when cancelling an already-cancelled scan', () => {
    const controller = new AbortController()
    const id = 'test-scan-2'
    activeScanControllers.set(id, controller)

    const first = cancelScan(id)
    expect(first).toBe(true)

    const second = cancelScan(id)
    expect(second).toBe(false)
  })
})

describe('cancelAllScans', () => {
  it('clears all active scans', () => {
    const c1 = new AbortController()
    const c2 = new AbortController()
    activeScanControllers.set('scan-a', c1)
    activeScanControllers.set('scan-b', c2)

    cancelAllScans()

    expect(c1.signal.aborted).toBe(true)
    expect(c2.signal.aborted).toBe(true)
    expect(activeScanControllers.size).toBe(0)
  })

  it('does nothing when no scans are active', () => {
    cancelAllScans()
    expect(activeScanControllers.size).toBe(0)
  })
})

describe('ScanCancelledError', () => {
  it('has the correct name', () => {
    const err = new ScanCancelledError()
    expect(err.name).toBe('ScanCancelledError')
  })

  it('has the correct message', () => {
    const err = new ScanCancelledError()
    expect(err.message).toBe('Scan cancelled by user')
  })

  it('is an instance of Error', () => {
    const err = new ScanCancelledError()
    expect(err).toBeInstanceOf(Error)
  })
})

describe('checkCancelled', () => {
  it('throws ScanCancelledError when signal is aborted', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => checkCancelled(controller.signal)).toThrow(ScanCancelledError)
  })

  it('does nothing when signal is not aborted', () => {
    const controller = new AbortController()
    expect(() => checkCancelled(controller.signal)).not.toThrow()
  })

  it('does nothing when no signal is provided', () => {
    expect(() => checkCancelled()).not.toThrow()
  })

  it('does nothing when signal is undefined', () => {
    expect(() => checkCancelled(undefined)).not.toThrow()
  })
})

describe('ReadWriteLock', () => {
  it('allows concurrent readers', async () => {
    const lock = new ReadWriteLock()
    let readersExecuted = 0

    await lock.acquireRead()
    const p2 = lock.acquireRead().then(() => {
      readersExecuted++
      lock.releaseRead()
    })
    const p3 = lock.acquireRead().then(() => {
      readersExecuted++
      lock.releaseRead()
    })

    // Both readers should be able to acquire while first reader holds
    await new Promise((r) => setTimeout(r, 50))
    expect(readersExecuted).toBe(2)

    lock.releaseRead()
    await p2
    await p3
  })

  it('blocks writers during read', async () => {
    const lock = new ReadWriteLock()
    let writeExecuted = false

    await lock.acquireRead()
    const writePromise = lock.acquireWrite().then(() => {
      writeExecuted = true
      lock.releaseWrite()
    })

    // Writer should not execute while reader holds
    await new Promise((r) => setTimeout(r, 50))
    expect(writeExecuted).toBe(false)

    // After releasing read, writer should execute
    lock.releaseRead()
    await writePromise
    expect(writeExecuted).toBe(true)
  })

  it('queues writers and ensures exclusive access', async () => {
    const lock = new ReadWriteLock()
    const executionOrder: string[] = []

    await lock.acquireWrite()

    const p1 = lock.acquireWrite().then(() => {
      executionOrder.push('w1')
      lock.releaseWrite()
    })
    const p2 = lock.acquireWrite().then(() => {
      executionOrder.push('w2')
      lock.releaseWrite()
    })

    // No writer should execute while first writer holds
    await new Promise((r) => setTimeout(r, 50))
    expect(executionOrder).toEqual([])

    // Release first writer — next queued writer should run
    lock.releaseWrite()
    await p1
    expect(executionOrder).toEqual(['w1'])

    // Release second writer
    lock.releaseWrite()
    await p2
    expect(executionOrder).toEqual(['w1', 'w2'])
  })

  it('allows readers after writers complete', async () => {
    const lock = new ReadWriteLock()
    await lock.acquireWrite()
    lock.releaseWrite()

    await lock.acquireRead()
    expect(true).toBe(true)
    lock.releaseRead()
  })

  it('does not starve writers when readers keep coming', async () => {
    const lock = new ReadWriteLock()
    let writeRan = false

    await lock.acquireRead()

    const writePromise = lock.acquireWrite().then(() => {
      writeRan = true
      lock.releaseWrite()
    })

    // Simulate a new reader coming while write is queued
    const readPromise = lock.acquireRead().then(() => {
      lock.releaseRead()
    })

    // Neither writer nor new reader should run while first reader holds
    await new Promise((r) => setTimeout(r, 50))
    expect(writeRan).toBe(false)

    // Release first reader — writer should run before new reader
    lock.releaseRead()
    await writePromise
    expect(writeRan).toBe(true)

    // The queued reader should still work
    await readPromise
  })
})
