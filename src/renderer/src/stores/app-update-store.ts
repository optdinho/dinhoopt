import type { UpdateStatus } from '@shared/types'
import { create } from 'zustand'

interface AppUpdateStore {
  status: UpdateStatus
  setStatus: (status: UpdateStatus) => void
  init: () => () => void
}

export const useAppUpdateStore = create<AppUpdateStore>((set) => ({
  status: { state: 'idle' },
  setStatus: (status) => set({ status }),
  init: () => {
    // Fetch current status
    window.dinho
      ?.updaterGetStatus?.()
      .then((s) => set({ status: s }))
      .catch(() => {})
    // Listen for live updates
    const unsub = window.dinho?.onUpdaterStatus?.((s) => set({ status: s }))
    return () => unsub?.()
  },
}))
