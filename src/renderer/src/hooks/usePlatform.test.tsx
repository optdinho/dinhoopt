import type { PlatformInfo } from '@shared/types'
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformContext, usePlatform, usePlatformLoader } from './usePlatform'

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

describe('usePlatform', () => {
  it('returns context value from provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlatformContext.Provider value={defaultInfo}>{children}</PlatformContext.Provider>
    )

    const { result } = renderHook(() => usePlatform(), { wrapper })

    expect(result.current).toEqual(defaultInfo)
  })

  it('returns default info outside provider', () => {
    const { result } = renderHook(() => usePlatform())

    expect(result.current).toEqual(defaultInfo)
  })
})

describe('usePlatformLoader', () => {
  beforeEach(() => {
    window.dinho = {
      platformInfo: vi.fn<() => Promise<PlatformInfo>>().mockResolvedValue(defaultInfo),
    } as unknown as Window['dinho']
  })

  it('returns default info initially before promise resolves', async () => {
    const { result } = renderHook(() => usePlatformLoader())

    // Asserted synchronously, while platformInfo() is still pending.
    expect(result.current).toEqual(defaultInfo)

    // Then let the promise settle inside act, so its setState is not an
    // act() warning. The value is intentionally not re-asserted.
    await act(async () => {})
  })

  it('calls platformInfo on mount and updates info', async () => {
    const customInfo: PlatformInfo = {
      platform: 'linux',
      features: {
        registry: false,
        debloater: true,
        drivers: true,
        bootTrace: false,
        gameMode: true,
        firewallAudit: true,
        contextMenu: false,
        windowsTweaks: false,
        benchmark: true,
        clips: false,
        compliance: true,
        vulnerability: true,
      },
    }

    window.dinho.platformInfo = vi.fn<() => Promise<PlatformInfo>>().mockResolvedValue(customInfo)

    const { result } = renderHook(() => usePlatformLoader())

    await waitFor(() => {
      expect(result.current).toEqual(customInfo)
    })
  })
})
