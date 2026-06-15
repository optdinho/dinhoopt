import { readFile } from 'node:fs/promises'

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'latin1'

const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])
const REPLACEMENT_CHAR = '\uFFFD'

function hasBom(buffer: Buffer, bom: Buffer): boolean {
  if (buffer.length < bom.length) return false
  for (let i = 0; i < bom.length; i++) {
    if (buffer[i] !== bom[i]) return false
  }
  return true
}

function detectByNullHeuristic(buffer: Buffer): TextEncoding | null {
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048))
  if (sample.length < 2) return null

  let evenNulls = 0
  let evenTotal = 0
  let oddNulls = 0
  let oddTotal = 0

  for (let i = 0; i < sample.length; i++) {
    if (i % 2 === 0) {
      evenTotal++
      if (sample[i] === 0) evenNulls++
    } else {
      oddTotal++
      if (sample[i] === 0) oddNulls++
    }
  }

  const evenRatio = evenTotal > 0 ? evenNulls / evenTotal : 0
  const oddRatio = oddTotal > 0 ? oddNulls / oddTotal : 0

  if (evenRatio > 0.8 && oddRatio < 0.2) {
    return 'utf16be'
  }
  if (oddRatio > 0.8 && evenRatio < 0.2) {
    return 'utf16le'
  }

  return null
}

function isValidUtf8(buffer: Buffer): boolean {
  try {
    const decoded = buffer.toString('utf8')
    return !decoded.includes(REPLACEMENT_CHAR)
  } catch {
    return false
  }
}

function swap16(buffer: Buffer): Buffer {
  const result = Buffer.alloc(buffer.length)
  for (let i = 0; i < buffer.length; i += 2) {
    if (i + 1 < buffer.length) {
      result[i] = buffer[i + 1] ?? 0
      result[i + 1] = buffer[i] ?? 0
    } else {
      result[i] = buffer[i] ?? 0
    }
  }
  return result
}

export function detectEncoding(buffer: Buffer): TextEncoding {
  if (buffer.length === 0) return 'utf8'

  if (hasBom(buffer, UTF16LE_BOM)) return 'utf16le'
  if (hasBom(buffer, UTF16BE_BOM)) return 'utf16be'

  const heuristic = detectByNullHeuristic(buffer)
  if (heuristic !== null) return heuristic

  if (isValidUtf8(buffer)) return 'utf8'

  return 'latin1'
}

export function decodeText(buffer: Buffer): string {
  if (buffer.length === 0) return ''

  const encoding = detectEncoding(buffer)

  if (encoding === 'utf16le') {
    if (hasBom(buffer, UTF16LE_BOM)) {
      return buffer.subarray(2).toString('utf16le')
    }
    return buffer.toString('utf16le')
  }

  if (encoding === 'utf16be') {
    const start = hasBom(buffer, UTF16BE_BOM) ? 2 : 0
    return swap16(buffer.subarray(start)).toString('utf16le')
  }

  return buffer.toString(encoding)
}

export async function readTextFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  return decodeText(buffer)
}
