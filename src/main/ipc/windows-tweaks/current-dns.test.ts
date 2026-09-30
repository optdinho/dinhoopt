import { describe, expect, it } from 'vitest'
import { CURRENT_DNS_SCRIPT, parseCurrentDns } from './current-dns'

describe('parseCurrentDns', () => {
  it('reads a manual DNS pair', () => {
    const out = ['PRIMARY=1.1.1.1', 'SECONDARY=1.0.0.1', 'DHCP=Disabled'].join('\r\n')
    expect(parseCurrentDns(out)).toEqual({ primary: '1.1.1.1', secondary: '1.0.0.1', source: 'manual' })
  })

  it('reads a manual DNS with only a primary', () => {
    const out = ['PRIMARY=8.8.8.8', 'SECONDARY=', 'DHCP=Disabled'].join('\r\n')
    expect(parseCurrentDns(out)).toEqual({ primary: '8.8.8.8', secondary: null, source: 'manual' })
  })

  it('marks DHCP as the source even when servers are present', () => {
    const out = ['PRIMARY=192.168.1.1', 'SECONDARY=', 'DHCP=Enabled'].join('\r\n')
    expect(parseCurrentDns(out)).toEqual({ primary: '192.168.1.1', secondary: null, source: 'dhcp' })
  })

  it('returns none when the adapter has no DNS', () => {
    const out = ['PRIMARY=', 'SECONDARY=', 'DHCP=Disabled'].join('\r\n')
    expect(parseCurrentDns(out)).toEqual({ primary: null, secondary: null, source: 'none' })
  })

  it('returns none for empty output', () => {
    expect(parseCurrentDns('')).toEqual({ primary: null, secondary: null, source: 'none' })
  })

  it('returns none for garbage output', () => {
    expect(parseCurrentDns('Get-NetRoute : não reconhecido')).toEqual({
      primary: null,
      secondary: null,
      source: 'none',
    })
  })

  it('tolerates extra noise and locale-independent tokens', () => {
    const out = ['AVISO: qualquer coisa', 'PRIMARY=9.9.9.9', 'SECONDARY=149.112.112.112', 'DHCP=Disabled'].join('\n')
    expect(parseCurrentDns(out)).toEqual({
      primary: '9.9.9.9',
      secondary: '149.112.112.112',
      source: 'manual',
    })
  })

  it('ignores DHCP on a case-insensitive match', () => {
    expect(parseCurrentDns('PRIMARY=1.1.1.1\r\nDHCP=enabled').source).toBe('dhcp')
  })
})

describe('CURRENT_DNS_SCRIPT', () => {
  it('follows the default route so it reads the interface actually in use', () => {
    expect(CURRENT_DNS_SCRIPT).toContain('0.0.0.0/0')
    expect(CURRENT_DNS_SCRIPT).toContain('Get-DnsClientServerAddress')
  })

  it('emits our own tokens instead of parsing localized labels', () => {
    expect(CURRENT_DNS_SCRIPT).toContain('PRIMARY=')
    expect(CURRENT_DNS_SCRIPT).toContain('SECONDARY=')
    expect(CURRENT_DNS_SCRIPT).toContain('DHCP=')
  })
})
