import { existsSync, mkdirSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type TextEncoding, decodeText, detectEncoding, readTextFile } from './encoding'

function b(...bytes: number[]): Buffer {
  return Buffer.from(bytes)
}

function utf16leBom(): Buffer {
  return b(0xff, 0xfe)
}

function utf16beBom(): Buffer {
  return b(0xfe, 0xff)
}

describe('detectEncoding', () => {
  it('detects UTF-16LE from BOM', () => {
    const buf = Buffer.concat([utf16leBom(), Buffer.from('hello', 'utf16le')])
    expect(detectEncoding(buf)).toBe('utf16le')
  })

  it('detects UTF-16BE from BOM', () => {
    const buf = Buffer.concat([utf16beBom(), Buffer.from('hello', 'utf16le')])
    expect(detectEncoding(buf)).toBe('utf16be')
  })

  it('detects UTF-16LE from null-byte heuristic (no BOM)', () => {
    const buf = Buffer.from('h\0e\0l\0l\0o\0', 'binary')
    expect(detectEncoding(buf)).toBe('utf16le')
  })

  it('returns utf8 for plain ASCII content', () => {
    const buf = Buffer.from('hello world')
    expect(detectEncoding(buf)).toBe('utf8')
  })

  it('returns utf8 for valid UTF-8 content with multi-byte chars', () => {
    const buf = Buffer.from('héllo wörld 🎉')
    expect(detectEncoding(buf)).toBe('utf8')
  })

  it('returns latin1 for binary data that fails UTF-8 decoding', () => {
    const buf = Buffer.from([0x80, 0x80, 0x80])
    expect(detectEncoding(buf)).toBe('latin1')
  })

  it('returns utf8 for an empty buffer', () => {
    expect(detectEncoding(Buffer.alloc(0))).toBe('utf8')
  })

  it('returns utf8 for a very short buffer (< 2 bytes)', () => {
    expect(detectEncoding(Buffer.from([0x41]))).toBe('utf8')
  })

  it('returns utf8 for all-null buffer (nulls are valid UTF-8)', () => {
    const buf = Buffer.alloc(100, 0)
    expect(detectEncoding(buf)).toBe('utf8')
  })

  it('handles buffer with only BOM (no content)', () => {
    expect(detectEncoding(utf16leBom())).toBe('utf16le')
    expect(detectEncoding(utf16beBom())).toBe('utf16be')
  })

  it('detects UTF-16LE in a large buffer using heuristic', () => {
    const buf = Buffer.alloc(2048)
    for (let i = 0; i < buf.length; i += 2) {
      buf[i] = 0x61 // 'a' at even positions
      buf[i + 1] = 0 // null at odd positions
    }
    expect(detectEncoding(buf)).toBe('utf16le')
  })
})

describe('decodeText', () => {
  it('decodes UTF-16LE content with BOM', () => {
    const buf = Buffer.concat([utf16leBom(), Buffer.from('hello world', 'utf16le')])
    expect(decodeText(buf)).toBe('hello world')
  })

  it('decodes UTF-16LE content without BOM', () => {
    const str = 'test message'
    const buf = Buffer.from(str, 'utf16le')
    expect(decodeText(buf)).toBe(str)
  })

  it('decodes ASCII content', () => {
    expect(decodeText(Buffer.from('simple ascii'))).toBe('simple ascii')
  })

  it('decodes UTF-8 content', () => {
    expect(decodeText(Buffer.from('héllo 🎉'))).toBe('héllo 🎉')
  })

  it('decodes mixed content with BOM correctly', () => {
    const buf = Buffer.concat([utf16leBom(), Buffer.from('DiNho Optimizer v1.0', 'utf16le')])
    expect(decodeText(buf)).toBe('DiNho Optimizer v1.0')
  })

  it('handles empty buffer', () => {
    expect(decodeText(Buffer.alloc(0))).toBe('')
  })
})

describe('readTextFile', () => {
  const tmpDir = join(import.meta.dirname, '__test_tmp__')

  beforeEach(() => {
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reads a plain UTF-8 text file', async () => {
    const filePath = join(tmpDir, 'hello.txt')
    await writeFile(filePath, 'hello world', 'utf-8')
    expect(await readTextFile(filePath)).toBe('hello world')
  })

  it('reads a UTF-16LE file correctly', async () => {
    const filePath = join(tmpDir, 'utf16.txt')
    const buf = Buffer.concat([utf16leBom(), Buffer.from('DiNho Optimizer', 'utf16le')])
    await writeFile(filePath, buf)
    expect(await readTextFile(filePath)).toBe('DiNho Optimizer')
  })

  it('reads a UTF-16LE file without BOM', async () => {
    const filePath = join(tmpDir, 'utf16-nobom.txt')
    const buf = Buffer.from('scheduled task', 'utf16le')
    await writeFile(filePath, buf)
    expect(await readTextFile(filePath)).toBe('scheduled task')
  })

  it('reads a PowerShell script saved as UTF-16LE', async () => {
    const filePath = join(tmpDir, 'script.ps1')
    const content = 'Write-Host "hello"\r\nStart-Process notepad\r\n'
    const buf = Buffer.concat([utf16leBom(), Buffer.from(content, 'utf16le')])
    await writeFile(filePath, buf)
    const result = await readTextFile(filePath)
    expect(result).toContain('Write-Host')
    expect(result).toContain('Start-Process')
  })

  it('throws on non-existent file', async () => {
    await expect(readTextFile(join(tmpDir, 'nope.txt'))).rejects.toThrow()
  })
})

describe('performance', () => {
  it('completes 1000 detections under 100ms', () => {
    const buf = Buffer.concat([utf16leBom(), Buffer.from('performance test', 'utf16le')])
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      detectEncoding(buf)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100)
  })
})
