import { execTracked, psArgs } from './exec-utf8'

export interface VisibleWindow {
  className: string
  pid: number
  processName: string
}

export interface WindowClassEntry {
  windowClass: string
  displayName: string
}

export interface WindowClassMatch {
  processName: string
  displayName: string
}

/**
 * Enumerates visible top-level windows and prints `class<TAB>pid<TAB>image` per
 * line, one per window whose owning process is still running.
 *
 * The C# snippet is inlined and never interpolated, so nothing that reaches the
 * shell is user-controlled.  `Add-Type` is unavoidable: .NET exposes no cmdlet
 * for `GetClassName`.  Resolving the pid to an image name in PowerShell rather
 * than in TS keeps the parse trivial and means a window whose process has
 * already exited is never reported.
 *
 * NOTE: spawning PowerShell costs ~1.3s before any of this runs, so callers
 * must treat this as an occasional probe — never something to run on every
 * poll.  See `game-detector.ts`.
 */
const PROBE_SCRIPT = `$src = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DinhoWinProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string[] Dump() {
    var list = new System.Collections.Generic.List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == 0) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      list.Add(c + "\t" + pid);
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }
}
"@
Add-Type -TypeDefinition $src -Language CSharp
$procs = @{}
foreach ($p in Get-Process) { $procs[[int]$p.Id] = "$($p.ProcessName).exe" }
[DinhoWinProbe]::Dump() | ForEach-Object {
  $parts = $_ -split "\`t"
  $name = $procs[[int]$parts[1]]
  if ($name) { "$($parts[0])\`t$($parts[1])\`t$name" }
}`

/** Parses the probe output, discarding lines the enumeration could not fill in. */
export function parseWindowProbe(stdout: string): VisibleWindow[] {
  if (typeof stdout !== 'string' || stdout.length === 0) return []
  const windows: VisibleWindow[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue
    const [className, pidRaw, processName] = line.split('\t')
    if (!className || !processName) continue
    const pid = Number(pidRaw)
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    windows.push({ className, pid, processName })
  }
  return windows
}

/** Lowercased window class → friendly game name.  First entry wins per class. */
export function buildClassLookup(entries: WindowClassEntry[]): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const entry of entries) {
    const className = entry.windowClass?.trim()
    const displayName = entry.displayName?.trim()
    if (!className || !displayName) continue
    const key = className.toLowerCase()
    if (!lookup.has(key)) lookup.set(key, displayName)
  }
  return lookup
}

/**
 * Finds every open window whose class maps to a known game.  This is how games
 * with a build-stamped image name (`FiveM_b3258_GTAProcess.exe`) get detected,
 * since no process-name list can enumerate those.
 *
 * Returns all matches rather than the first so the caller can cross-check them
 * against its own process snapshot and prefer one that is still running.
 */
export function findGamesByWindowClass(windows: VisibleWindow[], classLookup: Map<string, string>): WindowClassMatch[] {
  const matches: WindowClassMatch[] = []
  for (const window of windows) {
    const displayName = classLookup.get(window.className.toLowerCase())
    if (!displayName) continue
    matches.push({ processName: window.processName, displayName })
  }
  return matches
}

/**
 * Runs the enumeration.  Returns an empty list on any failure, so a blocked or
 * unavailable probe can never break game detection.
 */
export async function getVisibleWindows(signal?: AbortSignal): Promise<VisibleWindow[]> {
  try {
    const { stdout } = await execTracked('powershell.exe', psArgs(PROBE_SCRIPT), {
      timeout: 15_000,
      ...(signal ? { signal } : {}),
    })
    return parseWindowProbe(stdout)
  } catch {
    return []
  }
}
