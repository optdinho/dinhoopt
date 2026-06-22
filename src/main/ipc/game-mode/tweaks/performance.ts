import type { GameModeSnapshot } from '@shared/types'
import { getLogger } from '../../../services/logger.service'
import { ps } from '../utils'

export async function clearStandbyMemory(): Promise<void> {
  await ps(
    `
    Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public class MemoryUtils {
        [DllImport("kernel32.dll")]
        public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, int dwMinimumWorkingSetSize, int dwMaximumWorkingSetSize);
      }
    '@
    Get-Process | ForEach-Object {
      try { [MemoryUtils]::SetProcessWorkingSetSize($_.Handle, -1, -1) } catch {}
    }
  `,
    30000,
  )
}

export async function captureTimerResolution(snapshot: GameModeSnapshot): Promise<void> {
  try {
    const out = await ps(
      `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class TimerRes {
    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern int NtSetTimerResolution(uint DesiredResolution, bool SetResolution, out uint CurrentResolution);
    [DllImport("winmm.dll")]
    public static extern uint timeGetDevCaps(ref TIMECAPS ptc, uint cbtc);
}
public struct TIMECAPS {
    public uint wPeriodMin;
    public uint wPeriodMax;
}
"@
$caps = New-Object TIMECAPS
[TimerRes]::timeGetDevCaps([ref]$caps, [System.Runtime.InteropServices.Marshal]::SizeOf($caps)) | Out-Null
$caps.wPeriodMin
`,
      15000,
    )
    const parsed = Number.parseInt(out, 10)
    snapshot.originalTimerResolution = Number.isNaN(parsed) ? null : parsed
  } catch {
    snapshot.originalTimerResolution = null
  }
}

export async function setTimerResolution(resolution100ns: number): Promise<void> {
  await ps(
    `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class TimerRes {
    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern int NtSetTimerResolution(uint DesiredResolution, bool SetResolution, out uint CurrentResolution);
}
"@
$cur = 0
[TimerRes]::NtSetTimerResolution(${resolution100ns}, $true, [ref]$cur) | Out-Null
`,
    15000,
  )
}

export async function applyTimerResolution(snapshot: GameModeSnapshot): Promise<void> {
  await captureTimerResolution(snapshot)
  await setTimerResolution(5000)
}

export async function restoreTimerResolution(originalValue: number | null): Promise<void> {
  if (originalValue === null) return
  await setTimerResolution(originalValue)
}

export async function disableNagle(snapshot: GameModeSnapshot): Promise<void> {
  const out = await ps(
    `Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' | ForEach-Object { ` +
      '  $path = $_.PSPath; ' +
      '  $noDelay = (Get-ItemProperty -Path $path -Name TcpNoDelay -ErrorAction SilentlyContinue).TcpNoDelay; ' +
      '  $ackFreq = (Get-ItemProperty -Path $path -Name TcpAckFrequency -ErrorAction SilentlyContinue).TcpAckFrequency; ' +
      '  [PSCustomObject]@{ Path=$path; TcpNoDelay=$noDelay; TcpAckFrequency=$ackFreq } ' +
      '} | ConvertTo-Json -Compress',
  )

  let interfaces: Array<{ Path?: string; TcpNoDelay?: number; TcpAckFrequency?: number }> = []
  try {
    const parsed = JSON.parse(out)
    interfaces = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return
  }

  for (const iface of interfaces) {
    if (!iface?.Path) continue
    snapshot.nagleInterfaces.push({
      path: iface.Path,
      originalTcpNoDelay: iface.TcpNoDelay ?? null,
      originalTcpAckFrequency: iface.TcpAckFrequency ?? null,
    })
  }

  await ps(
    `Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' | ForEach-Object { ` +
      '  Set-ItemProperty -Path $_.PSPath -Name TcpNoDelay -Value 1 -Type DWord -Force; ' +
      '  Set-ItemProperty -Path $_.PSPath -Name TcpAckFrequency -Value 1 -Type DWord -Force ' +
      '}',
  )
}

export async function restoreNagle(interfaces: GameModeSnapshot['nagleInterfaces']): Promise<void> {
  if (!interfaces.length) return
  const failed: string[] = []
  for (const iface of interfaces) {
    try {
      if (iface.originalTcpNoDelay !== null) {
        await ps(
          `Set-ItemProperty -Path '${iface.path}' -Name TcpNoDelay -Value ${iface.originalTcpNoDelay} -Type DWord -Force`,
        )
      } else {
        await ps(`Remove-ItemProperty -Path '${iface.path}' -Name TcpNoDelay -ErrorAction SilentlyContinue`)
      }
      if (iface.originalTcpAckFrequency !== null) {
        await ps(
          `Set-ItemProperty -Path '${iface.path}' -Name TcpAckFrequency -Value ${iface.originalTcpAckFrequency} -Type DWord -Force`,
        )
      } else {
        await ps(`Remove-ItemProperty -Path '${iface.path}' -Name TcpAckFrequency -ErrorAction SilentlyContinue`)
      }
    } catch (err: unknown) {
      failed.push(err instanceof Error ? err.message : 'unknown')
    }
  }
  if (failed.length > 0) {
    getLogger().error('game-mode', `Failed to restore ${failed.length} Nagle network interface(s)`)
    throw new Error(`Failed to restore ${failed.length} network interface(s)`)
  }
}
