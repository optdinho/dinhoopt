import type { UpdatableApp, UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { isAdmin } from '../../elevation'
import { execFileAsync, psUtf8 } from '../../exec-utf8'
import { cleanOutput, computeSeverity, emptyResult, stripTrailingVersion } from '../utils'

export function parseWingetUpgradeOutput(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i]
    if (!headerLine) continue
    if (/Name\s+Id\s+Version\s+Available\s+Source/i.test(headerLine)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx] ?? '')) return []

  const header = lines[headerIdx]
  if (!header) return []
  const idStart = header.indexOf('Id')
  const versionStart = header.indexOf('Version')
  const availableStart = header.indexOf('Available')
  const sourceStart = header.indexOf('Source')

  if (idStart < 0 || versionStart < 0 || availableStart < 0 || sourceStart < 0) return []

  const apps: UpdatableApp[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (!line.trim()) continue
    if (/^\d+\s+upgrade/i.test(line.trim())) break

    const name = line.substring(0, idStart).trim()
    const id = line.substring(idStart, versionStart).trim()
    let version = line.substring(versionStart, availableStart).trim()
    let available = line.substring(availableStart, sourceStart).trim()
    if (version.startsWith('> ')) version = version.slice(2)
    if (version.startsWith('< ')) version = version.slice(2)
    if (available.startsWith('> ')) available = available.slice(2)
    if (available.startsWith('< ')) available = available.slice(2)
    const source = line.substring(sourceStart).trim()

    if (!id || !version || !available) continue
    if (version === available) continue

    apps.push({
      id,
      name: stripTrailingVersion(name) || id,
      currentVersion: version,
      availableVersion: available,
      source: source || 'winget',
      severity: computeSeverity(version, available),
      selected: true,
    })
  }
  return apps
}

export function parseWingetListOutput(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i]
    if (!headerLine) continue
    if (/Name\s+Id\s+Version/i.test(headerLine)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx] ?? '')) return []

  const header = lines[headerIdx]
  if (!header) return []
  const idStart = header.indexOf('Id')
  const versionStart = header.indexOf('Version')
  const availableStart = header.indexOf('Available')
  const sourceStart = header.indexOf('Source')

  if (idStart < 0 || versionStart < 0) return []

  const versionEnd = availableStart > 0 ? availableStart : sourceStart > 0 ? sourceStart : -1

  const apps: UpdatableApp[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (!line.trim()) continue
    if (/^\d+\s+package/i.test(line.trim())) break

    const name = line.substring(0, idStart).trim()
    const id = line.substring(idStart, versionStart).trim()
    let version = versionEnd > 0 ? line.substring(versionStart, versionEnd).trim() : line.substring(versionStart).trim()
    if (version.startsWith('> ')) version = version.slice(2)
    if (version.startsWith('< ')) version = version.slice(2)
    const source = sourceStart > 0 ? line.substring(sourceStart).trim() : ''

    if (!id || !version || version === 'Unknown') continue
    if (id.startsWith('ARP\\')) continue

    apps.push({
      id,
      name: stripTrailingVersion(name) || id,
      currentVersion: version,
      availableVersion: version,
      source: source || 'winget',
      severity: 'unknown',
      selected: false,
      isUpToDate: true,
    })
  }
  return apps
}

