import { describe, expect, it } from 'vitest'
import { parsePeImports } from './pe-parser'

// ─── Synthetic PE builder ──────────────────────────────────────────

const PE_OFFSET = 0x80
const FILE_HEADER_SIZE = 20
const OPT_HDR_SIZE_32 = 0xe0
const OPT_HDR_SIZE_64 = 0xf0
const SECTION_HEADER_SIZE = 40
const SECTION_VA = 0x1000
const SECTION_ALIGN = 0x1000
const FILE_ALIGN = 0x200

interface ImportSpec {
  dllName: string
  functions: string[]
  ordinals: number[]
}

/**
 * Build a synthetic PE buffer with the given import table.
 * Always produces exactly one section ".text" at VA 0x1000.
 */
function buildPe(imports: ImportSpec[], is64 = false): Buffer {
  const is64Bit = is64
  const thunkSize = is64Bit ? 8 : 4
  const ordinalFlag: bigint = is64Bit ? 0x8000000000000000n : 0x80000000n
  const optHdrSize = is64Bit ? OPT_HDR_SIZE_64 : OPT_HDR_SIZE_32

  const optionalHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE

  // ── Layout import data ──────────────────────────────────────
  const importDataSize = (imports.length + 1) * 20

  // Thunk arrays (relative to start of import data)
  const thunkRelOffsets: number[] = []
  let cur = importDataSize
  for (const imp of imports) {
    thunkRelOffsets.push(cur)
    cur += (imp.functions.length + imp.ordinals.length + 1) * thunkSize
  }

  // DLL names (relative to start of import data)
  const dllNameRelOffsets: number[] = []
  for (const imp of imports) {
    dllNameRelOffsets.push(cur)
    cur += imp.dllName.length + 1
  }

  // IMAGE_IMPORT_BY_NAME entries (relative to start of import data)
  const importByNameRelOffsets: number[][] = []
  for (const imp of imports) {
    const offsets: number[] = []
    for (const fn of imp.functions) {
      offsets.push(cur)
      cur += 2 + fn.length + 1
    }
    importByNameRelOffsets.push(offsets)
  }

  const importDataTotal = cur

  // ── Compute raw section offset ──────────────────────────────
  const sectionHeaderStart = optionalHeaderStart + optHdrSize
  const headersEnd = sectionHeaderStart + SECTION_HEADER_SIZE
  const rawDataStart = Math.ceil(headersEnd / FILE_ALIGN) * FILE_ALIGN

  const totalSize = rawDataStart + importDataTotal + 0x100
  const buf = Buffer.alloc(totalSize, 0)

  // ── DOS header ──────────────────────────────────────────────
  buf.write('MZ', 0, 'ascii')
  buf.writeUInt32LE(PE_OFFSET, 0x3c)

  // ── PE signature ────────────────────────────────────────────
  buf.writeUInt32LE(0x00004550, PE_OFFSET)

  // ── File header ─────────────────────────────────────────────
  buf.writeUInt16LE(is64Bit ? 0x8664 : 0x014c, PE_OFFSET + 4) // Machine
  buf.writeUInt16LE(1, PE_OFFSET + 6) // NumberOfSections
  buf.writeUInt16LE(0, PE_OFFSET + 8) // TimeDateStamp
  buf.writeUInt16LE(0, PE_OFFSET + 12) // PointerToSymbolTable
  buf.writeUInt16LE(0, PE_OFFSET + 16) // NumberOfSymbols
  buf.writeUInt16LE(optHdrSize, PE_OFFSET + 20) // SizeOfOptionalHeader
  buf.writeUInt16LE(0x0102, PE_OFFSET + 22) // Characteristics

  // ── Optional header ─────────────────────────────────────────
  // Magic
  buf.writeUInt16LE(is64Bit ? 0x020b : 0x010b, optionalHeaderStart)

  // Standard fields (skip to section/file alignment)
  // PE32:  BaseOfData at offset 24+4, ImageBase at 24+8
  //        SectionAlignment at 24+12 (= 36)
  // PE32+: ImageBase at 24+0, SectionAlignment at 24+8
  const sectionAlignOff = optionalHeaderStart + (is64Bit ? 32 : 36)
  const fileAlignOff = optionalHeaderStart + (is64Bit ? 36 : 40)

  buf.writeUInt32LE(SECTION_ALIGN, sectionAlignOff)
  buf.writeUInt32LE(FILE_ALIGN, fileAlignOff)

  // SizeOfImage (offset for PE32: from optional header; let's use the right offset)
  // PE32: SizeOfImage at optionalHeaderStart + 56
  // PE32+: SizeOfImage at optionalHeaderStart + 56 as well
  buf.writeUInt32LE(SECTION_VA + 0x200, optionalHeaderStart + 56)

  // SizeOfHeaders
  buf.writeUInt32LE(rawDataStart, optionalHeaderStart + 60)

  // Subsystem (offset PE32: 68, PE32+: 68)
  buf.writeUInt16LE(2, optionalHeaderStart + 68) // WINDOWS_GUI

  // NumberOfRvaAndSizes
  // PE32: offset 92, PE32+: offset 108
  const numRvaOff = is64Bit ? optionalHeaderStart + 108 : optionalHeaderStart + 92
  buf.writeUInt32LE(16, numRvaOff)

  // Data directories start: PE32 at optional+96, PE32+ at optional+112
  const dataDirStart = optionalHeaderStart + (is64Bit ? 112 : 96)

  // IMAGE_DIRECTORY_ENTRY_IMPORT = index 1
  const importRVA = SECTION_VA
  buf.writeUInt32LE(importRVA, dataDirStart + 8) // Import RVA
  buf.writeUInt32LE(importDataTotal, dataDirStart + 12) // Import Size

  // ── Section header ──────────────────────────────────────────
  buf.write('.text\u0000\u0000\u0000', sectionHeaderStart, 'ascii')
  buf.writeUInt32LE(importDataTotal, sectionHeaderStart + 8) // VirtualSize
  buf.writeUInt32LE(SECTION_VA, sectionHeaderStart + 12) // VirtualAddress
  buf.writeUInt32LE(importDataTotal, sectionHeaderStart + 16) // SizeOfRawData
  buf.writeUInt32LE(rawDataStart, sectionHeaderStart + 20) // PointerToRawData
  buf.writeUInt32LE(0, sectionHeaderStart + 24) // PointerToRelocations
  buf.writeUInt32LE(0, sectionHeaderStart + 28) // PointerToLinenumbers
  buf.writeUInt16LE(0, sectionHeaderStart + 32) // NumberOfRelocations
  buf.writeUInt16LE(0, sectionHeaderStart + 34) // NumberOfLinenumbers
  buf.writeUInt32LE(0x60000020, sectionHeaderStart + 36) // Characteristics

  // ── Import data ─────────────────────────────────────────────
  let rawPos = rawDataStart

  for (let dllIdx = 0; dllIdx < imports.length; dllIdx++) {
    const thunkRel = thunkRelOffsets[dllIdx]!
    const thunkRVA = SECTION_VA + thunkRel
    const nameRVA = SECTION_VA + dllNameRelOffsets[dllIdx]!

    // IMAGE_IMPORT_DESCRIPTOR
    buf.writeUInt32LE(thunkRVA, rawPos) // OriginalFirstThunk
    buf.writeUInt32LE(0, rawPos + 4) // TimeDateStamp
    buf.writeUInt32LE(0, rawPos + 8) // ForwarderChain
    buf.writeUInt32LE(nameRVA, rawPos + 12) // Name
    buf.writeUInt32LE(thunkRVA, rawPos + 16) // FirstThunk
    rawPos += 20
  }

  // Null terminator descriptor
  rawPos += 20

  // Write thunk arrays
  for (let dllIdx = 0; dllIdx < imports.length; dllIdx++) {
    const imp = imports[dllIdx]!
    const byNameOffsets = importByNameRelOffsets[dllIdx]!

    for (let fnIdx = 0; fnIdx < imp.functions.length; fnIdx++) {
      const fnRVA = SECTION_VA + byNameOffsets[fnIdx]!
      if (is64Bit) {
        buf.writeBigUInt64LE(BigInt(fnRVA), rawPos)
      } else {
        buf.writeUInt32LE(fnRVA, rawPos)
      }
      rawPos += thunkSize
    }

    for (const ord of imp.ordinals) {
      const thunkVal = ordinalFlag | BigInt(ord)
      if (is64Bit) {
        buf.writeBigUInt64LE(thunkVal, rawPos)
      } else {
        buf.writeUInt32LE(Number(thunkVal), rawPos)
      }
      rawPos += thunkSize
    }

    // Null terminator for thunk array
    if (is64Bit) {
      buf.writeBigUInt64LE(0n, rawPos)
    } else {
      buf.writeUInt32LE(0, rawPos)
    }
    rawPos += thunkSize
  }

  // Write DLL names
  for (const imp of imports) {
    buf.write(imp.dllName, rawPos, 'ascii')
    buf.writeUInt8(0, rawPos + imp.dllName.length)
    rawPos += imp.dllName.length + 1
  }

  // Write IMAGE_IMPORT_BY_NAME entries
  for (let dllIdx = 0; dllIdx < imports.length; dllIdx++) {
    const imp = imports[dllIdx]!
    for (const fn of imp.functions) {
      buf.writeUInt16LE(0, rawPos) // Hint
      buf.write(fn, rawPos + 2, 'ascii')
      buf.writeUInt8(0, rawPos + 2 + fn.length)
      rawPos += 2 + fn.length + 1
    }
  }

  return buf
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('parsePeImports', () => {
  it('returns empty array for non-PE buffer (plain text)', () => {
    const buf = Buffer.from('this is not a PE file', 'ascii')
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('returns empty array for truncated/invalid buffer', () => {
    // Only has MZ but nothing else
    const buf = Buffer.alloc(2, 0)
    buf.write('MZ', 0, 'ascii')
    expect(parsePeImports(buf)).toEqual([])
  })

  it('returns empty array for MZ header with invalid e_lfanew pointing past buffer', () => {
    const buf = Buffer.alloc(128, 0)
    buf.write('MZ', 0, 'ascii')
    buf.writeUInt32LE(200, 0x3c) // e_lfanew past buffer
    expect(parsePeImports(buf)).toEqual([])
  })

  it('returns empty array when PE signature is invalid', () => {
    const buf = Buffer.alloc(512, 0)
    buf.write('MZ', 0, 'ascii')
    buf.writeUInt32LE(0x80, 0x3c)
    buf.writeUInt32LE(0xdeadbeef, 0x80) // Invalid PE signature
    expect(parsePeImports(buf)).toEqual([])
  })

  it('returns empty array when buffer is too small for PE headers', () => {
    const buf = Buffer.alloc(64, 0)
    buf.write('MZ', 0, 'ascii')
    buf.writeUInt32LE(128, 0x3c) // e_lfanew points past buffer
    expect(parsePeImports(buf)).toEqual([])
  })

  it('successfully parses basic PE32 import table', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW', 'VirtualAllocEx', 'WriteProcessMemory'],
        ordinals: [],
      },
    ]
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName.toLowerCase()).toBe('kernel32.dll')
    expect(result[0]!.functions).toEqual(
      expect.arrayContaining(['CreateFileW', 'VirtualAllocEx', 'WriteProcessMemory']),
    )
    expect(result[0]!.ordinals).toEqual([])
  })

  it('successfully parses PE32+ (64-bit) import table', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'ntdll.dll',
        functions: ['NtCreateFile', 'NtOpenProcess'],
        ordinals: [],
      },
    ]
    const buf = buildPe(imports, true)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName.toLowerCase()).toBe('ntdll.dll')
    expect(result[0]!.functions).toEqual(expect.arrayContaining(['NtCreateFile', 'NtOpenProcess']))
  })

  it('handles imports by ordinal', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'ws2_32.dll',
        functions: [],
        ordinals: [116, 117, 151], // WSAStartup, WSACleanup, etc.
      },
    ]
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName.toLowerCase()).toBe('ws2_32.dll')
    expect(result[0]!.functions).toEqual([])
    expect(result[0]!.ordinals).toEqual([116, 117, 151])
  })

  it('handles mixed import by name and ordinal', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW'],
        ordinals: [755], // Some ordinal import
      },
    ]
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName.toLowerCase()).toBe('kernel32.dll')
    expect(result[0]!.functions).toEqual(['CreateFileW'])
    expect(result[0]!.ordinals).toEqual([755])
  })

  it('parses multiple DLLs from import table', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW', 'VirtualAllocEx'],
        ordinals: [],
      },
      {
        dllName: 'user32.dll',
        functions: ['MessageBoxW'],
        ordinals: [],
      },
      {
        dllName: 'ntdll.dll',
        functions: [],
        ordinals: [12, 34],
      },
    ]
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.dllName.toLowerCase())).toEqual(
      expect.arrayContaining(['kernel32.dll', 'user32.dll', 'ntdll.dll']),
    )
    const ntdll = result.find((r) => r.dllName.toLowerCase() === 'ntdll.dll')
    expect(ntdll?.ordinals).toEqual([12, 34])
  })

  it('handles empty import table (no import directory)', () => {
    const buf = buildPe([], false)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('handles empty import table when import size is zero', () => {
    // Still valid PE but with no imports
    const imports: ImportSpec[] = []
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('does not crash on bound import directory (index 11)', () => {
    // Just a normal PE - bound imports are a separate data directory entry
    // which we don't use. This test ensures no crash referencing other entries.
    const imports: ImportSpec[] = [{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }]
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName.toLowerCase()).toBe('kernel32.dll')
  })

  it('handles null bytes in DLL name gracefully', () => {
    // Build a PE where the DLL name has embedded nulls
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW'],
        ordinals: [],
      },
    ]
    const buf = buildPe(imports, false)
    // Corrupt the DLL name by inserting a null byte in the middle
    // Find the DLL name in the raw section
    const rawDataStart =
      Math.ceil((PE_OFFSET + 4 + FILE_HEADER_SIZE + OPT_HDR_SIZE_32 + SECTION_HEADER_SIZE) / FILE_ALIGN) * FILE_ALIGN
    const nameRawOffset = rawDataStart + (imports.length + 1) * 20 + (1 + 1) * 4 + 0
    buf.writeUInt8(0, nameRawOffset + 4) // insert null after "kern"
    const result = parsePeImports(buf)
    // Should not crash; DLL name may be truncated
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName).toBeTruthy()
  })

  it('handles very large import table (many DLLs)', () => {
    const imports: ImportSpec[] = []
    for (let i = 0; i < 50; i++) {
      imports.push({
        dllName: `dll${i}.dll`,
        functions: [`Func${i}_A`, `Func${i}_B`],
        ordinals: [],
      })
    }
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(50)
    expect(result[0]!.dllName).toBe('dll0.dll')
    expect(result[49]!.dllName).toBe('dll49.dll')
  })

  it('finds kernel32.CreateFileW in a synthetic PE', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW', 'ReadFile', 'WriteFile'],
        ordinals: [],
      },
    ]
    const buf = buildPe(imports, false)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.dllName.toLowerCase()).toBe('kernel32.dll')
    expect(result[0]!.functions).toContain('CreateFileW')
  })

  it('handles PE32+ imports by ordinal (64-bit ordinal flag)', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'ntdll.dll',
        functions: [],
        ordinals: [10, 20, 30],
      },
    ]
    const buf = buildPe(imports, true)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.ordinals).toEqual([10, 20, 30])
  })

  it('handles PE32+ mixed imports (name + ordinal)', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW', 'VirtualAllocEx'],
        ordinals: [755, 756],
      },
    ]
    const buf = buildPe(imports, true)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.functions).toContain('CreateFileW')
    expect(result[0]!.functions).toContain('VirtualAllocEx')
    expect(result[0]!.ordinals).toEqual([755, 756])
  })

  it('parses 100 PE files under 1 second (performance)', () => {
    const imports: ImportSpec[] = [
      {
        dllName: 'kernel32.dll',
        functions: ['CreateFileW', 'VirtualAllocEx', 'WriteProcessMemory'],
        ordinals: [100],
      },
      {
        dllName: 'user32.dll',
        functions: ['MessageBoxW', 'SendMessageW'],
        ordinals: [],
      },
    ]
    const buf = buildPe(imports, false)
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      parsePeImports(buf)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  it('returns empty array for PE with NumberOfSections = 0', () => {
    const buf = buildPe([], false)
    buf.writeUInt16LE(0, PE_OFFSET + 6)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('returns empty array when file header extends past buffer', () => {
    const buf = buildPe([], false)
    const truncated = buf.subarray(0, PE_OFFSET + 4 + FILE_HEADER_SIZE - 1) // 151 bytes
    expect(parsePeImports(truncated)).toEqual([])
  })

  it('returns empty array when NumberOfSections exceeds MAX_SECTIONS', () => {
    const buf = buildPe([], false)
    buf.writeUInt16LE(97, PE_OFFSET + 6)
    expect(parsePeImports(buf)).toEqual([])
  })

  it('returns empty array when optional header extends past buffer', () => {
    const buf = buildPe([], false)
    buf.writeUInt16LE(0xffff, PE_OFFSET + 20)
    expect(parsePeImports(buf)).toEqual([])
  })

  it('returns empty array when optional header magic is invalid', () => {
    const buf = buildPe([], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    buf.writeUInt16LE(0x0300, optHeaderStart)
    expect(parsePeImports(buf)).toEqual([])
  })

  it('returns empty array when data directory area is truncated', () => {
    const buf = buildPe([], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const dataDirOffset = 96
    const minNeeded = optHeaderStart + dataDirOffset + 16
    const truncated = buf.subarray(0, minNeeded - 1)
    expect(parsePeImports(truncated)).toEqual([])
  })

  it('returns empty array when section headers extend past buffer', () => {
    const buf = buildPe([{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sizeOfOptionalHeader = buf.readUInt16LE(PE_OFFSET + 20)
    const sectionTableStart = optHeaderStart + sizeOfOptionalHeader
    const truncated = buf.subarray(0, sectionTableStart + 40 - 1)
    expect(parsePeImports(truncated)).toEqual([])
  })

  it('breaks section loop when a section header is truncated', () => {
    const buf = buildPe([], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sizeOfOptionalHeader = buf.readUInt16LE(PE_OFFSET + 20)
    const sectionTableStart = optHeaderStart + sizeOfOptionalHeader
    const oneFullSectionPast = sectionTableStart + 40
    const truncated = buf.subarray(0, oneFullSectionPast + 10)
    const origNumSections = buf.readUInt16LE(PE_OFFSET + 6)
    buf.writeUInt16LE(origNumSections + 2, PE_OFFSET + 6)
    const result = parsePeImports(truncated)
    expect(Array.isArray(result)).toBe(true)
  })

  it('skips section with rawPtr or rawSize zero in rvaToRawOffset', () => {
    const imports: ImportSpec[] = [{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }]
    const buf = buildPe(imports, false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sizeOfOptionalHeader = buf.readUInt16LE(PE_OFFSET + 20)
    const sectionTableStart = optHeaderStart + sizeOfOptionalHeader
    buf.writeUInt32LE(0, sectionTableStart + 20)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('returns empty string when readCString has no null terminator', () => {
    const imports: ImportSpec[] = [{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }]
    const buf = buildPe(imports, false)
    const rawDataStart =
      Math.ceil((PE_OFFSET + 4 + FILE_HEADER_SIZE + OPT_HDR_SIZE_32 + SECTION_HEADER_SIZE) / 512) * 512
    const importDataSize = (1 + 1) * 20
    const thunkArraySize = (1 + 1) * 4
    const dllNameRelOffset = importDataSize + thunkArraySize
    const dllNamePos = rawDataStart + dllNameRelOffset
    for (let i = dllNamePos; i < buf.length; i++) {
      if (buf[i] === 0) buf[i] = 0x20
    }
    const result = parsePeImports(buf)
    expect(result).toHaveLength(0)
  })

  it('handles empty function name (null at offset) in IMAGE_IMPORT_BY_NAME', () => {
    const imports: ImportSpec[] = [{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }]
    const buf = buildPe(imports, false)
    const rawDataStart =
      Math.ceil((PE_OFFSET + 4 + FILE_HEADER_SIZE + OPT_HDR_SIZE_32 + SECTION_HEADER_SIZE) / 512) * 512
    const importDataSize = (1 + 1) * 20
    const thunkArraySize = (1 + 1) * 4
    const dllNameLen = 'kernel32.dll'.length + 1
    const fnHintNameOffset = importDataSize + thunkArraySize + dllNameLen
    const fnNamePos = rawDataStart + fnHintNameOffset + 2
    buf[fnNamePos] = 0
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.functions).not.toContain('CreateFileW')
  })

  it('returns empty array when import raw offset extends past buffer', () => {
    const imports: ImportSpec[] = [{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }]
    const buf = buildPe(imports, false)
    const rawDataStart =
      Math.ceil((PE_OFFSET + 4 + FILE_HEADER_SIZE + OPT_HDR_SIZE_32 + SECTION_HEADER_SIZE) / 512) * 512
    const truncated = buf.subarray(0, rawDataStart + 19)
    expect(parsePeImports(truncated)).toEqual([])
  })

  it('breaks descriptor loop when descriptor extends past buffer', () => {
    const imports: ImportSpec[] = [
      { dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] },
      { dllName: 'user32.dll', functions: ['MessageBoxW'], ordinals: [] },
    ]
    const buf = buildPe(imports, false)
    const rawDataStart =
      Math.ceil((PE_OFFSET + 4 + FILE_HEADER_SIZE + OPT_HDR_SIZE_32 + SECTION_HEADER_SIZE) / 512) * 512
    const truncated = buf.subarray(0, rawDataStart + 25)
    const result = parsePeImports(truncated)
    expect(result.length).toBeLessThanOrEqual(1)
  })

  it('skips descriptor when DLL name RVA resolves past buffer', () => {
    const buf = buildPe([{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sectionHeaderStart = optHeaderStart + OPT_HDR_SIZE_32
    const rawDataStart = Math.ceil((sectionHeaderStart + SECTION_HEADER_SIZE) / 512) * 512
    buf.writeUInt32LE(rawDataStart + 9999, rawDataStart + 12)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('skips descriptor when OriginalFirstThunk and FirstThunk are both zero', () => {
    const buf = buildPe([{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sectionHeaderStart = optHeaderStart + OPT_HDR_SIZE_32
    const rawDataStart = Math.ceil((sectionHeaderStart + SECTION_HEADER_SIZE) / 512) * 512
    buf.writeUInt32LE(0, rawDataStart)
    buf.writeUInt32LE(0, rawDataStart + 16)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('skips descriptor when thunk RVA cannot be resolved', () => {
    const buf = buildPe([{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sectionHeaderStart = optHeaderStart + OPT_HDR_SIZE_32
    const rawDataStart = Math.ceil((sectionHeaderStart + SECTION_HEADER_SIZE) / 512) * 512
    buf.writeUInt32LE(0xffffffff, rawDataStart)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })

  it('breaks thunk loop when thunk offset extends past buffer', () => {
    const imports: ImportSpec[] = [{ dllName: 'kernel32.dll', functions: ['CreateFileW', 'ReadFile'], ordinals: [] }]
    const buf = buildPe(imports, false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sectionHeaderStart = optHeaderStart + OPT_HDR_SIZE_32
    const rawDataStart = Math.ceil((sectionHeaderStart + SECTION_HEADER_SIZE) / 512) * 512
    // Corrupt ReadFile's thunk entry (at offset +44) so it cannot be resolved
    buf.writeUInt32LE(0xffffffff, rawDataStart + 44)
    const result = parsePeImports(buf)
    expect(result).toHaveLength(1)
    expect(result[0]!.functions).toEqual(['CreateFileW'])
  })

  it('skips by-name import when name RVA cannot be resolved', () => {
    const buf = buildPe([{ dllName: 'kernel32.dll', functions: ['CreateFileW'], ordinals: [] }], false)
    const optHeaderStart = PE_OFFSET + 4 + FILE_HEADER_SIZE
    const sectionHeaderStart = optHeaderStart + OPT_HDR_SIZE_32
    const rawDataStart = Math.ceil((sectionHeaderStart + SECTION_HEADER_SIZE) / 512) * 512
    // Zero OriginalFirstThunk so code falls through to the corrupted FirstThunk
    buf.writeUInt32LE(0, rawDataStart)
    buf.writeUInt32LE(0xffffffff, rawDataStart + 16)
    const result = parsePeImports(buf)
    expect(result).toEqual([])
  })
})
