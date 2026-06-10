import * as si from 'systeminformation'
import { execFile } from 'child_process'
import { psUtf8 } from './exec-utf8'
import { isAdmin } from './elevation'

export interface MemoryInfo {
  totalBytes: number
  availableBytes: number
  usedBytes: number
  usedPercent: number
  cachedBytes: number
}

export interface MemoryProcess {
  pid: number
  name: string
  workingSetBytes: number
}

export interface MemoryOptimizeStep {
  name: string
  success: boolean
  freedBytes: number
  error?: string
}

export interface MemoryOptimizeProgress {
  step: number
  totalSteps: number
  label: string
  detail: string
}

export type ProgressCallback = (progress: MemoryOptimizeProgress) => void

function runPs(script: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message || 'Unknown error'))
        else resolve(stdout)
      }
    )
  })
}

async function getBytesBefore(): Promise<number> {
  const mem = await si.mem()
  return mem.used
}

async function getBytesAfter(): Promise<number> {
  const mem = await si.mem()
  return mem.used
}

function calcFreed(before: number, after: number): number {
  return Math.max(0, before - after)
}

export async function getMemoryInfo(): Promise<MemoryInfo> {
  const mem = await si.mem()
  return {
    totalBytes: mem.total,
    availableBytes: mem.available,
    usedBytes: mem.total - mem.available,
    usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100),
    cachedBytes: mem.cached || 0,
  }
}

export async function getMemoryProcesses(top = 20): Promise<MemoryProcess[]> {
  const processes = await si.processes()
  return processes.list
    .filter((p) => p.mem_rss > 0)
    .sort((a, b) => b.mem_rss - a.mem_rss)
    .slice(0, top)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      workingSetBytes: p.mem_rss,
    }))
}

export async function optimizeMemory(onProgress?: ProgressCallback): Promise<{ success: boolean; freedBytes: number; steps: MemoryOptimizeStep[]; error?: string }> {
  const steps: MemoryOptimizeStep[] = []
  let totalFreed = 0

  const notify = (step: number, totalSteps: number, label: string, detail: string) => {
    onProgress?.({ step, totalSteps, label, detail })
  }

  const TOTAL_STEPS = 2

  // Step 1: Force .NET garbage collection
  notify(1, TOTAL_STEPS, 'gc', 'Collecting .NET garbage...')
  try {
    const before = await getBytesBefore()
    await runPs('[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers(); [System.GC]::Collect()', 15_000)
    const after = await getBytesAfter()
    const freed = calcFreed(before, after)
    totalFreed += freed
    steps.push({ name: 'gc', success: true, freedBytes: freed })
  } catch (err) {
    steps.push({ name: 'gc', success: false, freedBytes: 0, error: String(err) })
  }

  // Step 2: Empty working sets of all processes via P/Invoke SetProcessWorkingSetSize
  notify(2, TOTAL_STEPS, 'workingset', 'Emptying working sets...')
  try {
    const before = await getBytesBefore()
    await runPs(`
Add-Type -TypeDefinition @'
  using System;
  using System.Runtime.InteropServices;
  public class MemoryUtils {
    [DllImport("kernel32.dll")]
    public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, int dwMinimumWorkingSetSize, int dwMaximumWorkingSetSize);
  }
'@
Get-Process | Where-Object { $_.Id -ne $pid } | ForEach-Object {
  try { [MemoryUtils]::SetProcessWorkingSetSize($_.Handle, -1, -1) } catch {}
}
`, 30_000)
    const after = await getBytesAfter()
    const freed = calcFreed(before, after)
    totalFreed += freed
    steps.push({ name: 'workingset', success: true, freedBytes: freed })
  } catch (err) {
    steps.push({ name: 'workingset', success: false, freedBytes: 0, error: String(err) })
  }

  return {
    success: steps.some((s) => s.success),
    freedBytes: totalFreed,
    steps,
  }
}
