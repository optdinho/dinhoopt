import { describe, expect, it } from 'vitest'
import {
  getDomainSeverity,
  isHighImpactDomain,
  isProtectedDomain,
  PROTECTED_DOMAINS,
  searchProtectedDomains,
} from './protected-domains'

describe('PROTECTED_DOMAINS', () => {
  it('has 106 entries', () => {
    expect(PROTECTED_DOMAINS).toHaveLength(106)
  })

  it('all domains are unique (no duplicates)', () => {
    const domains = PROTECTED_DOMAINS.map((pd) => pd.domain)
    const unique = new Set(domains)
    expect(unique.size).toBe(domains.length)
  })

  it('all domains have valid format (no protocol prefix)', () => {
    for (const pd of PROTECTED_DOMAINS) {
      expect(pd.domain).not.toMatch(/^https?:\/\//)
      expect(pd.domain).not.toMatch(/^\/\//)
      expect(pd.domain).toBe(pd.domain.trim())
      expect(pd.domain.length).toBeGreaterThan(0)
    }
  })

  it('all categories are represented', () => {
    const categories = new Set(PROTECTED_DOMAINS.map((pd) => pd.category))
    expect(categories.has('microsoft-update')).toBe(true)
    expect(categories.has('microsoft-telemetry')).toBe(true)
    expect(categories.has('microsoft-security')).toBe(true)
    expect(categories.has('microsoft-identity')).toBe(true)
    expect(categories.has('microsoft-office')).toBe(true)
    expect(categories.has('microsoft-azure')).toBe(true)
    expect(categories.has('antivirus')).toBe(true)
    expect(categories.has('security')).toBe(true)
    expect(categories.has('financial')).toBe(true)
    expect(categories.has('government')).toBe(true)
    expect(categories.has('social-engineering')).toBe(true)
    expect(categories.has('c2-common')).toBe(true)
    expect(categories.size).toBe(12)
  })
})

describe('isProtectedDomain', () => {
  it('returns true for a known domain', () => {
    expect(isProtectedDomain('update.microsoft.com')).toBe(true)
  })

  it('returns true for subdomain of wildcard domain', () => {
    expect(isProtectedDomain('sub.update.microsoft.com')).toBe(true)
    expect(isProtectedDomain('foo.bar.update.microsoft.com')).toBe(true)
  })

  it('returns true for exact match of non-wildcard domain', () => {
    expect(isProtectedDomain('download.windowsupdate.com')).toBe(true)
  })

  it('returns false for subdomain of non-wildcard domain', () => {
    expect(isProtectedDomain('sub.nvd.nist.gov')).toBe(false)
  })

  it('returns false for unknown domain', () => {
    expect(isProtectedDomain('evil-malware-site.ru')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(isProtectedDomain('UPDATE.MICROSOFT.COM')).toBe(true)
    expect(isProtectedDomain('Update.Microsoft.Com')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isProtectedDomain('')).toBe(false)
  })

  it('handles domain with port number', () => {
    expect(isProtectedDomain('update.microsoft.com:8080')).toBe(false)
  })
})

describe('searchProtectedDomains', () => {
  it('finds results by domain name', () => {
    const results = searchProtectedDomains('chase')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.domain === 'chase.com')).toBe(true)
  })

  it('finds results by category', () => {
    const results = searchProtectedDomains('financial')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.category === 'financial')).toBe(true)
  })

  it('finds results by description', () => {
    const results = searchProtectedDomains('Windows Update')
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns empty array for no match', () => {
    expect(searchProtectedDomains('zzzzzznotreal')).toEqual([])
  })

  it('is case insensitive', () => {
    const results = searchProtectedDomains('MICROSOFT')
    expect(results.length).toBeGreaterThan(0)
  })
})

describe('isHighImpactDomain', () => {
  it('returns true for microsoft-update domains', () => {
    expect(isHighImpactDomain('update.microsoft.com')).toBe(true)
    expect(isHighImpactDomain('windowsupdate.com')).toBe(true)
  })

  it('returns true for wildcard subdomain of high-impact', () => {
    expect(isHighImpactDomain('sub.update.microsoft.com')).toBe(true)
  })

  it('returns true for microsoft-identity domains', () => {
    expect(isHighImpactDomain('login.microsoftonline.com')).toBe(true)
  })

  it('returns true for microsoft-office domains', () => {
    expect(isHighImpactDomain('office.com')).toBe(true)
  })

  it('returns true for microsoft-azure domains', () => {
    expect(isHighImpactDomain('azure.com')).toBe(true)
  })

  it('returns false for C2-common domains', () => {
    expect(isHighImpactDomain('pastebin.com')).toBe(false)
    expect(isHighImpactDomain('bit.ly')).toBe(false)
  })

  it('returns false for financial domains', () => {
    expect(isHighImpactDomain('paypal.com')).toBe(false)
  })

  it('returns false for unknown domain', () => {
    expect(isHighImpactDomain('evil.com')).toBe(false)
  })
})

describe('getDomainSeverity', () => {
  it('returns critical for domain not in the list', () => {
    expect(getDomainSeverity('unknown-example.com')).toBe('critical')
  })

  it('returns critical for financial domains (exact match)', () => {
    expect(getDomainSeverity('paypal.com')).toBe('critical')
  })

  it('returns critical for government domains (exact match)', () => {
    expect(getDomainSeverity('usa.gov')).toBe('critical')
  })

  it('returns critical for financial wildcard subdomains', () => {
    expect(getDomainSeverity('sub.paypal.com')).toBe('critical')
  })

  it('returns high for microsoft-update domains', () => {
    expect(getDomainSeverity('update.microsoft.com')).toBe('high')
  })

  it('returns high for microsoft-update wildcard subdomains', () => {
    expect(getDomainSeverity('sub.update.microsoft.com')).toBe('high')
  })

  it('returns medium for c2-common domains', () => {
    expect(getDomainSeverity('pastebin.com')).toBe('medium')
  })

  it('returns critical for other matched categories (e.g. telemetry)', () => {
    expect(getDomainSeverity('vortex.data.microsoft.com')).toBe('critical')
  })

  it('returns critical for antivirus category', () => {
    expect(getDomainSeverity('www.symantec.com')).toBe('critical')
  })

  it('is case insensitive', () => {
    expect(getDomainSeverity('UPDATE.MICROSOFT.COM')).toBe('high')
    expect(getDomainSeverity('PayPal.Com')).toBe('critical')
  })

  it('does not match subdomain for non-wildcard domain', () => {
    expect(getDomainSeverity('unknown.pastebin.com')).toBe('critical')
  })
})
