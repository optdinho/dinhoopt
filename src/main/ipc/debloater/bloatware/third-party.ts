import type { BloatwareApp } from '@shared/types'
import { OEM_BLOATWARE } from './oem-bloatware'
import { PROMOTED_APPS } from './promoted-apps'

export const THIRD_PARTY_BLOATWARE: Omit<BloatwareApp, 'id' | 'size' | 'selected'>[] = [
  ...OEM_BLOATWARE,
  ...PROMOTED_APPS,
]
