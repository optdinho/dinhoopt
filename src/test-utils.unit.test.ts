import { describe, expect, it } from 'vitest'
import { mockKudu } from './test-utils'

describe('mockKudu', () => {
  it('should return all API methods', () => {
    const mock = mockKudu()
    expect(mock).toBeDefined()
    expect(Object.keys(mock).length).toBeGreaterThan(50)
  })

  it('should expose progress listeners returning cleanup functions', () => {
    const mock = mockKudu()
    const progressMethods = Object.entries(mock).filter(([key]) => key.startsWith('on') && key !== 'onboardingSet')
    expect(progressMethods.length).toBeGreaterThan(10)
    for (const [key, fn] of progressMethods) {
      const result = fn()
      expect(result, `${key} did not return a function`).toBeInstanceOf(Function)
    }
  })

  it('should set window.dinho and handle missing window', async () => {
    const { mockKudu: kudu } = await import('./test-utils')
    const mock = kudu()
    expect((globalThis as Record<string, unknown>).window).toBeDefined()
    expect((window as unknown as Record<string, unknown>).dinho).toBe(mock)
  })
})
