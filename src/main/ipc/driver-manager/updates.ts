import type {
  DriverUpdate,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
  DriverUpdateScanResult,
} from '@shared/types'
import { execFileAsync, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { makeId } from './utils'

export async function scanDriverUpdates(
  onProgress?: (data: DriverUpdateProgress) => void,
): Promise<DriverUpdateScanResult> {
  const startTime = Date.now()

  getLogger().info('driver-manager', 'Starting driver update scan...')
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'Driver update scan skipped — not on Windows')
    return { updates: [], totalAvailable: 0, scanDuration: Date.now() - startTime }
  }

  onProgress?.({
    phase: 'checking',
    current: 0,
    total: 0,
    currentDevice: 'Querying Windows Update for driver updates...',
    percent: 0,
  })

  const updates: DriverUpdate[] = []

  try {
    // Use the Windows Update COM API via PowerShell to find driver updates.
    // WMI driver table is cached once before the loop for performance.
    const script = `
        $ErrorActionPreference = 'Stop'
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $criteria = "IsInstalled=0 AND Type='Driver'"
        $result = $searcher.Search($criteria)

        # Cache installed driver table once (expensive query)
        # Use Get-CimInstance (works on PS 5.1+/7+), fall back to Get-WmiObject
        $wmiDrivers = @()
        try {
          $wmiDrivers = @(Get-CimInstance Win32_PnPSignedDriver | Select-Object HardWareID, DriverVersion, DriverDate)
        } catch {
          try {
            $wmiDrivers = @(Get-WmiObject Win32_PnPSignedDriver | Select-Object HardWareID, DriverVersion, DriverDate)
          } catch {}
        }

        foreach ($update in $result.Updates) {
          $driver = $update.DriverModel
          $ver = $update.DriverVerDate
          $hwId = ''
          if ($update.DriverHardwareID) { $hwId = $update.DriverHardwareID }
          $cls = $update.DriverClass
          $provider = $update.DriverProvider
          $title = $update.Title
          $size = ''
          if ($update.MaxDownloadSize -gt 0) {
            $mb = [math]::Round($update.MaxDownloadSize / 1MB, 1)
            $size = "$mb MB"
          }
          $verStr = ''
          if ($update.DriverVerDate) {
            $verStr = $update.DriverVerDate.ToString('yyyy-MM-dd')
          }

          # Look up current installed version from cached driver data
          $currentVer = ''
          $currentDate = ''
          if ($hwId -and $wmiDrivers.Count -gt 0) {
            $installed = $wmiDrivers | Where-Object { $_.HardWareID -eq $hwId } | Select-Object -First 1
            if ($installed) {
              $currentVer = $installed.DriverVersion
              if ($installed.DriverDate) {
                try {
                  if ($installed.DriverDate -is [datetime]) {
                    $currentDate = $installed.DriverDate.ToString('yyyy-MM-dd')
                  } else {
                    $currentDate = ([Management.ManagementDateTimeConverter]::ToDateTime($installed.DriverDate)).ToString('yyyy-MM-dd')
                  }
                } catch {}
              }
            }
          }

          $wuId = $update.Identity.UpdateID
          Write-Output "DRVUPD|$($driver)|$($hwId)|$($cls)|$($currentVer)|$($currentDate)|$($wuId)|$($verStr)|$($provider)|$($title)|$($size)"
        }

        if ($result.Updates.Count -eq 0) {
          Write-Output 'DRVUPD_NONE'
        }
      `

    const { stdout } = await execFileAsync('powershell', psArgs(script), {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })

    const lines = stdout
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)

    // Pre-compute total count for progress
    const totalCount = lines.filter((l) => l.startsWith('DRVUPD|')).length

    let idx = 0
    for (const line of lines) {
      if (line === 'DRVUPD_NONE') break
      if (!line.startsWith('DRVUPD|')) continue

      const parts = line.split('|')
      if (parts.length < 11) continue

      const deviceName = parts[1] || 'Unknown Device'
      const deviceId = parts[2] || ''
      const className = parts[3] || 'Unknown'
      const currentVersion = parts[4] || ''
      const currentDate = parts[5] || ''
      const updateId = parts[6] || ''
      const availableDate = parts[7] || ''
      const provider = parts[8] || 'Unknown'
      const updateTitle = parts[9] || deviceName
      const downloadSize = parts[10] || ''

      // Extract version from the update title if available (common pattern: "vX.X.X.X")
      const versionMatch = updateTitle.match(/(\d+\.\d+\.\d+[\.\d]*)/)
      const availableVersion = versionMatch?.[1] || availableDate

      idx++
      onProgress?.({
        phase: 'checking',
        current: idx,
        total: totalCount,
        currentDevice: deviceName,
        percent: Math.round((idx / totalCount) * 100),
      })

      updates.push({
        id: makeId(updateId || deviceName, availableVersion),
        updateId,
        deviceName,
        deviceId,
        className,
        currentVersion,
        currentDate,
        availableVersion,
        availableDate,
        provider,
        updateTitle,
        downloadSize,
        selected: true,
      })
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    getLogger().error('driver-manager', `Driver update scan failed: ${e?.message || 'Unknown error'}`)
    if (e?.stderr) getLogger().error('driver-manager', `PowerShell stderr: ${e.stderr}`)
    throw new Error(e?.stderr || e?.message || 'Driver update scan failed')
  }

  getLogger().success(
    'driver-manager',
    `Driver update scan completed — ${updates.length} update(s) available in ${Date.now() - startTime}ms`,
  )
  return {
    updates,
    totalAvailable: updates.length,
    scanDuration: Date.now() - startTime,
  }
}

