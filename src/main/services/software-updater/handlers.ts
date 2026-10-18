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

/**
 * Display names for the ids we are about to update, taken from the most recent
 * check. Lets a failed upgrade report "Google Chrome" instead of the raw id.
 */
function namesFromLastCheck(appIds: string[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const app of cachedResult?.apps ?? []) {
    if (app.name && appIds.includes(app.id)) names.set(app.id, app.name)
  }
  return names
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

  const result = await runUpdatesWinget(appIds, onProgress, namesFromLastCheck(appIds))
  // The world changed: drop the cached check so the next one reflects reality.
  clearUpdateCache()
  return result
}

export function isValidAppId(id: string): boolean {
  return /^[\w][\w.-]{0,200}$/.test(id)
}
