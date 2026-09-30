export interface CurrentDns {
  primary: string | null
  secondary: string | null
  source: 'dhcp' | 'manual' | 'none'
}

export const CURRENT_DNS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$idx = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object -Property RouteMetric | Select-Object -First 1).InterfaceIndex",
  "if ($null -eq $idx) { $idx = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1).InterfaceIndex }",
  '$cfg = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4)',
  '$addr = @($cfg[0].ServerAddresses)',
  '$dhcp = (Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4).Dhcp',
  "Write-Output ('PRIMARY=' + $(if ($addr.Count -ge 1) { $addr[0] } else { '' }))",
  "Write-Output ('SECONDARY=' + $(if ($addr.Count -ge 2) { $addr[1] } else { '' }))",
  "Write-Output ('DHCP=' + $(if ($dhcp -eq 'Enabled') { 'Enabled' } else { 'Disabled' }))",
].join('; ')

export function parseCurrentDns(stdout: string): CurrentDns {
  let primary: string | null = null
  let secondary: string | null = null
  let dhcp = false
  for (const raw of String(stdout).split(/\r?\n/)) {
    const line = raw.trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toUpperCase()
    const value = line.slice(eq + 1).trim()
    if (key === 'PRIMARY') primary = value === '' ? null : value
    else if (key === 'SECONDARY') secondary = value === '' ? null : value
    else if (key === 'DHCP') dhcp = value.toLowerCase() === 'enabled'
  }
  if (primary === null) return { primary: null, secondary: null, source: 'none' }
  return { primary, secondary, source: dhcp ? 'dhcp' : 'manual' }
}
