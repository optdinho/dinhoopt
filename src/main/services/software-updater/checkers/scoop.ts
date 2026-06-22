import type { UpdatableApp, UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { execFileAsync } from '../../exec-utf8'
import { cleanOutput, computeSeverity, emptyResult } from '../utils'

const SCOOP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,200}$/

export async function isScoopAvailable(): Promise<boolean> {
  try {
    await execFileAsync('scoop', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export function parseScoopStatusOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  const lines = cleanOutput(stdout).split(/\r?\n/)
  let inTable = false
  for (const line of lines) {
    if (/^\s+Name\s+Installed\s+Available/i.test(line)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (!line.trim() || /^[\s\-_]+$/.test(line)) continue
    if (/^\S/.test(line.trim()) && !line.startsWith(' ')) {
      inTable = false
      continue
    }
    const parts = line.trim().split(/\s{2,}/)
    if (parts.length < 3) continue
    const [name, installed, available] = parts
    if (!name || !installed || !available || available === '-') continue
    if (installed.trim() === available.trim()) continue
    apps.push({
      id: name.trim(),
      name: name.trim(),
      currentVersion: installed.trim(),
      availableVersion: available.trim(),
      source: 'scoop',
      severity: computeSeverity(installed.trim(), available.trim()),
      selected: true,
    })
  }
  return apps
}

export function parseScoopListOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  const lines = cleanOutput(stdout).split(/\r?\n/)
  let inTable = false
  for (const line of lines) {
    if (/^\s+Name\s+Version\s+Source/i.test(line)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (!line.trim() || /^[\s\-_]+$/.test(line)) continue
    if (/^\S/.test(line.trim()) && !line.startsWith(' ')) {
      inTable = false
      continue
    }
    const parts = line.trim().split(/\s{2,}/)
    if (parts.length < 2) continue
    const [name, version] = parts
    if (!name || !version) continue
    apps.push({
      id: name.trim(),
      name: name.trim(),
      currentVersion: version.trim(),
      availableVersion: version.trim(),
      source: 'scoop',
      severity: 'unknown',
      selected: false,
      isUpToDate: true,
    })
  }
  return apps
}

export async function checkForUpdatesScoop(): Promise<UpdateCheckResult> {
  const available = await isScoopAvailable()
  if (!available) {
    return emptyResult(false, 'scoop')
  }

  try {
    let stdout = ''
    try {
      const result = await execFileAsync('scoop', ['status'], {
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
        return emptyResult(true, 'scoop')
      }
    }

    const apps = parseScoopStatusOutput(stdout)

    let upToDateApps: UpdatableApp[] = []
    try {
      let listStdout = ''
      try {
        const listResult = await execFileAsync('scoop', ['list'], {
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
        const allApps = parseScoopListOutput(listStdout)
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
      packageManagerName: 'scoop',
    }
  } catch {
    return emptyResult(true, 'scoop')
  }
}

async function attemptScoopUpdate(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string }> {
  if (!SCOOP_ID_PATTERN.test(appId)) {
    return { success: false, output: 'Invalid package ID format' }
  }
  try {
    const result = await execFileAsync('scoop', ['update', appId, ...extraArgs], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    return { success: true, output: result.stdout }
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    return { success: false, output: e?.message || 'Scoop update failed' }
  }
}

async function upgradeAppScoop(appId: string): Promise<{ success: boolean; error?: string }> {
  let result = await attemptScoopUpdate(appId)

  if (!result.success) {
    const retryResult = await attemptScoopUpdate(appId, ['--global'])
    if (retryResult.success) result = retryResult
  }

  if (!result.success) {
    const retryResult = await attemptScoopUpdate(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Update failed'
  return { success: false, error: lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine }
}

export async function runUpdatesScoop(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: UpdateResult['errors'] = []
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

    const result = await upgradeAppScoop(appId)
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
      errors.push({ appId, name: appId, reason: result.error || 'Unknown error' })
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
