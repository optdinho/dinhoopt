import { useEffect } from 'react'
import logger from '@/lib/renderer-logger'
import { useUpdaterStore } from '@/stores/updater-store'

export function useInitialLoader(onAutoCheck: () => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    window.dinho
      .settingsGet()
      .then((settings) => {
        if (settings.ignoredSoftwareUpdates?.length) {
          useUpdaterStore.getState().loadIgnoredIds(settings.ignoredSoftwareUpdates)
        }
      })
      .catch((err) => {
        logger.error('SoftwareUpdater', 'Failed to load ignored updates', err)
      })
      .finally(() => {
        const s = useUpdaterStore.getState()
        if (!s.hasChecked && !s.loading) onAutoCheck()
      })
  }, [])
}
