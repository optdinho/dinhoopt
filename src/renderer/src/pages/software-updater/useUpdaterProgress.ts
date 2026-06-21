import { useUpdaterStore } from '@/stores/updater-store'
import type { UpdateProgress } from '@shared/types'
import { useEffect } from 'react'

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
