import os from 'node:os'
import { IPC } from '@shared/channels'
import type { PerfQuickStats } from '@shared/types'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import { PerfMonitorService } from '../services/perf-monitor'

// ── Lightweight CPU sampling for dashboard gauges ────────────
// Uses Node.js os.cpus() which has near-zero cost and no
// systeminformation dependency. Compares two samples to get %.
let prevCpuTimes: { idle: number; total: number } | null = null

/** Reset module-level cache — used by tests to ensure isolation */
export function _resetPerfCache(): void {
  prevCpuTimes = null
}

function sampleCpu(): number {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  if (!prevCpuTimes) {
    prevCpuTimes = { idle, total }
    return 0
  }
  const idleDiff = idle - prevCpuTimes.idle
  const totalDiff = total - prevCpuTimes.total
  prevCpuTimes = { idle, total }
  return totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0
}

// Critical Windows processes that must never be killed by the user.
// Terminating these can cause a BSOD, logon failure, or system instability.
const PROTECTED_PROCESS_NAMES = new Set([
  'csrss.exe', // Client/Server Runtime — BSOD if killed
  'smss.exe', // Session Manager — BSOD if killed
  'wininit.exe', // Windows Init — BSOD if killed
  'services.exe', // Service Control Manager
  'lsass.exe', // Local Security Authority — logon/auth
  'lsaiso.exe', // LSA Isolated (Credential Guard)
  'svchost.exe', // Hosts many core OS services
  'winlogon.exe', // Logon session manager
  'dwm.exe', // Desktop Window Manager — desktop crashes
  'explorer.exe', // Windows shell — taskbar/desktop disappears
  'ntoskrnl.exe', // Kernel image
  'system', // Kernel-mode system process
  'registry', // Registry hive process
  'memory compression', // Memory management
  // macOS / Linux equivalents
  'launchd', // macOS PID 1
  'kernel_task', // macOS kernel
  'windowserver', // macOS display server
  'systemd', // Linux PID 1
  'init', // Linux PID 1 (SysVinit)
  'kthreadd', // Linux kernel threads
  'gdm', // GNOME Display Manager
  'sddm', // KDE Display Manager
  'lightdm', // Light Display Manager
  'xorg', // X11 display server
  'xwayland', // XWayland display server
])

export function registerPerfMonitorIpc(getWindow: () => Electron.BrowserWindow | null): void {
  const service = new PerfMonitorService()

  // Track whether the renderer explicitly requested monitoring so we can
  // auto-pause when the window is hidden and resume when shown again.
  let rendererRequestedMonitoring = false
  let attachedWindowId: number | null = null

  function attachWindowListeners(win: Electron.BrowserWindow): void {
    if (win.id === attachedWindowId) return
    attachedWindowId = win.id

    win.on('hide', () => {
      if (rendererRequestedMonitoring) service.stopMonitoring()
    })
    win.on('show', () => {
      if (rendererRequestedMonitoring && !win.webContents.isDestroyed()) {
        service.startMonitoring(win.webContents)
      }
    })
  }

  // Lightweight one-shot stats for dashboard gauges — no timers, no process list
  ipcMain.handle(IPC.PERF_QUICK_STATS, (): PerfQuickStats => {
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    return {
      cpuPercent: sampleCpu(),
      memUsedBytes: usedMem,
      memTotalBytes: totalMem,
      memPercent: Math.round((usedMem / totalMem) * 100),
    }
  })

  ipcMain.handle(IPC.PERF_GET_SYSTEM_INFO, () => {
    getLogger().info('perf-monitor', 'Fetching system info')
    return service.getSystemInfo()
  })

  ipcMain.handle(IPC.PERF_START_MONITORING, (event) => {
    rendererRequestedMonitoring = true
    getLogger().info('perf-monitor', 'Starting performance monitoring')

    // Attach hide/show listeners to the current window if not already attached
    const win = getWindow()
    if (win) attachWindowListeners(win)

    return service.startMonitoring(event.sender)
  })

  ipcMain.handle(IPC.PERF_STOP_MONITORING, () => {
    rendererRequestedMonitoring = false
    getLogger().info('perf-monitor', 'Stopping performance monitoring')
    service.stopMonitoring()
  })

  ipcMain.handle(IPC.PERF_START_PROCESS_POLLING, () => {
    getLogger().info('perf-monitor', 'Starting process polling')
    service.startProcessPolling()
  })

  ipcMain.handle(IPC.PERF_STOP_PROCESS_POLLING, () => {
    getLogger().info('perf-monitor', 'Stopping process polling')
    service.stopProcessPolling()
  })

  ipcMain.handle(IPC.PERF_KILL_PROCESS, async (_event, pid: number) => {
    getLogger().info('perf-monitor', `Attempting to kill process PID ${pid}`)
    // Validate pid is a positive integer and not a critical system process
    if (!Number.isInteger(pid) || pid <= 0) {
      getLogger().warning('perf-monitor', `Invalid process ID: ${pid}`)
      return { success: false, error: 'Invalid process ID' }
    }
    // Block PID 0 (System Idle / kernel), PID 1 (init/launchd), PID 4 (Windows System)
    if (pid <= 4) {
      getLogger().warning('perf-monitor', `Blocked kill of critical system process PID ${pid}`)
      return { success: false, error: 'Cannot kill critical system process' }
    }
    // Prevent the app from killing itself
    if (pid === process.pid) {
      getLogger().warning('perf-monitor', 'Blocked kill of own process')
      return { success: false, error: 'Cannot kill own process' }
    }
    // Look up the process name and block protected system processes
    const processName = await service.getProcessName(pid)
    if (processName && PROTECTED_PROCESS_NAMES.has(processName.toLowerCase())) {
      getLogger().warning('perf-monitor', `Blocked kill of protected process ${processName} (PID ${pid})`)
      return { success: false, error: `Cannot kill protected system process (${processName})` }
    }
    const result = await service.killProcess(pid)
    if (result.success) {
      getLogger().success('perf-monitor', `Process PID ${pid} killed successfully`)
    } else {
      getLogger().error('perf-monitor', `Failed to kill process PID ${pid}`, result.error)
    }
    return result
  })

  ipcMain.handle(IPC.PERF_DISK_HEALTH, () => {
    getLogger().info('perf-monitor', 'Fetching disk health')
    return service.getDiskHealth()
  })
}
