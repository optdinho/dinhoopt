export interface ImportDescriptor {
  dllName: string
  functions: string[]
  ordinals: number[]
}

const IMAGE_SNAP_BY_ORDINAL_32 = 0x80000000
const IMAGE_SNAP_BY_ORDINAL_64 = 0x8000000000000000n
const PE32_MAGIC = 0x10b
const PE32_PLUS_MAGIC = 0x20b
const IMAGE_DIRECTORY_ENTRY_IMPORT = 1
const DOS_HEADER_SIZE = 64
const PE_SIGNATURE_SIZE = 4
const FILE_HEADER_SIZE = 20
const SECTION_HEADER_SIZE = 40
const MAX_SECTIONS = 96

interface PeHeaders {
  is64Bit: boolean
  importRva: number
  importSize: number
  sectionHeaders: SectionHeader[]
}

interface SectionHeader {
  virtualAddress: number
  rawSize: number
  rawPtr: number
}

function readDosHeader(buffer: Buffer): number | null {
  if (buffer.length < DOS_HEADER_SIZE) return null
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null
  const eLfanew = buffer.readUInt32LE(0x3c)
  if (eLfanew + PE_SIGNATURE_SIZE > buffer.length) return null
  return eLfanew
}

function readPeSignature(buffer: Buffer, peOffset: number): boolean {
  if (peOffset + 4 > buffer.length) return false
  return buffer.readUInt32LE(peOffset) === 0x00004550
}

function readPeHeaders(buffer: Buffer): PeHeaders | null {
  const peOffset = readDosHeader(buffer)
  if (peOffset === null) return null
  if (!readPeSignature(buffer, peOffset)) return null

  const fileHeaderEnd = peOffset + PE_SIGNATURE_SIZE + FILE_HEADER_SIZE
  if (fileHeaderEnd > buffer.length) return null

  const numSections = buffer.readUInt16LE(peOffset + 6)
  if (numSections === 0 || numSections > MAX_SECTIONS) return null

  const sizeOfOptionalHeader = buffer.readUInt16LE(peOffset + 20)
  const optHeaderStart = peOffset + PE_SIGNATURE_SIZE + FILE_HEADER_SIZE
  const optHeaderEnd = optHeaderStart + sizeOfOptionalHeader
  if (optHeaderEnd > buffer.length) return null

  const magic = buffer.readUInt16LE(optHeaderStart)
  if (magic !== PE32_MAGIC && magic !== PE32_PLUS_MAGIC) return null

  const is64Bit = magic === PE32_PLUS_MAGIC

  // Data directory offset within optional header
  // PE32: 96, PE32+: 112
  const dataDirOffset = is64Bit ? 112 : 96
  if (optHeaderStart + dataDirOffset + 16 > buffer.length) return null

  // Import directory entry (index 1) = offset + 8
  const importDirOffset = optHeaderStart + dataDirOffset + IMAGE_DIRECTORY_ENTRY_IMPORT * 8
  const importRva = buffer.readUInt32LE(importDirOffset)
  const importSize = buffer.readUInt32LE(importDirOffset + 4)

  // Section headers start after optional header
  const sectionTableStart = optHeaderStart + sizeOfOptionalHeader
  const expectedTableEnd = sectionTableStart + numSections * SECTION_HEADER_SIZE
  if (expectedTableEnd > buffer.length) return null

  const sectionHeaders: SectionHeader[] = []
  for (let i = 0; i < numSections; i++) {
    const secOff = sectionTableStart + i * SECTION_HEADER_SIZE
    if (secOff + SECTION_HEADER_SIZE > buffer.length) break
    sectionHeaders.push({
      virtualAddress: buffer.readUInt32LE(secOff + 12),
      rawSize: buffer.readUInt32LE(secOff + 16),
      rawPtr: buffer.readUInt32LE(secOff + 20),
    })
  }

  return { is64Bit, importRva, importSize, sectionHeaders }
}

