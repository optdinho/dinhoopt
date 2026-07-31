import type { UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { checkForUpdatesWinget, isWingetAvailable, runUpdatesWinget } from './checkers/winget'

const CACHE_TTL_MS = 60_000
let cachedResult: UpdateCheckResult | null = null
let cachedAt = 0

async function checkForUpdatesWindows(): Promise<UpdateCheckResult> {
  const available = await isWingetAvailable()
  if (!available) {
    return {
      apps: [],
      totalCount: 0,
      majorCount: 0,
      minorCount: 0,
      patchCount: 0,
      packageManagerAvailable: false,
      packageManagerName: null,
    }
  }

  return checkForUpdatesWinget()
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const now = Date.now()
  if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
    return cachedResult
  }
  cachedResult = await checkForUpdatesWindows()
  cachedAt = Date.now()
  return cachedResult
}

export function clearUpdateCache(): void {
  cachedResult = null
  cachedAt = 0
}

export async function runUpdates(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
  _source?: string,
): Promise<UpdateResult> {
  const available = await isWingetAvailable()
  if (!available) {
    return {
      succeeded: 0,
      failed: appIds.length,
      errors: appIds.map((id) => ({ appId: id, name: id, reason: 'No package manager available' })),
    }
  }

  return runUpdatesWinget(appIds, onProgress)
}

export function isValidAppId(id: string): boolean {
  return /^[\w][\w.-]{0,200}$/.test(id)
}
