import { isAbsolute, normalize } from 'node:path'
import type { DefenderExclusionResult, DefenderExclusionStatus } from '@shared/types'
import { execFileAsync, psEncodedArgs } from './exec-utf8'
import { getLogger } from './logger.service'

async function runPs(script: string, timeout = 20000): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', psEncodedArgs(script), {
    timeout,
    windowsHide: true,
  })
  return String(stdout).trim()
}

const INVALID_PATH_CHARS = /["'`;|&<>\r\n]/

/**
 * Only absolute drive paths are accepted. Quotes, shell metacharacters and
 * traversal segments are rejected because the path ends up in a PowerShell
 * command line; the escaping below is defence in depth, not the only barrier.
 */
export function isValidDefenderExclusionPath(input: unknown): input is string {
  if (typeof input !== 'string') return false
  const value = input.trim()
  if (value.length === 0 || value.length > 260) return false
  if (INVALID_PATH_CHARS.test(value)) return false
  if (!/^[A-Za-z]:\\/.test(value)) return false
  if (!isAbsolute(value)) return false
  if (value.split(/[\\/]/).some((part) => part === '..')) return false
  if (normalize(value).length === 0) return false
  return true
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export async function getDefenderExclusionStatus(): Promise<DefenderExclusionStatus> {
  try {
    const out = await runPs(
      `try {
  $pref = Get-MpPreference -ErrorAction Stop
  $status = Get-MpComputerStatus -ErrorAction SilentlyContinue
  $exclusions = @($pref.ExclusionPath) | Where-Object { $_ }
  [PSCustomObject]@{
    supported = $true
    tamperProtection = if ($status) { [bool]$status.IsTamperProtected } else { $null }
    exclusions = @($exclusions)
  } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{ supported = $false; tamperProtection = $null; exclusions = @() } | ConvertTo-Json -Compress
}`,
    )
    const parsed = JSON.parse(out) as {
      supported?: unknown
      tamperProtection?: unknown
      exclusions?: unknown
    }
    const rawExclusions = Array.isArray(parsed.exclusions)
      ? parsed.exclusions
      : typeof parsed.exclusions === 'string'
        ? [parsed.exclusions]
        : []
    return {
      supported: parsed.supported === true,
      tamperProtection: typeof parsed.tamperProtection === 'boolean' ? parsed.tamperProtection : null,
      exclusions: rawExclusions.filter((value): value is string => typeof value === 'string' && value.length > 0),
    }
  } catch (err) {
    getLogger().warning('defender', `Failed to read Defender exclusions: ${err}`)
    return { supported: false, tamperProtection: null, exclusions: [] }
  }
}

async function mutateExclusion(path: string, action: 'add' | 'remove'): Promise<DefenderExclusionResult> {
  if (!isValidDefenderExclusionPath(path)) {
    return { success: false, error: 'Invalid exclusion path' }
  }
  const cmdlet = action === 'add' ? 'Add-MpPreference' : 'Remove-MpPreference'
  try {
    const out = await runPs(
      `try {
  ${cmdlet} -ExclusionPath ${quote(path.trim())} -ErrorAction Stop
  'OK'
} catch {
  'ERR ' + $_.Exception.Message
}`,
    )
    if (out.startsWith('OK')) return { success: true }
    const message = out.replace(/^ERR\s*/, '').trim()
    getLogger().warning('defender', `${cmdlet} failed: ${message}`)
    return { success: false, error: message || `${cmdlet} failed` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    getLogger().error('defender', `${cmdlet} threw: ${message}`)
    return { success: false, error: message }
  }
}

export function addDefenderExclusion(path: string): Promise<DefenderExclusionResult> {
  return mutateExclusion(path, 'add')
}

export function removeDefenderExclusion(path: string): Promise<DefenderExclusionResult> {
  return mutateExclusion(path, 'remove')
}
