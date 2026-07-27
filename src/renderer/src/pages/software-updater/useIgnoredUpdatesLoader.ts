import { useEffect } from 'react'
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
      .catch(() => {})
      .finally(() => {
        const s = useUpdaterStore.getState()
        if (!s.hasChecked && !s.loading) onAutoCheck()
      })
  }, [])
}
