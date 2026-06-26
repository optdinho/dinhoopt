import { describe, expect, it, vi } from 'vitest'

const mockCheck = vi.fn()
const mockApplicable = vi.fn()
const mockApply = vi.fn()
const mockRevert = vi.fn()

vi.mock('./helpers', () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => await promise),
}))

vi.mock('./settings', () => ({
  SETTINGS: [
    {
      id: 'test-setting',
      category: 'test',
      label: 'Test Setting',
      description: 'A test setting with dependsOn',
      check: mockCheck,
      apply: mockApply,
      revert: mockRevert,
      applicable: mockApplicable,
      dependsOn: 'other-setting',
      requiresAdmin: false,
    },
  ],
}))

describe('handlers.ts uncovered branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles check() rejection via .catch(() => false)', async () => {
    mockCheck.mockRejectedValue(new Error('check failed'))
    mockApplicable.mockResolvedValue(true)

    const { scanPrivacy } = await import('./handlers')
    const result = await scanPrivacy()

    expect(result.settings[0]!.enabled).toBe(false)
    expect(mockCheck).toHaveBeenCalled()
  })

  it('handles applicable() rejection via .catch(() => true)', async () => {
    mockCheck.mockResolvedValue(true)
    mockApplicable.mockRejectedValue(new Error('applicable failed'))

    const { scanPrivacy } = await import('./handlers')
    const result = await scanPrivacy()

    expect(result.settings[0]!.reversible).toBe(true)
    expect(mockApplicable).toHaveBeenCalled()
  })

  it('includes dependsOn in result when defined', async () => {
    mockCheck.mockResolvedValue(true)
    mockApplicable.mockResolvedValue(true)

    const { scanPrivacy } = await import('./handlers')
    const result = await scanPrivacy()

    expect(result.settings[0]!).toHaveProperty('dependsOn', 'other-setting')
  })
})
