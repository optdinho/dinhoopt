// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'
import { REPAIR_REMINDER_INTERVAL_MS, useRepairReminder } from './useRepairReminder'

const STORAGE_KEY = 'dinho:repair-reminder-last-shown'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('useRepairReminder', () => {
  it('warns the first time the app runs after install', () => {
    renderHook(() => useRepairReminder())
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('records the moment it warned so the next run is quiet', () => {
    renderHook(() => useRepairReminder())
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()
  })

  it('stays silent on the next launch inside the 15 day window', () => {
    localStorage.setItem(STORAGE_KEY, new Date(Date.now() - 3 * 86400000).toISOString())
    renderHook(() => useRepairReminder())
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('warns again once 15 days have elapsed', () => {
    localStorage.setItem(STORAGE_KEY, new Date(Date.now() - REPAIR_REMINDER_INTERVAL_MS - 60000).toISOString())
    renderHook(() => useRepairReminder())
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('refreshes the timestamp when it warns', () => {
    const old = new Date(Date.now() - REPAIR_REMINDER_INTERVAL_MS - 60000).toISOString()
    localStorage.setItem(STORAGE_KEY, old)
    renderHook(() => useRepairReminder())
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe(old)
  })

  it('ignores a corrupt timestamp instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-date')
    expect(() => renderHook(() => useRepairReminder())).not.toThrow()
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('does not warn twice if the effect re-runs', () => {
    const { rerender } = renderHook(() => useRepairReminder())
    rerender()
    rerender()
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('warns only once per app session even across re-renders', () => {
    renderHook(() => useRepairReminder())
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })
})