export async function installDriverUpdates(
  wuUpdateIds: string[],
  onProgress?: (data: DriverUpdateProgress) => void,
): Promise<DriverUpdateInstallResult> {
  getLogger().info('driver-manager', `Starting driver update install for ${wuUpdateIds.length} update(s)...`)
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'Driver update install skipped — not on Windows')
    return { installed: 0, failed: 0, rebootRequired: false, errors: [] }
  }

  let installed = 0
  let failed = 0
  let rebootRequired = false
  const errors: { deviceName: string; reason: string }[] = []

  if (wuUpdateIds.length === 0) {
    getLogger().warning('driver-manager', 'No driver update IDs provided for install')
    return { installed: 0, failed: 0, rebootRequired: false, errors: [] }
  }

  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: wuUpdateIds.length,
    currentDevice: 'Preparing driver updates...',
    percent: 0,
  })

  try {
    // Build a PS array literal of the WU UpdateIDs for exact matching
    const idsArray = wuUpdateIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')

    const script = `
          $ErrorActionPreference = 'Stop'
          $selectedIds = @(${idsArray})

          $session = New-Object -ComObject Microsoft.Update.Session
          $searcher = $session.CreateUpdateSearcher()
          $result = $searcher.Search("IsInstalled=0 AND Type='Driver'")

          $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl

          foreach ($update in $result.Updates) {
            if ($selectedIds -contains $update.Identity.UpdateID) {
              $update.AcceptEula()
              $toInstall.Add($update) | Out-Null
            }
          }

          if ($toInstall.Count -eq 0) {
            Write-Output 'RESULT|0|0|false'
            return
          }

          # Download
          $downloader = $session.CreateUpdateDownloader()
          $downloader.Updates = $toInstall
          Write-Output "STATUS|downloading|$($toInstall.Count)"
          $dlResult = $downloader.Download()

          # Install
          $installer = $session.CreateUpdateInstaller()
          $installer.Updates = $toInstall
          Write-Output "STATUS|installing|$($toInstall.Count)"
          $installResult = $installer.Install()

          $ok = 0
          $fail = 0
          $reboot = $installResult.RebootRequired

          for ($i = 0; $i -lt $toInstall.Count; $i++) {
            $r = $installResult.GetUpdateResult($i)
            $name = $toInstall.Item($i).Title
            if ($r.ResultCode -eq 2) {
              $ok++
              Write-Output "INSTALLED|$name"
            } else {
              $fail++
              Write-Output "FAILED|$name|ResultCode=$($r.ResultCode)"
            }
          }

          Write-Output "RESULT|$ok|$fail|$reboot"
        `

    const { stdout } = await execFileAsync('powershell', psArgs(script), {
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })

    const lines = stdout
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)

    for (const line of lines) {
      if (line.startsWith('STATUS|')) {
        const parts = line.split('|')
        const phase = parts[1] === 'installing' ? ('installing' as const) : ('downloading' as const)
        const total = Number.parseInt(parts[2], 10) || wuUpdateIds.length
        onProgress?.({
          phase,
          current: 0,
          total,
          currentDevice: phase === 'installing' ? 'Installing drivers...' : 'Downloading drivers...',
          percent: phase === 'installing' ? 50 : 25,
        })
      } else if (line.startsWith('INSTALLED|')) {
        installed++
        const name = line.substring('INSTALLED|'.length)
        onProgress?.({
          phase: 'installing',
          current: installed + failed,
          total: wuUpdateIds.length,
          currentDevice: name,
          percent: Math.round(((installed + failed) / wuUpdateIds.length) * 100),
        })
      } else if (line.startsWith('FAILED|')) {
        failed++
        const parts = line.split('|')
        errors.push({ deviceName: parts[1] || 'Unknown', reason: parts[2] || 'Install failed' })
      } else if (line.startsWith('RESULT|')) {
        const parts = line.split('|')
        installed = Number.parseInt(parts[1], 10) || installed
        failed = Number.parseInt(parts[2], 10) || failed
        rebootRequired = parts[3] === 'True' || parts[3] === 'true'
      }
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    const msg = e?.stderr || e?.message || 'Unknown error'
    errors.push({ deviceName: 'Windows Update', reason: msg.slice(0, 300) })
    if (installed === 0) failed = wuUpdateIds.length
  }

  const result = { installed, failed, rebootRequired, errors }
  if (result.failed > 0) {
    getLogger().error(
      'driver-manager',
      `Driver update install completed with ${result.failed} failure(s) — ${result.installed} installed, reboot: ${result.rebootRequired}`,
    )
  } else {
    getLogger().success(
      'driver-manager',
      `Driver update install completed — ${result.installed} installed, reboot: ${result.rebootRequired}`,
    )
  }
  return result
}
