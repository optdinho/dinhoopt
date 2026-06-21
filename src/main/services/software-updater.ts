import type { UpdatableApp, UpdateCheckResult, UpdateProgress, UpdateResult, UpdateSeverity } from '@shared/types'
import { isAdmin } from './elevation'
import { execFileAsync, psUtf8 } from './exec-utf8'
import { getSettings } from './settings-store'

export function cleanOutput(str: string): string {
  // Strip ANSI escape sequences
  // biome-ignore lint/suspicious/noControlCharactersInRegex: security-critical — strips ANSI escape codes
  let cleaned = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/gu, '')
  // Handle \r (carriage return) used by spinners: for each line segment,
  // keep only the text after the last \r (since \r overwrites from the start).
  // Lines ending with \r\n produce a trailing empty part after split — use
  // the last non-empty part instead.
  cleaned = cleaned
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i] ?? ''
        if (part.trim()) return part
      }
      return ''
    })
    .join('\n')
  return cleaned
}

export function computeSeverity(current: string, available: string): UpdateSeverity {
  const parse = (v: string): [number, number, number] | null => {
    const m = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
    if (!m) return null
    return [Number.parseInt(m[1] ?? '0'), Number.parseInt(m[2] ?? '0'), Number.parseInt(m[3] ?? '0')]
  }

  const c = parse(current)
  const a = parse(available)
  if (!c || !a) return 'unknown'

  if (a[0] > c[0]) return 'major'
  if (a[0] === c[0] && a[1] > c[1]) return 'minor'
  if (a[0] === c[0] && a[1] === c[1] && a[2] > c[2]) return 'patch'
  return 'unknown'
}

function emptyResult(
  packageManagerAvailable: boolean,
  packageManagerName: UpdateCheckResult['packageManagerName'],
): UpdateCheckResult {
  return {
    apps: [],
    totalCount: 0,
    majorCount: 0,
    minorCount: 0,
    patchCount: 0,
    packageManagerAvailable,
    packageManagerName,
  }
}

/**
 * Strip a trailing version-like suffix from a display name.
 * Winget display names often include the installed version
 * (e.g. "HandBrake 1.11.0") because that is how the app registers in ARP.
 */
export function stripTrailingVersion(name: string): string {
  return name.replace(/\s+v?\d+[\d.]*\s*$/, '').trim()
}

// ─── Winget (Windows) ───────────────────────────────────────

