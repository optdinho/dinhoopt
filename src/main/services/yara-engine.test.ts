import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Module-level mocks (CJS-compatible plain-let pattern) ───────

let mockReadFileError: Error | null = null

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (path: string, encoding: string) => {
      if (mockReadFileError) throw mockReadFileError
      if (path === '/rules/elastic_Linux_Rule.yar' || path === '/rules/elastic_Linux_Trojan_Mirai.yar') {
        return ''
      }
      if (path === '/rules/elastic_MacOS_Adware.yar' || path === '/rules/elastic_Darwin_Generic.yar') {
        return ''
      }
      if (path === '/rules/elastic_Windows_Trojan.yar' || path === '/rules/elastic_Windows_Generic.yar') {
        return ''
      }
      return 'rule Dummy { condition: false }'
    },
  }
})

vi.mock('./logger.service', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warning: vi.fn(),
  })),
}))

// ─── Imports ─────────────────────────────────────────────────────────

import type { YaraMatch } from './yara-engine'
import {
  ReadWriteLock,
  ScanCancelledError,
  YaraEngine,
  checkCancelled,
  compileRulesWithLock,
  createYaraEngine,
  getActiveEngine,
  scanBufferWithLock,
  scanFileWithLock,
  setActiveEngine,
  yaraLock,
  yaraMatchToThreatFields,
} from './yara-engine'

// ─── Helpers ─────────────────────────────────────────────────────────

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true, writable: true })
}

const RULE_HELLO = `
rule MatchHello {
  strings: $a = "hello" nocase
  condition: $a
}`

const RULE_WORLD = `
rule MatchWorld {
  strings: $a = "world"
  condition: $a
}`

beforeEach(() => {
  vi.clearAllMocks()
  mockReadFileError = null
  setActiveEngine(null)
})

// ─── ReadWriteLock ───────────────────────────────────────────────────

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
    await new Promise((r) => setTimeout(r, 50))
    expect(writeExecuted).toBe(false)
    lock.releaseRead()
    await writePromise
    expect(writeExecuted).toBe(true)
  })

  it('queues writers and ensures exclusive access', async () => {
    const lock = new ReadWriteLock()
    const order: string[] = []
    await lock.acquireWrite()
    const p1 = lock.acquireWrite().then(() => {
      order.push('w1')
      lock.releaseWrite()
    })
    const p2 = lock.acquireWrite().then(() => {
      order.push('w2')
      lock.releaseWrite()
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(order).toEqual([])
    lock.releaseWrite()
    await p1
    expect(order).toEqual(['w1'])
    lock.releaseWrite()
    await p2
    expect(order).toEqual(['w1', 'w2'])
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
    const readPromise = lock.acquireRead().then(() => {
      lock.releaseRead()
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(writeRan).toBe(false)
    lock.releaseRead()
    await writePromise
    expect(writeRan).toBe(true)
    await readPromise
  })
})

describe('yaraLock singleton', () => {
  it('is a ReadWriteLock instance', () => {
    expect(yaraLock).toBeInstanceOf(ReadWriteLock)
  })
})

// ─── ScanCancelledError ─────────────────────────────────────────────

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

// ─── checkCancelled ─────────────────────────────────────────────────

describe('checkCancelled', () => {
  it('throws ScanCancelledError when signal is aborted', () => {
    const ctrl = new AbortController()
    ctrl.abort()
    expect(() => checkCancelled(ctrl.signal)).toThrow(ScanCancelledError)
  })

  it('does nothing when signal is not aborted', () => {
    expect(() => checkCancelled(new AbortController().signal)).not.toThrow()
  })

  it('does nothing when no signal', () => {
    expect(() => checkCancelled()).not.toThrow()
  })

  it('does nothing when undefined', () => {
    expect(() => checkCancelled(undefined)).not.toThrow()
  })
})

// ─── yaraMatchToThreatFields ────────────────────────────────────────

describe('yaraMatchToThreatFields', () => {
  it('uses metadata fields when available', () => {
    const m: YaraMatch = {
      ruleName: 'CoinMiner_XMRig',
      metadata: { detectionName: 'CoinMiner.XMRig', severity: 'critical', details: 'XMRig miner' },
      matchedStrings: ['xmrig'],
    }
    const r = yaraMatchToThreatFields(m)
    expect(r.detectionName).toBe('CoinMiner.XMRig')
    expect(r.severity).toBe('critical')
    expect(r.details).toBe('XMRig miner')
  })

  it('falls back to rule name', () => {
    expect(
      yaraMatchToThreatFields({ ruleName: 'CoinMiner_XMRig', metadata: {}, matchedStrings: [] }).detectionName,
    ).toBe('CoinMiner.XMRig')
  })

  it('converts underscores to dots', () => {
    const r = yaraMatchToThreatFields({ ruleName: 'Trojan_AgentTesla_Variant', metadata: {}, matchedStrings: [] })
    expect(r.detectionName).toBe('Trojan.AgentTesla.Variant')
  })

  it('defaults severity to high', () => {
    expect(yaraMatchToThreatFields({ ruleName: 'T', metadata: {}, matchedStrings: [] }).severity).toBe('high')
  })

  it('defaults details', () => {
    expect(yaraMatchToThreatFields({ ruleName: 'RAT', metadata: {}, matchedStrings: [] }).details).toBe(
      'YARA rule match: RAT',
    )
  })

  it('handles all severity levels', () => {
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      expect(yaraMatchToThreatFields({ ruleName: 'T', metadata: { severity: sev }, matchedStrings: [] }).severity).toBe(
        sev,
      )
    }
  })

  it('clamps invalid severity', () => {
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: test
      yaraMatchToThreatFields({ ruleName: 'T', metadata: { severity: 'info' as any }, matchedStrings: [] }).severity,
    ).toBe('high')
  })
})

