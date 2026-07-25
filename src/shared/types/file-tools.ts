// ─── Large File Finder ──────────────────────────────────────

export interface LargeFileScanOptions {
  directory: string
  minFileSize: number
  maxDepth: number
  excludePatterns: string[]
}

export interface LargeFileEntry {
  path: string
  name: string
  size: number
  lastModified: number
  extension: string
}

export interface LargeFileScanResult {
  files: LargeFileEntry[]
  totalFilesScanned: number
  duration: number
  cancelled: boolean
}

export interface LargeFileScanProgress {
  currentPath: string
  filesScanned: number
  largeFilesFound: number
  progress: number
}

export type LargeFileDeleteMode = 'recycle' | 'permanent'

export interface LargeFileDeleteResult {
  deleted: number
  failed: number
  spaceRecovered: number
  errors: { path: string; reason: string }[]
}

// ─── Empty Folder Cleaner ───────────────────────────────────

export interface EmptyFolderScanOptions {
  directory: string
  maxDepth: number
  excludePatterns: string[]
}

export interface EmptyFolderEntry {
  path: string
  name: string
  depth: number
}

export interface EmptyFolderScanResult {
  folders: EmptyFolderEntry[]
  totalFoldersScanned: number
  duration: number
  cancelled: boolean
}

export interface EmptyFolderScanProgress {
  currentPath: string
  foldersScanned: number
  emptyFound: number
  progress: number
}

export type EmptyFolderDeleteMode = 'recycle' | 'permanent'

export interface EmptyFolderDeleteResult {
  deleted: number
  failed: number
  errors: { path: string; reason: string }[]
}

// ─── File Shredder ──────────────────────────────────────────

export interface ShredderEntry {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

export interface ShredderProgress {
  currentPath: string
  filesShredded: number
  totalFiles: number
  bytesShredded: number
  totalBytes: number
  progress: number
}

export interface ShredderResult {
  shredded: number
  failed: number
  bytesShredded: number
  duration: number
  errors: { path: string; reason: string }[]
  cancelled: boolean
}

// ─── Duplicate Finder ───────────────────────────────────────

export interface DuplicateScanOptions {
  directory: string
  minFileSize: number
  maxFileSize: number | null
  excludePatterns: string[]
  extensionFilter: string[]
  maxDepth: number
}

export interface DuplicateFile {
  path: string
  size: number
  lastModified: number
}

export interface DuplicateGroup {
  hash: string
  fullHash: string
  fileSize: number
  files: DuplicateFile[]
  reclaimableSpace: number
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  totalDuplicates: number
  totalReclaimable: number
  totalFilesScanned: number
  duration: number
  cancelled: boolean
}

export type DuplicateScanPhase = 'walking' | 'grouping' | 'partial-hash' | 'full-hash' | 'complete'

export interface DuplicateScanProgress {
  phase: DuplicateScanPhase
  currentPath: string
  filesScanned: number
  duplicatesFound: number
  reclaimableSpace: number
  progress: number
  filesToHash?: number
  filesHashed?: number
}

export type DuplicateDeleteMode = 'recycle' | 'permanent'

export interface DuplicateDeleteResult {
  deleted: number
  failed: number
  spaceRecovered: number
  errors: { path: string; reason: string }[]
}
