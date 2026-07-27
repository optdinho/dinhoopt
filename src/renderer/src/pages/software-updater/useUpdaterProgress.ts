import type { UpdateProgress } from '@shared/types'
import { useEffect } from 'react'
import { useUpdaterStore } from '@/stores/updater-store'

export function useUpdaterProgress() {
  useEffect(() => {
    const cleanup = window.dinho.onSoftwareUpdateProgress((data: UpdateProgress) => {
      useUpdaterStore.getState().setProgress(data)
    })
    return () => {
      cleanup()
    }
  }, [])
}