// ─── Engine factory / active engine ─────────────────────────────────

describe('engine factory and active engine', () => {
  it('createYaraEngine returns a YaraEngine instance', () => {
    expect(createYaraEngine()).toBeInstanceOf(YaraEngine)
  })

  it('setActiveEngine / getActiveEngine round-trip', () => {
    const e = createYaraEngine()
    setActiveEngine(e)
    expect(getActiveEngine()).toBe(e)
  })

  it('getActiveEngine returns null initially', () => {
    expect(getActiveEngine()).toBeNull()
  })

  it('setActiveEngine accepts null to clear', () => {
    const e = createYaraEngine()
    setActiveEngine(e)
    expect(getActiveEngine()).toBe(e)
    setActiveEngine(null)
    expect(getActiveEngine()).toBeNull()
  })
})

// ─── YaraEngine (tests with real @litko/yara-x library) ──────────

describe('YaraEngine', () => {
  let engine: YaraEngine

  beforeEach(() => {
    engine = createYaraEngine()
  })

  describe('initialize', () => {
    it('creates scanner and sets ready state', async () => {
      await engine.initialize()
      expect(engine.isReady()).toBe(true)
    })
  })

  describe('isReady', () => {
    it('returns false before initialize', () => {
      expect(engine.isReady()).toBe(false)
    })

    it('returns true after initialize', async () => {
      await engine.initialize()
      expect(engine.isReady()).toBe(true)
    })

    it('returns false after dispose', async () => {
      await engine.initialize()
      engine.dispose()
      expect(engine.isReady()).toBe(false)
    })
  })

  describe('rulesLoaded', () => {
    it('returns 0 by default', () => {
      expect(engine.rulesLoaded).toBe(0)
    })

    it('returns count after loadRules', async () => {
      await engine.initialize()
      const result = await engine.loadRules([], [RULE_HELLO])
      expect(engine.rulesLoaded).toBe(1)
      expect(result.loaded).toBe(1)
    })
  })

  describe('loadRules', () => {
    it('returns error if not initialized', async () => {
      const r = await engine.loadRules(['/path/a.yar'])
      expect(r).toEqual({ loaded: 0, errors: ['YARA engine not initialized'] })
    })

    it('loads extra source rules', async () => {
      await engine.initialize()
      const r = await engine.loadRules([], [RULE_HELLO, RULE_WORLD])
      expect(r.loaded).toBe(2)
      expect(r.errors).toEqual([])
    })

    it('reads files and loads rules', async () => {
      await engine.initialize()
      const r = await engine.loadRules(['/path/dummy.yar'])
      expect(r.loaded).toBe(1)
    })

    it('handles file read errors', async () => {
      await engine.initialize()
      mockReadFileError = new Error('ENOENT: no such file')
      const r = await engine.loadRules(['/path/missing.yar'])
      expect(r.loaded).toBe(0)
      expect(r.errors.length).toBe(1)
      expect(r.errors[0]).toContain('missing.yar')
    })

    it('skips windows rules on linux', async () => {
      const orig = process.platform
      setPlatform('linux')
      await engine.initialize()
      const r = await engine.loadRules(['/rules/elastic_Windows_Generic.yar'])
      expect(r.loaded).toBe(0)
      Object.defineProperty(process, 'platform', { value: orig, configurable: true, writable: true })
    })

    it('falls back when bulk compile fails with invalid rule', async () => {
      await engine.initialize()
      const r = await engine.loadRules([], ['rule bad { invalid }', RULE_HELLO])
      expect(r.loaded).toBe(1)
      expect(r.errors.length).toBe(1)
    })

    it('calls onProgress callback', async () => {
      await engine.initialize()
      const onProgress = vi.fn()
      await engine.loadRules([], [RULE_HELLO, RULE_WORLD], onProgress)
      expect(onProgress).toHaveBeenCalled()
    })
  })

  describe('scanBuffer', () => {
    it('returns empty if scanner is null', () => {
      expect(engine.scanBuffer(Buffer.from('test'))).toEqual([])
    })

    it('matches strings against loaded rules', async () => {
      await engine.initialize()
      await engine.loadRules([], [RULE_HELLO])
      const result = engine.scanBuffer(Buffer.from('say hello world'))
      expect(result.length).toBe(1)
      expect(result[0].ruleName).toBe('MatchHello')
      expect(result[0].matchedStrings).toEqual(['hello'])
    })

    it('returns empty for clean data', async () => {
      await engine.initialize()
      await engine.loadRules([], [RULE_HELLO])
      const result = engine.scanBuffer(Buffer.from('clean data no match'))
      expect(result).toEqual([])
    })

    it('matches multiple rules', async () => {
      await engine.initialize()
      await engine.loadRules([], [RULE_HELLO, RULE_WORLD])
      const result = engine.scanBuffer(Buffer.from('hello world'))
      expect(result.length).toBe(2)
    })
  })

  describe('scanFile', () => {
    it('returns empty if scanner is null', () => {
      expect(engine.scanFile('/path/file.bin')).toEqual([])
    })

    it('scans a real file from disk', async () => {
      await engine.initialize()
      await engine.loadRules([], [RULE_HELLO])
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'yara-test-'))
      const filePath = path.join(tmp, 'test.bin')
      writeFileSync(filePath, 'hello from file')
      const result = engine.scanFile(filePath)
      expect(result.length).toBe(1)
      expect(result[0].ruleName).toBe('MatchHello')
      rmSync(tmp, { recursive: true, force: true })
    })
  })

  describe('_convertMatch (via scanBuffer)', () => {
    it('populates all metadata fields', async () => {
      const RULE_WITH_META = `
rule TestMeta {
  meta:
    detectionName = "Custom.Detect"
    severity = "critical"
    details = "Test detail"
    filenameOnly = "bad.exe"
  strings:
    $a = "trigger"
  condition:
    $a
}`
      await engine.initialize()
      await engine.loadRules([], [RULE_WITH_META])
      const result = engine.scanBuffer(Buffer.from('trigger word'))
      expect(result.length).toBe(1)
      expect(result[0].ruleName).toBe('TestMeta')
      expect(result[0].metadata.detectionName).toBe('Custom.Detect')
      expect(result[0].metadata.severity).toBe('critical')
      expect(result[0].metadata.details).toBe('Test detail')
      expect(result[0].metadata.filenameOnly).toBe('bad.exe')
      expect(result[0].matchedStrings).toEqual(['trigger'])
    })
  })

  describe('dispose', () => {
    it('clears ready state', async () => {
      await engine.initialize()
      engine.dispose()
      expect(engine.isReady()).toBe(false)
    })

    it('resets rulesLoaded', async () => {
      await engine.initialize()
      await engine.loadRules([], [RULE_HELLO])
      expect(engine.rulesLoaded).toBe(1)
      engine.dispose()
      expect(engine.rulesLoaded).toBe(0)
    })
  })
})