function rvaToRawOffset(rva: number, sections: SectionHeader[]): number | null {
  for (const sec of sections) {
    if (sec.rawPtr === 0 || sec.rawSize === 0) continue
    if (rva >= sec.virtualAddress && rva < sec.virtualAddress + sec.rawSize) {
      return sec.rawPtr + (rva - sec.virtualAddress)
    }
  }
  return null
}

function readCString(buffer: Buffer, offset: number): string {
  const end = buffer.indexOf(0, offset)
  if (end === -1 || end === offset) return ''
  return buffer.toString('ascii', offset, end)
}

export function parsePeImports(buffer: Buffer): ImportDescriptor[] {
  const headers = readPeHeaders(buffer)
  if (!headers || headers.importSize === 0) return []

  const importRaw = rvaToRawOffset(headers.importRva, headers.sectionHeaders)
  if (importRaw === null || importRaw + 20 > buffer.length) return []

  const is64 = headers.is64Bit
  const thunkSize = is64 ? 8 : 4
  const ordinalFlag: bigint = is64 ? IMAGE_SNAP_BY_ORDINAL_64 : BigInt(IMAGE_SNAP_BY_ORDINAL_32)

  const result: ImportDescriptor[] = []

  let descOffset = importRaw

  for (let descIdx = 0; descIdx < 4096; descIdx++) {
    if (descOffset + 20 > buffer.length) break

    const originalFirstThunk = buffer.readUInt32LE(descOffset)
    const timeDateStamp = buffer.readUInt32LE(descOffset + 4)
    const forwarderChain = buffer.readUInt32LE(descOffset + 8)
    const nameRva = buffer.readUInt32LE(descOffset + 12)
    const firstThunk = buffer.readUInt32LE(descOffset + 16)

    // End of import descriptors
    if (originalFirstThunk === 0 && timeDateStamp === 0 && forwarderChain === 0 && nameRva === 0 && firstThunk === 0) {
      break
    }

    // Resolve DLL name
    const nameRaw = rvaToRawOffset(nameRva, headers.sectionHeaders)
    if (nameRaw === null || nameRaw >= buffer.length) {
      descOffset += 20
      continue
    }
    const dllName = readCString(buffer, nameRaw)

    // Use OriginalFirstThunk if non-zero, else FirstThunk
    const thunkRva = originalFirstThunk !== 0 ? originalFirstThunk : firstThunk
    if (thunkRva === 0) {
      descOffset += 20
      continue
    }

    const thunkRaw = rvaToRawOffset(thunkRva, headers.sectionHeaders)
    if (thunkRaw === null) {
      descOffset += 20
      continue
    }

    const functions: string[] = []
    const ordinals: number[] = []

    for (let thunkIdx = 0; thunkIdx < 8192; thunkIdx++) {
      const thunkOff = thunkRaw + thunkIdx * thunkSize
      if (thunkOff + thunkSize > buffer.length) break

      let thunkValue: bigint
      if (is64) {
        thunkValue = buffer.readBigUInt64LE(thunkOff)
      } else {
        thunkValue = BigInt(buffer.readUInt32LE(thunkOff))
      }

      if (thunkValue === 0n) break

      if (thunkValue & ordinalFlag) {
        // Import by ordinal
        const ordinal = Number(thunkValue & ~ordinalFlag)
        ordinals.push(ordinal)
      } else {
        // Import by name — parse IMAGE_IMPORT_BY_NAME
        const byNameRva = Number(thunkValue)
        const byNameRaw = rvaToRawOffset(byNameRva, headers.sectionHeaders)
        if (byNameRaw === null || byNameRaw + 3 > buffer.length) continue

        // Skip hint (WORD) and read name
        const funcName = readCString(buffer, byNameRaw + 2)
        if (funcName) {
          functions.push(funcName)
        }
      }
    }

    result.push({ dllName, functions, ordinals })
    descOffset += 20
  }

  return result
}
