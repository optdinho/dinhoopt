import type { UpdatableApp, UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { isAdmin } from '../../elevation'
import { execFileAsync, psUtf8 } from '../../exec-utf8'
import { cleanOutput, computeSeverity, emptyResult } from '../utils'

const CHOCO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/

export async function isChocoAvailable(): Promise<boolean> {
  try {
    await execFileAsync('choco', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export function parseChocoOutdatedOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of cleanOutput(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('|')
    if (parts.length < 4) continue
    const [id, currentVersion, availableVersion, pinned] = parts
    if (!id || !currentVersion || !availableVersion) continue
    if (pinned?.trim().toLowerCase() === 'true') continue
    if (currentVersion.trim() === availableVersion.trim()) continue
    apps.push({
      id: id.trim(),
      name: id.trim(),
      currentVersion: currentVersion.trim(),
      availableVersion: availableVersion.trim(),
      source: 'choco',
      severity: computeSeverity(currentVersion.trim(), availableVersion.trim()),
      selected: true,
    })
  }
  return apps
}

export function parseChocoListOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of cleanOutput(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('|')
    if (parts.length < 2) continue
    const [id, version] = parts
    if (!id || !version) continue
    apps.push({
      id: id.trim(),
      name: id.trim(),
      currentVersion: version.trim(),
      availableVersion: version.trim(),
      source: 'choco',
      severity: 'unknown',
      selected: false,
      isUpToDate: true,
    })
  }
  return apps
}

export async function checkForUpdatesChoco(): Promise<UpdateCheckResult> {
  const available = await isChocoAvailable()
  if (!available) {
    return emptyResult(false, 'choco')
  }

  try {
    let stdout = ''
    try {
      const result = await execFileAsync('choco', ['outdated', '--limit-output'], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      })
      stdout = result.stdout
    } catch (err: unknown) {
      const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
      if (e?.stdout) {
        stdout = e.stdout
      } else {
        return emptyResult(true, 'choco')
      }
    }

    const apps = parseChocoOutdatedOutput(stdout)

    let upToDateApps: UpdatableApp[] = []
    try {
      let listStdout = ''
      try {
        const listResult = await execFileAsync('choco', ['list', '--limit-output'], {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        })
        listStdout = listResult.stdout
      } catch (err: unknown) {
        const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
        if (e?.stdout) listStdout = e.stdout
      }
      if (listStdout) {
        const allApps = parseChocoListOutput(listStdout)
        const outdatedIds = new Set(apps.map((a) => a.id))
        upToDateApps = allApps.filter((a) => !outdatedIds.has(a.id))
      }
    } catch {
      // Non-critical — just skip the up-to-date list
    }

    return {
      apps: [...apps, ...upToDateApps],
      totalCount: apps.length,
      majorCount: apps.filter((a) => a.severity === 'major').length,
      minorCount: apps.filter((a) => a.severity === 'minor').length,
      patchCount: apps.filter((a) => a.severity === 'patch').length,
      packageManagerAvailable: true,
      packageManagerName: 'choco',
    }
  } catch {
    return emptyResult(true, 'choco')
  }
}

const CHOCO_SUCCESS_PATTERNS = ['was successful', 'has been successfully', 'upgraded 1/']

const CHOCO_FAILURE_PATTERNS = ['was not successful', 'not installed', 'cannot find path', 'unable to find']

const CHOCO_ELEVATION_HINTS = [
  'access to the path',
  'access is denied',
  'administrator',
  'run as admin',
  'elevated permissions',
]

async function attemptChocoUpgrade(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string }> {
  if (!CHOCO_ID_PATTERN.test(appId)) {
    return { success: false, output: 'Invalid package ID format' }
  }
  let upgradeStdout = ''
  try {
    const result = await execFileAsync('choco', ['upgrade', appId, '-y', ...extraArgs], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    upgradeStdout = result.stdout
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    if (e?.stdout) {
      upgradeStdout = e.stdout
    } else {
      return { success: false, output: e?.message || 'Unknown error' }
    }
  }

  const output = cleanOutput(upgradeStdout).toLowerCase()
  const wasSuccessful = CHOCO_SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = CHOCO_FAILURE_PATTERNS.some((p) => output.includes(p))

  if (wasSuccessful && !hasClearFailure) {
    return { success: true, output: upgradeStdout }
  }
  return { success: false, output: upgradeStdout }
}

async function attemptElevatedChocoUpgrade(appId: string): Promise<{ success: boolean; output: string }> {
  if (!CHOCO_ID_PATTERN.test(appId)) {
    return { success: false, output: 'Invalid package ID format' }
  }

  try {
    const args = ['upgrade', appId, '-y', '--force'].join(' ')
    const safeArgs = args.replace(/'/g, "''")
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        psUtf8(
          `$p = Start-Process choco -ArgumentList '${safeArgs}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
        ),
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const checkResult = await execFileAsync('choco', ['outdated', '--limit-output'], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    const stillNeedsUpgrade = checkResult.stdout.split(/\r?\n/).some((line) => line.startsWith(`${appId}|`))
    return {
      success: !stillNeedsUpgrade,
      output: stillNeedsUpgrade ? 'Package still needs upgrade after elevated attempt' : 'Elevated upgrade succeeded',
    }
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    return { success: false, output: e?.message || 'Elevated upgrade failed' }
  }
}

async function upgradeAppChoco(appId: string, alreadyAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  let result = await attemptChocoUpgrade(appId)

  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      CHOCO_ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) ||
      CHOCO_FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      result = await attemptElevatedChocoUpgrade(appId)
    }
  }

  if (!result.success) {
    const retryResult = await attemptChocoUpgrade(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return { success: false, error: lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine }
}

export async function runUpdatesChoco(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: UpdateResult['errors'] = []
  const alreadyAdmin = isAdmin()
  const total = appIds.length

  for (const appId of appIds) {
    onProgress({
      phase: 'updating',
      current: completed + 1,
      total,
      currentApp: appId,
      percent: Math.round((completed / total) * 100),
      status: 'in-progress',
    })

    const result = await upgradeAppChoco(appId, alreadyAdmin)
    completed++

    if (result.success) {
      succeeded++
      onProgress({
        phase: 'updating',
        current: completed,
        total,
        currentApp: appId,
        percent: Math.round((completed / total) * 100),
        status: 'done',
      })
    } else {
      failed++
      errors.push({ appId, name: appId, reason: result.error || 'Upgrade failed' })
      onProgress({
        phase: 'updating',
        current: completed,
        total,
        currentApp: appId,
        percent: Math.round((completed / total) * 100),
        status: 'failed',
      })
    }
  }

  return { succeeded, failed, errors }
}