// ─── scanFileWithLock ───────────────────────────────────────────────

describe('scanFileWithLock', () => {
  it('scans file using active engine with read lock', async () => {
    const e = createYaraEngine()
    await e.initialize()
    await e.loadRules([], [RULE_HELLO])
    setActiveEngine(e)

    const tmp = (await import('node:fs')).mkdtempSync('/tmp/yara-test-')
    const fp = (await import('node:path')).join(tmp, 'data.bin')
    ;(await import('node:fs')).writeFileSync(fp, 'hello scan')
    const result = await scanFileWithLock(fp)
    expect(result.length).toBe(1)
    expect(result[0].ruleName).toBe('MatchHello')
    ;(await import('node:fs')).rmSync(tmp, { recursive: true, force: true })
  })

  it('returns empty when no active engine', async () => {
    expect(await scanFileWithLock('/path/file.bin')).toEqual([])
  })

  it('throws ScanCancelledError when aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(scanFileWithLock('/path/file.bin', ctrl.signal)).rejects.toThrow(ScanCancelledError)
  })

  it('releases read lock after scan', async () => {
    const e = createYaraEngine()
    await e.initialize()
    setActiveEngine(e)
    const spy = vi.spyOn(yaraLock, 'releaseRead')
    await scanFileWithLock('/path/any.bin')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// ─── scanBufferWithLock ─────────────────────────────────────────────

describe('scanBufferWithLock', () => {
  it('scans buffer using active engine with read lock', async () => {
    const e = createYaraEngine()
    await e.initialize()
    await e.loadRules([], [RULE_HELLO])
    setActiveEngine(e)

    const result = await scanBufferWithLock(Buffer.from('hello test'))
    expect(result.length).toBe(1)
    expect(result[0].ruleName).toBe('MatchHello')
  })

  it('returns empty when no active engine', async () => {
    expect(await scanBufferWithLock(Buffer.from('test'))).toEqual([])
  })

  it('throws ScanCancelledError when aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(scanBufferWithLock(Buffer.from('test'), ctrl.signal)).rejects.toThrow(ScanCancelledError)
  })

  it('releases read lock after scan', async () => {
    const e = createYaraEngine()
    await e.initialize()
    setActiveEngine(e)
    const spy = vi.spyOn(yaraLock, 'releaseRead')
    await scanBufferWithLock(Buffer.from('test'))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// ─── compileRulesWithLock ───────────────────────────────────────────

describe('compileRulesWithLock', () => {
  it('compiles rules with write lock', async () => {
    const r = await compileRulesWithLock([], [RULE_HELLO, RULE_WORLD])
    expect(r.loaded).toBe(2)
    expect(r.errors).toEqual([])
  })

  it('throws ScanCancelledError when aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(compileRulesWithLock([], [], undefined, ctrl.signal)).rejects.toThrow(ScanCancelledError)
  })

  it('releases write lock after compilation', async () => {
    const spy = vi.spyOn(yaraLock, 'releaseWrite')
    await compileRulesWithLock([], [RULE_HELLO])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('releases write lock on error', async () => {
    const spy = vi.spyOn(yaraLock, 'releaseWrite')
    // Cause readFileSync to throw — compileRulesWithLock has no signal so
    // the error comes from loadRules reading a file
    mockReadFileError = new Error('fail')
    const r = await compileRulesWithLock(['/path/missing.yar'])
    expect(r.loaded).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('passes extra sources and progress through', async () => {
    const onProgress = vi.fn()
    const r = await compileRulesWithLock([], [RULE_HELLO, RULE_WORLD], onProgress)
    expect(r.loaded).toBe(2)
    expect(onProgress).toHaveBeenCalled()
  })
})
