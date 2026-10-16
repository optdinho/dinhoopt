import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { execFileAsync, psArgs } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

function emptyCleanResult(): CleanResult {
  return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
}

export function registerRecycleBinIpc(getWindow: WindowGetter): void {
  // Size captured by the last scan, used to report reclaimed space. Scoped to
  // the closure so there is no external mutation.
  let lastScannedSize = 0

  ipcMain.handle(IPC.RECYCLE_BIN_SCAN, async (event): Promise<ScanResult[]> => {
    if (!validateSender(event, getWindow())) return []
    getLogger().info('recycle-bin', 'Scanning recycle bin')

    // Windows only: the recycle bin is a shell namespace queried via COM.
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        psArgs(
          `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`,
        ),
        { windowsHide: true },
      )

      const [countStr, sizeStr] = String(stdout).trim().split('|')
      const count = Number.parseInt(countStr!, 10) || 0
      const size = Number.parseInt(sizeStr!, 10) || 0

      lastScannedSize = size

      if (count === 0) {
        getLogger().info('recycle-bin', 'Recycle bin is empty')
        return []
      }

      getLogger().success('recycle-bin', `Found ${count} items totalling ${size} bytes`)
      return [
        {
          category: CleanerType.RecycleBin,
          subcategory: 'Recycle Bin',
          items: [
            {
              id: randomUUID(),
              path: 'Recycle Bin',
              size,
              category: CleanerType.RecycleBin,
              subcategory: 'Recycle Bin',
              lastModified: Date.now(),
              selected: true,
            },
          ],
          totalSize: size,
          itemCount: count,
        },
      ]
    } catch (err) {
      getLogger().error('recycle-bin', `Windows scan failed: ${err}`)
      return []
    }
  })

  ipcMain.handle(IPC.RECYCLE_BIN_CLEAN, async (event): Promise<CleanResult> => {
    if (!validateSender(event, getWindow())) return emptyCleanResult()
    getLogger().info('recycle-bin', 'Cleaning recycle bin')

    // Windows only: SHEmptyRecycleBin empties the whole shell namespace, so
    // there is no per-item selection to honour.
    const sizeBeforeClean = lastScannedSize
    try {
      getLogger().info('recycle-bin', 'Emptying recycle bin...')
      // Flags: SHERB_NOCONFIRMATION(1) | SHERB_NOPROGRESSUI(2) | SHERB_NOSOUND(4) = 7
      await execFileAsync(
        'powershell.exe',
        psArgs(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RecycleBin { [DllImport("Shell32.dll", CharSet = CharSet.Unicode)] public static extern uint SHEmptyRecycleBin(IntPtr hwnd, string pszRootPath, uint dwFlags); }'; [RecycleBin]::SHEmptyRecycleBin([IntPtr]::Zero, $null, 7)`,
        ),
        { windowsHide: true },
      )

      // Re-scan to determine actual cleaned space
      const { stdout } = await execFileAsync(
        'powershell.exe',
        psArgs(
          `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`,
        ),
        { windowsHide: true },
      )
      const [remainingStr, afterSizeStr] = String(stdout).trim().split('|')
      const remaining = Number.parseInt(remainingStr!, 10) || 0
      const afterSize = Number.parseInt(afterSizeStr!, 10) || 0
      const actualCleaned = Math.max(0, sizeBeforeClean - afterSize)

      lastScannedSize = afterSize

      if (remaining === 0) {
        getLogger().success('recycle-bin', `Cleaned ${actualCleaned} bytes from recycle bin`)
        return { totalCleaned: actualCleaned, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
      }
      // Partial clean - some items couldn't be removed
      getLogger().warning('recycle-bin', `Partial clean: ${remaining} items remaining (may be in use)`)
      return {
        totalCleaned: actualCleaned,
        filesDeleted: 1,
        filesSkipped: remaining,
        errors: [
          { path: 'Recycle Bin', reason: `${remaining} item(s) could not be removed (may be in use or protected)` },
        ],
        needsElevation: false,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      getLogger().error('recycle-bin', `Windows clean failed: ${message}`)
      return { ...emptyCleanResult(), errors: [{ path: 'Recycle Bin', reason: message }] }
    }
  })
}
