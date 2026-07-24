import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAppendFile, mockMkdir, mockReadFile, mockReaddir, mockUnlink } = vi.hoisted(() => ({
  mockAppendFile: vi.fn<() => Promise<void>>(),
  mockMkdir: vi.fn<() => Promise<void>>(),
  mockReadFile: vi.fn<() => Promise<string>>(),
  mockReaddir: vi.fn<() => Promise<string[]>>(),
  mockUnlink: vi.fn<() => Promise<void>>(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-logs'),
  },
}))

vi.mock('node:fs/promises', () => ({
  appendFile: mockAppendFile,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  readdir: mockReaddir,
  unlink: mockUnlink,
}))

import { getLogger, resetLoggerForTest } from './logger.service'

// Helper to build an ISO date string relative to now
function ts(dayOffset = 0, hours = 12): string {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hours, 0, 0, 0)
  return d.toISOString()
}

describe('LoggerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetLoggerForTest()
    mockMkdir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])
    mockAppendFile.mockResolvedValue(undefined)
    mockReadFile.mockResolvedValue('')
    mockUnlink.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetLoggerForTest()
  })

  describe('getLogger singleton', () => {
    it('returns a LoggerService instance', () => {
      const logger = getLogger()
      expect(logger).toBeDefined()
      expect(typeof logger.log).toBe('function')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.success).toBe('function')
      expect(typeof logger.warning).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.list).toBe('function')
      expect(typeof logger.clear).toBe('function')
      expect(typeof logger.exportAsText).toBe('function')
      expect(typeof logger.getConfig).toBe('function')
      expect(typeof logger.setConfig).toBe('function')
      expect(typeof logger.ready).toBe('function')
    })

    it('returns the same instance on subsequent calls', () => {
      const logger1 = getLogger()
      const logger2 = getLogger()
      expect(logger1).toBe(logger2)
    })
  })

  describe('resetLoggerForTest', () => {
    it('creates a new instance on the next getLogger call', () => {
      const logger1 = getLogger()
      resetLoggerForTest()
      const logger2 = getLogger()
      expect(logger1).not.toBe(logger2)
    })

    it('does not throw when called before any getLogger', () => {
      resetLoggerForTest()
      const logger = getLogger()
      expect(logger).toBeDefined()
    })
  })

  describe('initialization (ready)', () => {
    it('creates the log directory on first access', async () => {
      const logger = getLogger()
      await logger.ready()
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true })
    })

    it('calls app.getPath to resolve the log directory', async () => {
      const { app } = await import('electron')
      const logger = getLogger()
      await logger.ready()
      expect(app.getPath).toHaveBeenCalledWith('userData')
    })

    it('proceeds when mkdir throws (directory already exists)', async () => {
      mockMkdir.mockRejectedValueOnce(new Error('EEXIST'))
      const logger = getLogger()
      await expect(logger.ready()).resolves.toBeUndefined()
    })

    it('runs cleanup after creating the directory', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      await logger.ready()
      expect(mockReaddir).toHaveBeenCalled()
    })
  })

  describe('log', () => {
    it('writes a JSON line to the current date log file', async () => {
      const logger = getLogger()
      await logger.log('info', 'test-module', 'hello world')

      expect(mockAppendFile).toHaveBeenCalledTimes(1)
      const [filePath, line, encoding] = mockAppendFile.mock.calls[0] as unknown as [string, string, string]
      expect(filePath).toMatch(/\.jsonl$/)
      expect(encoding).toBe('utf-8')

      const parsed = JSON.parse(line)
      expect(parsed).toMatchObject({
        level: 'info',
        module: 'test-module',
        message: 'hello world',
      })
      expect(parsed.timestamp).toBeDefined()
      expect(typeof parsed.timestamp).toBe('string')
      expect(parsed.details).toBeUndefined()
    })

    it('includes details when provided', async () => {
      const logger = getLogger()
      await logger.log('error', 'crash', 'something broke', 'stack trace here')

      const line = (mockAppendFile.mock.calls[0] as unknown as [string, string])[1]
      const parsed = JSON.parse(line)
      expect(parsed.details).toBe('stack trace here')
    })

    it('retries with mkdir when appendFile fails', async () => {
      mockAppendFile.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(undefined)

      const logger = getLogger()
      await logger.log('info', 'm', 'msg')

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true })
      expect(mockAppendFile).toHaveBeenCalledTimes(2)
    })

    it('handles double failure (appendFile + mkdir) gracefully', async () => {
      mockAppendFile.mockRejectedValue(new Error('disk full'))
      mockMkdir.mockRejectedValue(new Error('permission denied'))

      const logger = getLogger()
      await expect(logger.log('info', 'm', 'msg')).resolves.toBeUndefined()
    })

    it('handles single failure gracefully when only appendFile fails', async () => {
      mockAppendFile.mockRejectedValueOnce(new Error('disk full'))
      mockMkdir.mockResolvedValue(undefined)
      mockAppendFile.mockResolvedValueOnce(undefined)

      const logger = getLogger()
      await logger.log('info', 'm', 'msg')
      expect(mockAppendFile).toHaveBeenCalledTimes(2)
    })
  })

  describe('convenience log methods', () => {
    it('info delegates to log with info level', async () => {
      const logger = getLogger()
      await logger.info('mod-a', 'info msg')
      const line = (mockAppendFile.mock.calls[0] as unknown as [string, string])[1]
      expect(JSON.parse(line).level).toBe('info')
    })

    it('success delegates to log with success level', async () => {
      const logger = getLogger()
      await logger.success('mod-a', 'success msg')
      const line = (mockAppendFile.mock.calls[0] as unknown as [string, string])[1]
      expect(JSON.parse(line).level).toBe('success')
    })

    it('warning delegates to log with warning level', async () => {
      const logger = getLogger()
      await logger.warning('mod-a', 'warn msg')
      const line = (mockAppendFile.mock.calls[0] as unknown as [string, string])[1]
      expect(JSON.parse(line).level).toBe('warning')
    })

    it('error delegates to log with error level', async () => {
      const logger = getLogger()
      await logger.error('mod-a', 'error msg')
      const line = (mockAppendFile.mock.calls[0] as unknown as [string, string])[1]
      expect(JSON.parse(line).level).toBe('error')
    })

    it('convenience methods forward details', async () => {
      const logger = getLogger()
      await logger.warning('mod', 'msg', 'some details')
      const line = (mockAppendFile.mock.calls[0] as unknown as [string, string])[1]
      expect(JSON.parse(line).details).toBe('some details')
    })
  })

  describe('list', () => {
    it('returns empty result when no log files exist', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      const result = await logger.list()
      expect(result).toEqual({ entries: [], total: 0, page: 1, pageSize: 50 })
    })

    it('returns entries from log files sorted by timestamp descending', async () => {
      mockReaddir.mockResolvedValue(['2026-01-01.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(-2), level: 'info', module: 'a', message: 'old' })}\n${JSON.stringify({
          timestamp: ts(-1),
          level: 'info',
          module: 'a',
          message: 'new',
        })}\n`,
      )

      const logger = getLogger()
      const result = await logger.list()

      expect(result.total).toBe(2)
      expect(result.entries[0]!.message).toBe('new')
      expect(result.entries[1]!.message).toBe('old')
    })

    it('filters entries by level', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'error', module: 'mod', message: 'err' })}\n${JSON.stringify({
          timestamp: ts(0),
          level: 'info',
          module: 'mod',
          message: 'inf',
        })}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ level: 'error' })

      expect(result.total).toBe(1)
      expect(result.entries[0]!.message).toBe('err')
    })

    it('filters entries by module', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'scan', message: 'scanning' })}\n${JSON.stringify({
          timestamp: ts(0),
          level: 'info',
          module: 'clean',
          message: 'cleaning',
        })}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ module: 'scan' })

      expect(result.total).toBe(1)
      expect(result.entries[0]!.message).toBe('scanning')
    })

    it('filters entries by search text in message', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'mod', message: 'found malware' })}\n${JSON.stringify(
          { timestamp: ts(0), level: 'info', module: 'mod', message: 'all clean' },
        )}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ search: 'malware' })

      expect(result.total).toBe(1)
      expect(result.entries[0]!.message).toBe('found malware')
    })

    it('filters entries by search text in module', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'scanner', message: 'done' })}\n${JSON.stringify({
          timestamp: ts(0),
          level: 'info',
          module: 'cleaner',
          message: 'done',
        })}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ search: 'scan' })

      expect(result.total).toBe(1)
      expect(result.entries[0]!.module).toBe('scanner')
    })

    it('filters entries by search text in details', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'mod', message: 'done', details: 'found 5 threats' })}\n${JSON.stringify(
          { timestamp: ts(0), level: 'info', module: 'mod', message: 'done' },
        )}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ search: 'threats' })

      expect(result.total).toBe(1)
    })

    it('search is case-insensitive', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'ScanModule', message: 'Scan Complete' })}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ search: 'scanmodule' })
      expect(result.total).toBe(1)
    })

    it('paginates results', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      const lines = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({ timestamp: ts(-i), level: 'info', module: 'mod', message: `msg ${i + 1}` }),
      ).join('\n')
      mockReadFile.mockResolvedValue(lines)

      const logger = getLogger()
      const page1 = await logger.list(undefined, 1, 3)
      expect(page1.entries).toHaveLength(3)
      expect(page1.total).toBe(10)
      expect(page1.page).toBe(1)
      expect(page1.pageSize).toBe(3)
      expect(page1.entries[0]!.message).toBe('msg 1')
      expect(page1.entries[2]!.message).toBe('msg 3')

      const page2 = await logger.list(undefined, 2, 3)
      expect(page2.entries).toHaveLength(3)
      expect(page2.entries[0]!.message).toBe('msg 4')
    })

    it('skips malformed JSON lines', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'mod', message: 'good' })}\nnot-json\n${JSON.stringify(
          { timestamp: ts(0), level: 'info', module: 'mod', message: 'also good' },
        )}\n`,
      )

      const logger = getLogger()
      const result = await logger.list()
      expect(result.total).toBe(2)
    })

    it('skips files that cannot be read', async () => {
      mockReaddir.mockResolvedValue(['good.jsonl', 'bad.jsonl'])
      mockReadFile
        .mockResolvedValueOnce(`${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'mod', message: 'ok' })}\n`)
        .mockRejectedValueOnce(new Error('permission denied'))

      const logger = getLogger()
      const result = await logger.list()
      expect(result.total).toBe(1)
    })

    it('returns empty when readdir fails', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'))
      const logger = getLogger()
      const result = await logger.list()
      expect(result.entries).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('reads multiple log files', async () => {
      mockReaddir.mockResolvedValue(['a.jsonl', 'b.jsonl'])
      mockReadFile
        .mockResolvedValueOnce(
          `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'm', message: 'from a' })}\n`,
        )
        .mockResolvedValueOnce(
          `${JSON.stringify({ timestamp: ts(0), level: 'info', module: 'm', message: 'from b' })}\n`,
        )

      const logger = getLogger()
      const result = await logger.list()
      expect(result.total).toBe(2)
    })

    it('combines level, module, and search filters', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'error', module: 'scan', message: 'error in scan' })}\n${JSON.stringify(
          { timestamp: ts(0), level: 'info', module: 'scan', message: 'scan complete' },
        )}\n${JSON.stringify({ timestamp: ts(0), level: 'error', module: 'clean', message: 'error in clean' })}\n`,
      )

      const logger = getLogger()
      const result = await logger.list({ level: 'error', module: 'scan', search: 'error' })
      expect(result.total).toBe(1)
      expect(result.entries[0]!.message).toBe('error in scan')
    })
  })

  describe('exportAsText', () => {
    it('formats entries as human-readable text', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({
          timestamp: '2026-01-15T10:30:00.000Z',
          level: 'info',
          module: 'test',
          message: 'hello',
          details: 'extra',
        })}\n${JSON.stringify({ timestamp: '2026-01-15T10:31:00.000Z', level: 'error', module: 'test', message: 'fail' })}\n`,
      )

      const logger = getLogger()
      const text = await logger.exportAsText()

      expect(text).toContain('[2026-01-15 10:30:00]')
      expect(text).toContain('INFO   ')
      expect(text).toContain('[test]')
      expect(text).toContain('hello')
      expect(text).toContain('extra')

      expect(text).toContain('[2026-01-15 10:31:00]')
      expect(text).toContain('ERROR  ')
      expect(text).toContain('fail')
    })

    it('returns empty string when no entries exist', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      const text = await logger.exportAsText()
      expect(text).toBe('')
    })

    it('accepts a filter', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      mockReadFile.mockResolvedValue(
        `${JSON.stringify({ timestamp: ts(0), level: 'error', module: 'm', message: 'err' })}\n${JSON.stringify({
          timestamp: ts(0),
          level: 'info',
          module: 'm',
          message: 'inf',
        })}\n`,
      )

      const logger = getLogger()
      const text = await logger.exportAsText({ level: 'info' })
      expect(text).toContain('inf')
      expect(text).not.toContain('err')
    })
  })

  describe('clear', () => {
    it('deletes all .jsonl files in the log directory', async () => {
      mockReaddir.mockResolvedValue(['a.jsonl', 'b.jsonl', 'c.txt'])
      const logger = getLogger()
      await logger.clear()

      expect(mockUnlink).toHaveBeenCalledTimes(2)
      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('a.jsonl'))
      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('b.jsonl'))
    })

    it('handles unlink errors gracefully', async () => {
      mockReaddir.mockResolvedValue(['a.jsonl', 'b.jsonl'])
      mockUnlink.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(undefined)

      const logger = getLogger()
      await expect(logger.clear()).resolves.toBeUndefined()
      expect(mockUnlink).toHaveBeenCalledTimes(2)
    })

    it('does nothing when no log files exist', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      await logger.clear()
      expect(mockUnlink).not.toHaveBeenCalled()
    })
  })

  describe('getConfig', () => {
    it('returns default retention days', async () => {
      const logger = getLogger()
      const config = await logger.getConfig()
      expect(config).toEqual({ retentionDays: 7 })
    })
  })

  describe('setConfig', () => {
    it('updates retention days and triggers cleanup', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      await logger.setConfig({ retentionDays: 14 })

      const config = await logger.getConfig()
      expect(config).toEqual({ retentionDays: 14 })
    })

    it('clamps retentionDays to minimum of 1', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      await logger.setConfig({ retentionDays: 0 })
      const config = await logger.getConfig()
      expect(config.retentionDays).toBe(1)
    })

    it('clamps retentionDays to maximum of 365', async () => {
      mockReaddir.mockResolvedValue([])
      const logger = getLogger()
      await logger.setConfig({ retentionDays: 500 })
      const config = await logger.getConfig()
      expect(config.retentionDays).toBe(365)
    })

    it('removes old files after reducing retention', async () => {
      mockReaddir
        .mockResolvedValueOnce([]) // init cleanup — no files
        .mockResolvedValueOnce(['2026-01-01.jsonl', '2026-06-10.jsonl'])
      mockUnlink.mockResolvedValue(undefined)

      const logger = getLogger()
      await logger.setConfig({ retentionDays: 1 })

      expect(mockUnlink).toHaveBeenCalled()
    })
  })

  describe('cleanup (internal)', () => {
    it('removes files older than retention days during init', async () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 10)
      const oldFile = `${oldDate.toISOString().slice(0, 10)}.jsonl`

      const recentDate = new Date()
      recentDate.setDate(recentDate.getDate() - 1)
      const recentFile = `${recentDate.toISOString().slice(0, 10)}.jsonl`

      mockReaddir.mockResolvedValue([oldFile, recentFile])
      mockUnlink.mockResolvedValue(undefined)

      const logger = getLogger()
      await logger.ready()

      expect(mockUnlink).toHaveBeenCalledTimes(1)
      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining(oldFile))
    })

    it('keeps files within the retention period', async () => {
      const recentDate = new Date()
      recentDate.setDate(recentDate.getDate() - 2)
      const recentFile = `${recentDate.toISOString().slice(0, 10)}.jsonl`

      mockReaddir.mockResolvedValue([recentFile])

      const logger = getLogger()
      await logger.ready()

      expect(mockUnlink).not.toHaveBeenCalled()
    })

    it('handles unlink errors during cleanup gracefully', async () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 10)
      const oldFile = `${oldDate.toISOString().slice(0, 10)}.jsonl`

      mockReaddir.mockResolvedValue([oldFile])
      mockUnlink.mockRejectedValue(new Error('access denied'))

      const logger = getLogger()
      await expect(logger.ready()).resolves.toBeUndefined()
    })

    it('does nothing when readdir fails during cleanup', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'))
      const logger = getLogger()
      await expect(logger.ready()).resolves.toBeUndefined()
      expect(mockUnlink).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles multiple sequential log calls correctly', async () => {
      mockReaddir.mockResolvedValue([])
      mockAppendFile.mockResolvedValue(undefined)

      const logger = getLogger()
      await logger.info('mod', 'first')
      await logger.error('mod', 'second', 'details')
      await logger.warning('mod', 'third')

      expect(mockAppendFile).toHaveBeenCalledTimes(3)
    })

    it('handles app.getPath throwing (fallback to cwd)', async () => {
      const { app } = await import('electron')
      vi.mocked(app.getPath).mockImplementation(() => {
        throw new Error('no app')
      })

      mockMkdir.mockResolvedValue(undefined)
      mockReaddir.mockResolvedValue([])

      resetLoggerForTest()
      const logger = getLogger()
      await logger.ready()

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true })
    })

    it('list returns correct page count for edge pages', async () => {
      mockReaddir.mockResolvedValue(['log.jsonl'])
      const entries = Array.from({ length: 5 }, (_, i) =>
        JSON.stringify({ timestamp: ts(-i), level: 'info', module: 'mod', message: `msg ${i + 1}` }),
      ).join('\n')
      mockReadFile.mockResolvedValue(entries)

      const logger = getLogger()
      const page2 = await logger.list(undefined, 2, 3)
      expect(page2.entries).toHaveLength(2)
      expect(page2.total).toBe(5)

      const page3 = await logger.list(undefined, 3, 3)
      expect(page3.entries).toHaveLength(0)
      expect(page3.total).toBe(5)
    })
  })
})
