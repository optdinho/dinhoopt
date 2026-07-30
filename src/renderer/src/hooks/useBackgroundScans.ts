import { useEffect, useRef } from 'react'
import logger from '@/lib/renderer-logger'
import { useDriverStore } from '@/stores/driver-store'
import { useUpdaterStore } from '@/stores/updater-store'

/**
 * Runs software-update and driver-update scans silently in the background
 * on first app launch. Populates stores so badge counts appear in the sidebar.
 *
 * Both scans are deferred by 8 seconds so the UI can render and settle before
 * heavy PowerShell/WMI operations start.
 */
export function useBackgroundScans(): void {
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    // Software update check (silent — no toasts)
    // Load ignored IDs first so setApps() can partition correctly
    const runSoftwareCheck = async () => {
      logger.info(
        'useBackgroundScans',
        'Starting background software update check (winget/choco/scoop via PowerShell)...',
      )
      try {
        const settings = await window.dinho.settingsGet()
        if (settings.ignoredSoftwareUpdates?.length) {
          useUpdaterStore.getState().loadIgnoredIds(settings.ignoredSoftwareUpdates)
        }
      } catch {
        /* best-effort */
      }

      const store = useUpdaterStore.getState()
      if (store.hasChecked || store.loading) return
      store.setLoading(true)
      try {
        const result = await window.dinho.softwareUpdateCheck()
        const s = useUpdaterStore.getState()
        s.setApps(result.apps)
        s.setPackageManagerAvailable(result.packageManagerAvailable)
        s.setPackageManagerName(result.packageManagerName)
        s.setHasChecked(true)
        logger.info(
          'useBackgroundScans',
          `Software update check complete — ${result.apps.length} apps, manager=${result.packageManagerName}`,
        )
      } catch {
        // Silent — don't set error so the page still shows its initial state
        logger.warn('useBackgroundScans', 'Software update check failed (silent)')
      } finally {
        useUpdaterStore.getState().setLoading(false)
      }
    }

    // Driver update scan only (we skip the stale-packages scan since it's heavier
    // and less relevant for the badge — the badge shows available driver *updates*)
    const runDriverUpdateScan = async () => {
      logger.info('useBackgroundScans', 'Starting background driver update scan (PowerShell/WMI)...')
      const store = useDriverStore.getState()
      if (store.hasScanned || store.updateScanning) return
      store.setUpdateScanning(true)
      try {
        const result = await window.dinho.driverUpdateScan()
        useDriverStore.getState().setUpdates(result.updates)
        logger.info('useBackgroundScans', `Driver update scan complete — ${result.updates?.length ?? 0} updates found`)
      } catch {
        // Silent
        logger.warn('useBackgroundScans', 'Driver update scan failed (silent)')
      } finally {
        const s = useDriverStore.getState()
        s.setUpdateScanning(false)
        s.setUpdateProgress(null)
      }
    }

    // Defer both by 8 s so the UI can render first
    logger.info('useBackgroundScans', 'Deferring background scans by 8s...')
    const timer = setTimeout(() => {
      logger.info('useBackgroundScans', '8s delay elapsed — launching background scans')
      runSoftwareCheck()
      runDriverUpdateScan()
    }, 8000)

    return () => clearTimeout(timer)
  }, [])
}
