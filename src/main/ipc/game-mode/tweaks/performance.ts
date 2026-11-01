import type { GameModeSnapshot } from '@shared/types'
import { getLogger } from '../../../services/logger.service'
import { ps } from '../utils'

export interface StandbyPurgeResult {
  purged: boolean
  availableMbBefore: number
  availableMbAfter: number
  skipped?: boolean
}

/**
 * Purges the real standby list via NtSetSystemInformation(80, 4) after enabling
 * SeProfileSingleProcessPrivilege. Refuses to run when less than 10% of RAM is
 * free: purging then would only evict pages the system still needs.
 */
export async function clearStandbyMemory(): Promise<StandbyPurgeResult> {
  const out = await ps(
    `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MemoryPurge {
  [DllImport("ntdll.dll")]
  public static extern int NtSetSystemInformation(int infoClass, ref int info, int length);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool LookupPrivilegeValue(string system, string name, out long luid);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool AdjustTokenPrivileges(IntPtr token, bool disable, ref TokenPrivileges state, int length, IntPtr previous, IntPtr returnLength);
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)]
  public struct TokenPrivileges {
    public int PrivilegeCount;
    public long Luid;
    public int Attributes;
  }
  public static int Purge() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out token)) { return -1; }
    try {
      long luid;
      if (!LookupPrivilegeValue(null, "SeProfileSingleProcessPrivilege", out luid)) { return -2; }
      TokenPrivileges state = new TokenPrivileges();
      state.PrivilegeCount = 1;
      state.Luid = luid;
      state.Attributes = 0x0002;
      if (!AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero)) { return -3; }
      int command = 4;
      return NtSetSystemInformation(80, ref command, 4);
    } finally {
      CloseHandle(token);
    }
  }
}
'@
$os = Get-CimInstance Win32_OperatingSystem
$before = [math]::Round($os.FreePhysicalMemory / 1024, 0)
$total = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
$threshold = [math]::Max(512, [int]($total * 0.10))
if ($before -lt $threshold) { "SKIP 0 $before $before"; exit 0 }
$status = [MemoryPurge]::Purge()
$after = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024, 0)
"OK $status $before $after"
exit 0`,
    30000,
  )

  const match = /^(OK|SKIP)\s+(-?\d+)\s+(\d+)\s+(\d+)/m.exec(out)
  if (!match) return { purged: false, availableMbBefore: 0, availableMbAfter: 0 }
  const kind = match[1]
  const status = Number.parseInt(match[2] ?? '1', 10)
  return {
    purged: kind === 'OK' && status === 0,
    availableMbBefore: Number.parseInt(match[3] ?? '0', 10),
    availableMbAfter: Number.parseInt(match[4] ?? '0', 10),
    skipped: kind === 'SKIP',
  }
}

export async function emptyWorkingSetForBackground(): Promise<void> {
  await ps(
    `Add-Type -TypeDefinition @'
      using System;
      using System.Runtime.InteropServices;
      public class MemoryUtils {
        [DllImport("kernel32.dll")]
        public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, int dwMinimumWorkingSetSize, int dwMaximumWorkingSetSize);
      }
'@
$bgProcs = @('OneDrive','OneDriveStandaloneUpdater','Teams','ms-teams','msedgewebview2',
  'EdgeUpdate','SkypeBackgroundHost','YourPhone','PhoneExperienceHost',
  'SecurityHealthSystray','SearchUI','SearchApp','StartMenuExperienceHost',
  'ShellExperienceHost','GameBarPresenceWriter','XboxAppServices','XboxGameOverlay')
$ok = 0
$fail = 0
foreach ($name in $bgProcs) {
  foreach ($p in (Get-Process -Name $name -ErrorAction SilentlyContinue)) {
    try { [MemoryUtils]::SetProcessWorkingSetSize($p.Handle, -1, -1) | Out-Null; $ok++ } catch { $fail++ }
  }
}
if ($ok -eq 0 -and $fail -gt 0) { exit 1 }
exit 0`,
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
