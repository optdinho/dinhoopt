// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptureBorderPermissionCard } from './CaptureBorderPermissionCard'

const { ipc } = vi.hoisted(() => ({
  ipc: { get: vi.fn(), set: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  ipc.get.mockResolvedValue({ enabled: true, global: true, desktopApps: true })
  ipc.set.mockResolvedValue({ success: true })
  Object.defineProperty(window, 'dinho', {
    configurable: true,
    value: { captureBorderGet: ipc.get, captureBorderSet: ipc.set },
  })
})

describe('CaptureBorderPermissionCard', () => {
  it('reflects the enabled state returned by IPC', async () => {
    render(<CaptureBorderPermissionCard />)
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))
  })

  it('keeps the switch disabled while the status is loading', () => {
    ipc.get.mockReturnValue(new Promise(() => undefined))
    render(<CaptureBorderPermissionCard />)
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
  })

  it('writes false when the user turns the permission off', async () => {
    render(<CaptureBorderPermissionCard />)
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })

    expect(ipc.set).toHaveBeenCalledWith(false)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('rolls back the optimistic state when the write fails', async () => {
    ipc.set.mockResolvedValue({ success: false, error: 'reg add failed' })
    render(<CaptureBorderPermissionCard />)
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })

    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))
    expect(toast.error).toHaveBeenCalled()
  })

  it('renders a disabled switch when the preload bridge is unavailable', async () => {
    Object.defineProperty(window, 'dinho', { configurable: true, value: undefined })
    render(<CaptureBorderPermissionCard />)
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'))
  })
})