export async function isWingetAvailable(): Promise<boolean> {
  try {
    await execFileAsync('winget', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export async function checkForUpdatesWinget(): Promise<UpdateCheckResult> {
  const available = await isWingetAvailable()
  if (!available) {
    return emptyResult(false, 'winget')
  }

  try {
    let stdout = ''
    try {
      const result = await execFileAsync(
        'winget',
        ['upgrade', '--accept-source-agreements', '--disable-interactivity'],
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      )
      stdout = result.stdout
    } catch (err: unknown) {
      const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
      if (e?.stdout) {
        stdout = e.stdout
      } else {
        return emptyResult(true, 'winget')
      }
    }

    const apps = parseWingetUpgradeOutput(stdout)

    let upToDateApps: UpdatableApp[] = []
    try {
      let listStdout = ''
      try {
        const listResult = await execFileAsync(
          'winget',
          ['list', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'],
          { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        )
        listStdout = listResult.stdout
      } catch (err: unknown) {
        const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
        if (e?.stdout) listStdout = e.stdout
      }
      if (listStdout) {
        const allApps = parseWingetListOutput(listStdout)
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
      packageManagerName: 'winget',
    }
  } catch {
    return emptyResult(true, 'winget')
  }
}

const WINGET_UPGRADE_ARGS = [
  '--accept-source-agreements',
  '--accept-package-agreements',
  '--disable-interactivity',
  '--silent',
  '--include-unknown',
]

const SUCCESS_PATTERNS = [
  'successfully installed',
  'successfully upgraded',
  'installer succeeded',
  'no available upgrade',
]

const FAILURE_PATTERNS = [
  'installer failed',
  'no package found',
  'no applicable update',
  'another version of this application',
  'installer aborted',
  'install technology is different',
]

const ELEVATION_HINTS = [
  'access is denied',
  'administrator',
  'elevation',
  'requires admin',
  'run as admin',
  '0x80070005',
  '0x80070422',
  '0x80070643',
  'negado',
  'permiss',
  'acesso',
]

async function attemptWingetUpgrade(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string; errorType?: string }> {
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }
  let upgradeStdout = ''
  let exitCode = 0
  try {
    const result = await execFileAsync('winget', ['upgrade', appId, ...WINGET_UPGRADE_ARGS, ...extraArgs], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    upgradeStdout = result.stdout
    exitCode = 0
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    if (e?.stdout) {
      upgradeStdout = e.stdout
    } else {
      return { success: false, output: e?.message || 'Unknown error' }
    }
    exitCode = Number(e?.code ?? -1)
  }

  if (exitCode === 0) {
    const output = cleanOutput(upgradeStdout).toLowerCase()
    if (FAILURE_PATTERNS.some((p) => output.includes(p))) {
      return { success: false, output: upgradeStdout }
    }
    return { success: true, output: upgradeStdout }
  }

  const output = cleanOutput(upgradeStdout).toLowerCase()

  if (exitCode === 1) {
    if (SUCCESS_PATTERNS.some((p) => output.includes(p))) {
      return { success: true, output: upgradeStdout }
    }
    return { success: false, output: upgradeStdout }
  }

  const wasSuccessful = SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = FAILURE_PATTERNS.some((p) => output.includes(p))

  if (wasSuccessful && !hasClearFailure) {
    return { success: true, output: upgradeStdout }
  }
  return { success: false, output: upgradeStdout }
}

async function attemptElevatedUpgrade(appId: string): Promise<{ success: boolean; output: string }> {
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }

  try {
    const args = ['upgrade', appId, ...WINGET_UPGRADE_ARGS, '--force'].join(' ')
    const safeArgs = args.replace(/'/g, "''")
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        psUtf8(
          `$p = Start-Process winget -ArgumentList '${safeArgs}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
        ),
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const checkResult = await execFileAsync(
      'winget',
      ['upgrade', '--accept-source-agreements', '--disable-interactivity', '--include-unknown'],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const stillNeedsUpgrade = checkResult.stdout.includes(appId)
    return {
      success: !stillNeedsUpgrade,
      output: stillNeedsUpgrade ? 'App still needs upgrade after elevated attempt' : stdout,
    }
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    return { success: false, output: e?.message || 'Elevated upgrade failed' }
  }
}

const WINGET_UPDATE_CONCURRENCY = 1

async function upgradeAppWinget(appId: string, alreadyAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  let result = await attemptWingetUpgrade(appId)

  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) || FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      result = await attemptElevatedUpgrade(appId)
    }
  }

  if (!result.success) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    if (lowerOutput.includes('install technology is different')) {
      return {
        success: false,
        error: 'Installer type changed — uninstall this app manually then install the new version',
      }
    }
  }

  if (!result.success) {
    const retryResult = await attemptWingetUpgrade(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return { success: false, error: lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine }
}

export async function runUpdatesWinget(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: UpdateResult['errors'] = []
  const alreadyAdmin = isAdmin()
  const total = appIds.length

  for (let batchStart = 0; batchStart < total; batchStart += WINGET_UPDATE_CONCURRENCY) {
    const batch = appIds.slice(batchStart, batchStart + WINGET_UPDATE_CONCURRENCY)

    for (const appId of batch) {
      onProgress({
        phase: 'updating',
        current: completed + 1,
        total,
        currentApp: appId,
        percent: Math.round((completed / total) * 100),
        status: 'in-progress',
      })
    }

    const results = await Promise.allSettled(
      batch.map((appId) => upgradeAppWinget(appId, alreadyAdmin).then((r) => ({ appId, ...r }))),
    )

    for (const settled of results) {
      completed++
      if (settled.status === 'fulfilled' && settled.value.success) {
        succeeded++
        onProgress({
          phase: 'updating',
          current: completed,
          total,
          currentApp: settled.value.appId,
          percent: Math.round((completed / total) * 100),
          status: 'done',
        })
      } else {
        failed++
        const batchIdx = results.indexOf(settled)
        const appId = settled.status === 'fulfilled' ? settled.value.appId : (batch[batchIdx] ?? 'unknown')
        const reason =
          settled.status === 'fulfilled'
            ? settled.value.error || 'Upgrade failed'
            : settled.reason?.message || 'Unknown error'
        errors.push({ appId, name: appId ?? 'unknown', reason })
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
  }

  return { succeeded, failed, errors }
}
