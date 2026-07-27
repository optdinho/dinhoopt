import type { UpdatableApp, UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { getSettings } from '../settings-store'
import { checkForUpdatesChoco, isChocoAvailable, runUpdatesChoco } from './checkers/choco'
import { checkForUpdatesScoop, isScoopAvailable, runUpdatesScoop } from './checkers/scoop'
import { checkForUpdatesWinget, isWingetAvailable, runUpdatesWinget } from './checkers/winget'

async function checkForUpdatesWindows(): Promise<UpdateCheckResult> {
  const results = await Promise.allSettled([checkForUpdatesWinget(), checkForUpdatesChoco(), checkForUpdatesScoop()])

  const availableResults: UpdateCheckResult[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.packageManagerAvailable) {
      availableResults.push(r.value)
    }
  }

  if (availableResults.length === 0) {
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

  const seenIds = new Set<string>()
  const mergedApps: UpdatableApp[] = []
  let totalMajor = 0
  let totalMinor = 0
  let totalPatch = 0

  for (const result of availableResults) {
    for (const app of result.apps) {
      if (!seenIds.has(app.id)) {
        seenIds.add(app.id)
        mergedApps.push(app)
        if (app.severity === 'major') totalMajor++
        else if (app.severity === 'minor') totalMinor++
        else if (app.severity === 'patch') totalPatch++
      }
    }
  }

  const activeNames = availableResults.map((r) => r.packageManagerName).filter(Boolean) as string[]
  const combinedName = activeNames.join('+') || 'winget'

  return {
    apps: mergedApps,
    totalCount: mergedApps.length,
    majorCount: totalMajor,
    minorCount: totalMinor,
    patchCount: totalPatch,
    packageManagerAvailable: true,
    packageManagerName: combinedName as UpdateCheckResult['packageManagerName'],
  }
}

async function runUpdatesWindows(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
  source?: string,
): Promise<UpdateResult> {
  if (source === 'choco') return runUpdatesChoco(appIds, onProgress)
  if (source === 'winget') return runUpdatesWinget(appIds, onProgress)
  if (source === 'scoop') return runUpdatesScoop(appIds, onProgress)

  const settings = getSettings()
  const prefer = settings.windowsPackageManager

  const attempts: Array<() => Promise<boolean>> = []
  const runners: Array<() => Promise<UpdateResult>> = []

  if (prefer === 'scoop') {
    attempts.push(isScoopAvailable, isWingetAvailable, isChocoAvailable)
    runners.push(
      () => runUpdatesScoop(appIds, onProgress),
      () => runUpdatesWinget(appIds, onProgress),
      () => runUpdatesChoco(appIds, onProgress),
    )
  } else if (prefer === 'choco') {
    attempts.push(isChocoAvailable, isWingetAvailable, isScoopAvailable)
    runners.push(
      () => runUpdatesChoco(appIds, onProgress),
      () => runUpdatesWinget(appIds, onProgress),
      () => runUpdatesScoop(appIds, onProgress),
    )
  } else {
    attempts.push(isWingetAvailable, isChocoAvailable, isScoopAvailable)
    runners.push(
      () => runUpdatesWinget(appIds, onProgress),
      () => runUpdatesChoco(appIds, onProgress),
      () => runUpdatesScoop(appIds, onProgress),
    )
  }

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]
    const runner = runners[i]
    if (attempt && runner && (await attempt())) return runner()
  }

  return {
    succeeded: 0,
    failed: appIds.length,
    errors: appIds.map((id) => ({ appId: id, name: id, reason: 'No package manager available' })),
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return checkForUpdatesWindows()
}

export async function runUpdates(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
  source?: string,
): Promise<UpdateResult> {
  return runUpdatesWindows(appIds, onProgress, source)
}

export function isValidAppId(id: string): boolean {
  return /^[\w][\w.-]{0,200}$/.test(id)
}
