import { existsSync, mkdirSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decodeText,
  detectByNullHeuristic,
  detectEncoding,
  hasBom,
  isValidUtf8,
  readTextFile,
  swap16,
} from './encoding'

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

  it('reads a UTF-16BE file with BOM', async () => {
    const filePath = join(tmpDir, 'utf16be.txt')
    const content = 'DiNho Optimizer'
    const utf16le = Buffer.from(content, 'utf16le')
    const utf16be = swap16(utf16le)
    const buf = Buffer.concat([utf16beBom(), utf16be])
    await writeFile(filePath, buf)
    expect(await readTextFile(filePath)).toBe(content)
  })

  it('reads a UTF-16BE file without BOM', async () => {
    const filePath = join(tmpDir, 'utf16be-nobom.txt')
    const content = 'be test'
    const utf16le = Buffer.from(content, 'utf16le')
    const utf16be = swap16(utf16le)
    await writeFile(filePath, utf16be)
    expect(await readTextFile(filePath)).toBe(content)
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

describe('hasBom', () => {
  it('returns true when buffer starts with BOM', () => {
    expect(hasBom(utf16leBom(), utf16leBom())).toBe(true)
    expect(hasBom(utf16beBom(), utf16beBom())).toBe(true)
  })

  it('returns false when buffer is shorter than BOM', () => {
    expect(hasBom(Buffer.from([0xff]), utf16leBom())).toBe(false)
    expect(hasBom(Buffer.alloc(0), utf16beBom())).toBe(false)
  })

  it('returns false when buffer does not start with BOM', () => {
    expect(hasBom(Buffer.from([0x41, 0x42]), utf16leBom())).toBe(false)
    expect(hasBom(Buffer.from([0x41, 0x42]), utf16beBom())).toBe(false)
  })

  it('returns true when buffer has BOM followed by content', () => {
    const buf = Buffer.concat([utf16leBom(), Buffer.from('abc')])
    expect(hasBom(buf, utf16leBom())).toBe(true)
  })
})

describe('detectByNullHeuristic', () => {
  it('returns null for buffer shorter than 2 bytes', () => {
    expect(detectByNullHeuristic(Buffer.from([0x41]))).toBeNull()
    expect(detectByNullHeuristic(Buffer.alloc(0))).toBeNull()
  })

  it('detects UTF-16BE from null-byte pattern (even positions are null)', () => {
    const buf = Buffer.alloc(100)
    for (let i = 0; i < buf.length; i += 2) {
      buf[i] = 0 // null at even positions
      buf[i + 1] = 0x61 // 'a' at odd positions
    }
    expect(detectByNullHeuristic(buf)).toBe('utf16be')
  })

  it('detects UTF-16LE from null-byte pattern (odd positions are null)', () => {
    const buf = Buffer.alloc(100)
    for (let i = 0; i < buf.length; i += 2) {
      buf[i] = 0x61 // 'a' at even positions
      buf[i + 1] = 0 // null at odd positions
    }
    expect(detectByNullHeuristic(buf)).toBe('utf16le')
  })

  it('returns null when neither even nor odd null ratio exceeds threshold', () => {
    // Mixed: need both ratios below 0.8
    const buf = Buffer.from([0x41, 0x00, 0x41, 0x42, 0x41, 0x00, 0x41, 0x42])
    // Even: 0x41, 0x41, 0x41, 0x41 = 0 nulls / 4 = 0
    // Odd: 0x00, 0x42, 0x00, 0x42 = 2 nulls / 4 = 0.5
    expect(detectByNullHeuristic(buf)).toBeNull()
  })

  it('limits sample to 2048 bytes', () => {
    const buf = Buffer.alloc(4096)
    for (let i = 0; i < buf.length; i += 2) {
      buf[i] = 0 // null at even
      buf[i + 1] = 0x61
    }
    // First 2048 bytes are sampled, even null ratio = 1.0 > 0.8
    expect(detectByNullHeuristic(buf)).toBe('utf16be')
  })
})

describe('isValidUtf8', () => {
  it('returns true for valid UTF-8 content', () => {
    expect(isValidUtf8(Buffer.from('hello world'))).toBe(true)
    expect(isValidUtf8(Buffer.from('héllo 🎉'))).toBe(true)
  })

  it('returns false when decoded string contains replacement character', () => {
    // 0xFF is invalid in UTF-8, decodes to U+FFFD
    const buf = Buffer.from([0xff])
    expect(isValidUtf8(buf)).toBe(false)
  })

  it('returns false for overlong encoding sequences', () => {
    // Overlong encoding of '/' (0x2F) as 2-byte sequence
    const buf = Buffer.from([0xc0, 0xaf])
    expect(isValidUtf8(buf)).toBe(false)
  })
})

describe('swap16', () => {
  it('swaps pairs of bytes', () => {
    const input = Buffer.from([0x01, 0x02, 0x03, 0x04])
    const result = swap16(input)
    expect(result).toEqual(Buffer.from([0x02, 0x01, 0x04, 0x03]))
  })

  it('handles odd-length buffer (last byte stays in place)', () => {
    const input = Buffer.from([0x01, 0x02, 0x03])
    const result = swap16(input)
    expect(result).toEqual(Buffer.from([0x02, 0x01, 0x03]))
  })

  it('does not mutate the original buffer', () => {
    const input = Buffer.from([0x01, 0x02])
    const result = swap16(input)
    expect(result).toEqual(Buffer.from([0x02, 0x01]))
    expect(input).toEqual(Buffer.from([0x01, 0x02]))
  })

  it('returns empty buffer for empty input', () => {
    const input = Buffer.alloc(0)
    expect(swap16(input)).toEqual(Buffer.alloc(0))
  })

  it('handles single byte', () => {
    const input = Buffer.from([0x42])
    expect(swap16(input)).toEqual(Buffer.from([0x42]))
  })
})

describe('detectEncoding (extended)', () => {
  it('detects UTF-16BE from null-byte heuristic (even nulls)', () => {
    const buf = Buffer.alloc(100)
    for (let i = 0; i < buf.length; i += 2) {
      buf[i] = 0 // null at even positions
      buf[i + 1] = 0x61 // 'a' at odd positions
    }
    expect(detectEncoding(buf)).toBe('utf16be')
  })

  it('falls back to latin1 when heuristic returns null and UTF-8 is invalid', () => {
    // Buffer with no clear null pattern AND invalid UTF-8
    const buf = Buffer.from([0xff, 0x80, 0xff, 0x80])
    // Even: 0xff, 0xff → 0 nulls / 2 = 0
    // Odd: 0x80, 0x80 → 0 nulls / 2 = 0
    // Neither > 0.8 → heuristic returns null
    // isValidUtf8 → false (0xff is invalid)
    expect(detectEncoding(buf)).toBe('latin1')
  })
})

describe('decodeText (extended)', () => {
  it('decodes UTF-16BE content with BOM', () => {
    const content = 'hello world'
    // Create UTF-16BE buffer: swap bytes of UTF-16LE
    const utf16le = Buffer.from(content, 'utf16le')
    const utf16be = swap16(utf16le)
    const buf = Buffer.concat([utf16beBom(), utf16be])
    expect(decodeText(buf)).toBe(content)
  })

  it('decodes UTF-16BE content without BOM', () => {
    const content = 'test message'
    const utf16le = Buffer.from(content, 'utf16le')
    const utf16be = swap16(utf16le)
    expect(decodeText(utf16be)).toBe(content)
  })

  it('decodes latin1 content', () => {
    // 0x80 and above decode as-is in latin1
    const buf = Buffer.from([0xe0, 0xe1, 0xe2])
    expect(decodeText(buf)).toBe('\u00e0\u00e1\u00e2')
  })
})
