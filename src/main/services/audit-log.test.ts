import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  join: vi.fn(),
}

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:\\Users\\tester\\AppData\\Roaming\\DiNho-Dev') },
}))

vi.mock('node:fs', () => ({
  appendFileSync: (...a: unknown[]) => mocks.appendFileSync(...a),
  mkdirSync: (...a: unknown[]) => mocks.mkdirSync(...a),
}))

vi.mock('node:path', () => ({
  join: (...a: unknown[]) => mocks.join(...a),
}))

describe('audit-log', () => {
  let initAuditLog: typeof import('./audit-log').initAuditLog
  let logAudit: typeof import('./audit-log').logAudit

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.join.mockImplementation(((...parts: string[]) => parts.join('\\')) as never)
    const mod = await import('./audit-log')
    initAuditLog = mod.initAuditLog
    logAudit = mod.logAudit
  })

  describe('initAuditLog', () => {
    it('creates the logs directory under userData', () => {
      initAuditLog()
      expect(mocks.join).toHaveBeenCalledWith('C:\\Users\\tester\\AppData\\Roaming\\DiNho-Dev', 'logs')
      expect(mocks.mkdirSync).toHaveBeenCalledWith('C:\\Users\\tester\\AppData\\Roaming\\DiNho-Dev\\logs', {
        recursive: true,
      })
    })
  })

  describe('logAudit', () => {
    it('is a no-op before initAuditLog', () => {
      logAudit('clean', 'registry')
      expect(mocks.appendFileSync).not.toHaveBeenCalled()
    })

    it('appends a JSONL line with ISO timestamp, action, category, details and admin flag', () => {
      initAuditLog()
      logAudit('clean', 'registry', { removed: 3 })
      expect(mocks.appendFileSync).toHaveBeenCalledTimes(1)
      const [path, line] = mocks.appendFileSync.mock.calls[0]!
      expect(path).toBe('C:\\Users\\tester\\AppData\\Roaming\\DiNho-Dev\\logs\\audit.jsonl')
      const parsed = JSON.parse(String(line)) as Record<string, unknown>
      expect(parsed.action).toBe('clean')
      expect(parsed.category).toBe('registry')
      expect(parsed.details).toEqual({ removed: 3 })
      expect(parsed.admin).toBe(false)
      expect(new Date(parsed.timestamp as string).toISOString()).toBe(parsed.timestamp)
    })

    it('defaults details to an empty object when omitted', () => {
      initAuditLog()
      logAudit('scan', 'network')
      const [, line] = mocks.appendFileSync.mock.calls[0]!
      const parsed = JSON.parse(String(line)) as { details: unknown }
      expect(parsed.details).toEqual({})
    })

    it('sets admin true when ELEVATED=1', () => {
      process.env.ELEVATED = '1'
      initAuditLog()
      logAudit('clean', 'registry')
      const [, line] = mocks.appendFileSync.mock.calls[0]!
      const parsed = JSON.parse(String(line)) as { admin: boolean }
      expect(parsed.admin).toBe(true)
      delete process.env.ELEVATED
    })

    it('swallows append errors (best effort)', () => {
      initAuditLog()
      mocks.appendFileSync.mockImplementation(() => {
        throw new Error('EACCES')
      })
      expect(() => logAudit('clean', 'registry')).not.toThrow()
    })
  })
})