export function parseWingetUpgradeOutput(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  // Find the header line
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

  // Separator line (dashes) is right after header
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
    // Stop at summary line like "42 upgrades available."
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
    // When winget reports "< X" for the installed version and X matches the
    // available version, it cannot determine the real version — the app is
    // likely already up to date, so skip it.
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

  // Find header — winget list has: Name  Id  Version  Available  Source
  // (Available column may be empty for most apps)
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
  // Available and Source columns may or may not exist in winget list
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
    // winget list sometimes prefixes versions with "> " or "< " — strip them
    if (version.startsWith('> ')) version = version.slice(2)
    if (version.startsWith('< ')) version = version.slice(2)
    const source = sourceStart > 0 ? line.substring(sourceStart).trim() : ''

    if (!id || !version || version === 'Unknown') continue
    // Skip ARP entries (not real winget packages)
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

async function isWingetAvailable(): Promise<boolean> {
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

async function checkForUpdatesWinget(): Promise<UpdateCheckResult> {
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
      // winget may exit with non-zero code even on success (e.g. 0x8A150014 = no updates)
      // but still produce valid output in stdout
      if (e?.stdout) {
        stdout = e.stdout
      } else {
        return emptyResult(true, 'winget')
      }
    }

    const apps = parseWingetUpgradeOutput(stdout)

    // Also get the full list of winget-tracked apps to show "up to date" ones
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
  '0x80070005', // E_ACCESSDENIED
  '0x80070422', // ERROR_SERVICE_DISABLED
  '0x80070643', // ERROR_INSTALL_FAILURE
  'negado',
  'permiss',
  'acesso',
]

/** Attempt a single winget upgrade and return {success, output} */
async function attemptWingetUpgrade(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string; errorType?: string }> {
  // Validate appId format to prevent argument injection (e.g. --source flags)
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

  // Exit code 0 → primary success indicator (locale-independent)
  if (exitCode === 0) {
    const output = cleanOutput(upgradeStdout).toLowerCase()
    if (FAILURE_PATTERNS.some((p) => output.includes(p))) {
      return { success: false, output: upgradeStdout }
    }
    return { success: true, output: upgradeStdout }
  }

  const output = cleanOutput(upgradeStdout).toLowerCase()

  // Exit code 1 → "no applicable update" or "no package found"
  // Check output for success patterns as safety net
  if (exitCode === 1) {
    if (SUCCESS_PATTERNS.some((p) => output.includes(p))) {
      return { success: true, output: upgradeStdout }
    }
    return { success: false, output: upgradeStdout }
  }

  // Other exit codes → real failure — fall back to pattern matching
  const wasSuccessful = SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = FAILURE_PATTERNS.some((p) => output.includes(p))

  if (wasSuccessful && !hasClearFailure) {
    return { success: true, output: upgradeStdout }
  }
  return { success: false, output: upgradeStdout }
}

/** Retry a failed upgrade with elevation using PowerShell Start-Process -Verb RunAs */
async function attemptElevatedUpgrade(appId: string): Promise<{ success: boolean; output: string }> {
  // Validate appId format to prevent injection — winget IDs are alphanumeric with dots, dashes, underscores
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }

  try {
    const args = ['upgrade', appId, ...WINGET_UPGRADE_ARGS, '--force'].join(' ')
    // Escape single quotes for PowerShell single-quoted string ('' is the escape for ')
    const safeArgs = args.replace(/'/g, "''")
    // Run winget elevated via Start-Process; -Wait blocks until done, -PassThru gives exit code
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
    // We can't reliably capture stdout from the elevated process, so verify
    // by checking if winget still lists this app as upgradeable
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
    // UAC was likely denied by user
    return { success: false, output: e?.message || 'Elevated upgrade failed' }
  }
}

/** Concurrency limit for parallel winget upgrades — sequential to avoid winget lock contention */
const WINGET_UPDATE_CONCURRENCY = 1

/** Run a single app through the winget upgrade pipeline: normal → elevated → force */
async function upgradeAppWinget(appId: string, alreadyAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  // First attempt: normal upgrade
  let result = await attemptWingetUpgrade(appId)

  // If failed and not already admin, retry with elevation
  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) || FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      result = await attemptElevatedUpgrade(appId)
    }
  }

  // If installer technology changed, skip retries — user must manually uninstall + reinstall
  if (!result.success) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    if (lowerOutput.includes('install technology is different')) {
      return {
        success: false,
        error: 'Installer type changed — uninstall this app manually then install the new version',
      }
    }
  }

  // If still failed, retry once with --force (handles version mismatch issues)
  if (!result.success) {
    const retryResult = await attemptWingetUpgrade(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return { success: false, error: lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine }
}

async function runUpdatesWinget(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: UpdateResult['errors'] = []
  const alreadyAdmin = isAdmin()
  const total = appIds.length

  // Process in concurrent batches
  for (let batchStart = 0; batchStart < total; batchStart += WINGET_UPDATE_CONCURRENCY) {
    const batch = appIds.slice(batchStart, batchStart + WINGET_UPDATE_CONCURRENCY)

    // Report all in-progress
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

// ─── Chocolatey (Windows) ──────────────────────────────────

/** Chocolatey package ID: alphanumeric, dots, hyphens, underscores */
const CHOCO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/

async function isChocoAvailable(): Promise<boolean> {
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

/**
 * Parse `choco outdated --limit-output` output.
 * Format: packageId|currentVersion|availableVersion|pinned
 */
export function parseChocoOutdatedOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of cleanOutput(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('|')
    if (parts.length < 4) continue
    const [id, currentVersion, availableVersion, pinned] = parts
    if (!id || !currentVersion || !availableVersion) continue
    // Skip pinned packages
    if (pinned?.trim().toLowerCase() === 'true') continue
    // Skip if versions match (already up to date)
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

/**
 * Parse `choco list --limit-output` output.
 * Format: packageId|version
 */
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

async function checkForUpdatesChoco(): Promise<UpdateCheckResult> {
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

    // Get the full list of installed packages to show "up to date" ones
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

/** Attempt a single choco upgrade and return {success, output} */
async function attemptChocoUpgrade(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string }> {
  if (!CHOCO_ID_PATTERN.test(appId)) {
    return { success: false, output: 'Invalid package ID format' }
  }
  let upgradeStdout = ''
  try {
    // Note: no --limit-output here — verbose output is needed for success/failure pattern detection
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

/** Retry a failed choco upgrade with elevation using PowerShell Start-Process -Verb RunAs */
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
    // Verify by checking if choco still lists this app as outdated
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

/** Run a single app through the choco upgrade pipeline: normal → elevated → force */
async function upgradeAppChoco(appId: string, alreadyAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  // First attempt: normal upgrade
  let result = await attemptChocoUpgrade(appId)

  // If failed and not already admin, check for elevation hints before prompting
  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      CHOCO_ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) ||
      CHOCO_FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      result = await attemptElevatedChocoUpgrade(appId)
    }
  }

  // If still failed, retry once with --force (handles version mismatch issues)
  if (!result.success) {
    const retryResult = await attemptChocoUpgrade(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return { success: false, error: lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine }
}

async function runUpdatesChoco(
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

// ─── Scoop (Windows) ──────────────────────────────────────

/** Scoop package name: lowercase alphanumeric, hyphens, dots */
const SCOOP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,200}$/

async function isScoopAvailable(): Promise<boolean> {
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

/**
 * Parse `scoop status` output.
 *
 * Typical output (tab-aligned columns):
 * ```
 * Scoop is up to date.
 *
 * Updates are available for:
 * Main:
 *     Name            Installed  Available  Requested
 *     googlechrome    126.0.6478.57  127.0.6533.72  Latest
 *     7zip           24.07      24.08      Latest
 * ```
 */
export function parseScoopStatusOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  const lines = cleanOutput(stdout).split(/\r?\n/)
  let inTable = false
  for (const line of lines) {
    // Detect table header
    if (/^\s+Name\s+Installed\s+Available/i.test(line)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    // Skip separator lines and blank lines
    if (!line.trim() || /^[\s\-_]+$/.test(line)) continue
    // Stop at next section
    if (/^\S/.test(line.trim()) && !line.startsWith(' ')) {
      inTable = false
      continue
    }
    const parts = line.trim().split(/\s{2,}/)
    if (parts.length < 3) continue
    const [name, installed, available] = parts
    if (!name || !installed || !available || available === '-') continue
    // Skip if versions match (up to date within Scoop)
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

/**
 * Parse `scoop list` output.
 * Format: Installed apps in Scoop with versions.
 */
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

async function checkForUpdatesScoop(): Promise<UpdateCheckResult> {
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

    // Get the full list of installed scoop packages
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

/** Attempt a single scoop update with optional extra CLI args */
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

/** Run a single app through the scoop upgrade pipeline: normal → --global → --force */
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

async function runUpdatesScoop(
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

// ─── Windows: dispatcher ───────────────────────────────────

async function checkForUpdatesWindows(): Promise<UpdateCheckResult> {
  // Run all 3 managers in parallel and merge results
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

  // Merge all apps, deduplicating by ID (first source wins)
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
  // If the caller tells us which manager produced these IDs, use it directly
  if (source === 'choco') return runUpdatesChoco(appIds, onProgress)
  if (source === 'winget') return runUpdatesWinget(appIds, onProgress)
  if (source === 'scoop') return runUpdatesScoop(appIds, onProgress)

  // Fallback: use the setting preference with availability check
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

  // No manager available — report per-app failures
  return {
    succeeded: 0,
    failed: appIds.length,
    errors: appIds.map((id) => ({ appId: id, name: id, reason: 'No package manager available' })),
  }
}





// ─── Platform-dispatched exports ────────────────────────────

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

/** Validate an app ID for the current platform's package manager */
export function isValidAppId(id: string): boolean {
  return /^[\w][\w.\-]{0,200}$/.test(id)
}
