import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('env-sanitize', () => {
  const SENSITIVE_VARS = ['LICENSE_API_TOKEN', 'GH_TOKEN', 'NODE_AUTH_TOKEN']

  let sanitizeEnvVars: () => void
  let getSecret: (key: string) => string | undefined

  beforeEach(async () => {
    vi.resetModules()
    for (const key of SENSITIVE_VARS) {
      delete process.env[key]
    }
    const mod = await import('./env-sanitize')
    sanitizeEnvVars = mod.sanitizeEnvVars
    getSecret = mod.getSecret
  })

  it('removes all sensitive vars from process.env when present', () => {
    process.env.LICENSE_API_TOKEN = 'lic-123'
    process.env.GH_TOKEN = 'gh-abc'
    process.env.NODE_AUTH_TOKEN = 'npm-token'
    sanitizeEnvVars()
    expect(process.env.LICENSE_API_TOKEN).toBeUndefined()
    expect(process.env.GH_TOKEN).toBeUndefined()
    expect(process.env.NODE_AUTH_TOKEN).toBeUndefined()
  })

  it('stores removed secrets so they remain retrievable via getSecret', () => {
    process.env.LICENSE_API_TOKEN = 'lic-123'
    process.env.GH_TOKEN = 'gh-abc'
    sanitizeEnvVars()
    expect(getSecret('LICENSE_API_TOKEN')).toBe('lic-123')
    expect(getSecret('GH_TOKEN')).toBe('gh-abc')
  })

  it('does not touch unset sensitive vars', () => {
    sanitizeEnvVars()
    expect(getSecret('LICENSE_API_TOKEN')).toBeUndefined()
    expect(getSecret('GH_TOKEN')).toBeUndefined()
    expect(getSecret('NODE_AUTH_TOKEN')).toBeUndefined()
  })

  it('leaves non-sensitive env vars untouched', () => {
    process.env.ELEVATED = '1'
    process.env.USERPROFILE = 'C:\\Users\\x'
    sanitizeEnvVars()
    expect(process.env.ELEVATED).toBe('1')
    expect(process.env.USERPROFILE).toBe('C:\\Users\\x')
  })

  it('returns undefined for unknown keys', () => {
    sanitizeEnvVars()
    expect(getSecret('SOME_OTHER_KEY')).toBeUndefined()
  })

  it('can run twice without losing already-captured secrets', () => {
    process.env.LICENSE_API_TOKEN = 'lic-123'
    sanitizeEnvVars()
    sanitizeEnvVars()
    expect(getSecret('LICENSE_API_TOKEN')).toBe('lic-123')
  })
})
