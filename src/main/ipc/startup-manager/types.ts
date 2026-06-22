import type { StartupItem } from '@shared/types'

export interface DisabledEntry {
  name: string
  command: string
  location: string
  source: StartupItem['source']
}
