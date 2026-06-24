import type { PlatformInfo } from '@shared/types'
import { createContext, useContext, useEffect, useState } from 'react'

const defaultInfo: PlatformInfo = {
  platform: 'win32',
  features: {
    registry: true,
    debloater: true,
    drivers: true,
    bootTrace: true,
    gameMode: true,
    firewallAudit: true,
    contextMenu: true,
    windowsTweaks: true,
    benchmark: true,
    clips: true,
    compliance: true,
    vulnerability: true,
  },
}

const PlatformContext = createContext<PlatformInfo>(defaultInfo)

export function usePlatform(): PlatformInfo {
  return useContext(PlatformContext)
}

export function usePlatformLoader(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>(defaultInfo)
  useEffect(() => {
    window.dinho
      ?.platformInfo?.()
      .then(setInfo)
      .catch(() => {})
  }, [])
  return info
}

export { PlatformContext }
