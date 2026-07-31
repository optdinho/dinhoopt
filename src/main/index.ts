import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import dotenv from 'dotenv'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'

// Carrega .env apenas em dev — em produção as env vars vêm do CI/CD
if (!app.isPackaged) {
  const envPath = join(__dirname, '../../.env')
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true })
  }
}

// ─── Security: move secrets out of process.env ─────────────
import { sanitizeEnvVars } from './services/env-sanitize'

sanitizeEnvVars()

// GPU workaround — Chromium 134 (Electron 43) crashes the GPU process with
// error_code=18 on RTX 5050. --no-sandbox prevents the GPU sandbox from
// blocking initialization; --disable-gpu forces software rendering as fallback.
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

import { IPC } from '../shared/channels'
import type { ScheduleRunStatus } from '../shared/types'
import { runCli } from './cli'
import { runDaemon } from './daemon'
import { t } from './i18n'
import { registerCleanerIpc } from './ipc'
import { stopEngineProcess } from './ipc/clips-engine-connection'
import { ensureRulesLoaded } from './ipc/winapp2-rules-store'
import { initAuditLog } from './services/audit-log'
import { initAutoUpdater } from './services/auto-updater'
import { initBackupManager } from './services/backup-manager'
import { isAdmin } from './services/elevation'
import { execNativeUtf8, killAllChildren, psUtf8 } from './services/exec-utf8'
import { getLogger } from './services/logger.service'
import { attachRendererDiagnostics } from './services/renderer-diagnostics'
import {
  completeScheduleRun,
  getNextScanTime,
  notifyScheduledScanComplete,
  startScheduler,
  stopScheduler,
} from './services/scheduler'
import { getSettings } from './services/settings-store'

process.on('uncaughtException', (err) => {
  getLogger().error('app', `Uncaught exception: ${err.message}`)
})

process.on('unhandledRejection', (reason) => {
  getLogger().error('app', `Unhandled rejection: ${String(reason)}`)
})

// ─── Headless mode flags ─────────────────────────────────────
// When running without a GUI (daemon or CLI), disable sandbox
// so Electron works on headless Linux servers without X11/Wayland.
// IMPORTANT: Clear DISPLAY before Chromium initializes — otherwise the
// native layer picks the X11 ozone backend before app.commandLine
// switches are processed, and crashes if no X server is running.
if (process.argv.includes('--daemon') || process.argv.includes('--cli')) {
  process.env.DISPLAY = undefined
  process.env.WAYLAND_DISPLAY = undefined

  app.commandLine.appendSwitch('ozone-platform', 'headless')
}

// ─── Data directory override ────────────────────────────────
// When relaunched as root (macOS/Linux), the elevated process receives
// --dinho-data-dir=<path> so it reads/writes the original user's config
// instead of /var/root/... or /root/...
const dataDirFlag = process.argv.find((a) => a.startsWith('--dinho-data-dir='))
if (dataDirFlag) {
  const dir = dataDirFlag.slice('--dinho-data-dir='.length)
  if (dir && isAbsolute(dir)) {
    app.setPath('userData', dir)
  }
}

// ─── CLI / Daemon mode ───────────────────────────────────────
// If --cli is passed, run headless and exit — no GUI, no tray.
// If --daemon is passed, run headless and stay alive.
if (process.argv.includes('--cli')) {
  app.whenReady().then(() => runCli())
} else if (process.argv.includes('--daemon')) {
  app.whenReady().then(() => runDaemon())
} else {
  initGui()
}

function initGui(): void {
  // Auto-elevate if not running as admin on Windows
  if (process.platform === 'win32' && !isAdmin()) {
    getLogger().info('app', 'Not running as admin — spawning UAC elevation via PowerShell')
    const exePath = app.getPath('exe')
    const escapedExe = exePath.replace(/'/g, "''")
    const argList = dataDirFlag ? ` -ArgumentList '${dataDirFlag.replace(/'/g, "''")}'` : ''
    const psScript = `Start-Process -FilePath '${escapedExe}'${argList} -Verb RunAs`
    execFile('powershell.exe', ['-NoProfile', '-Command', psUtf8(psScript)], { windowsHide: true }, (err) => {
      if (!err) {
        getLogger().info('app', 'UAC elevation launched — exiting un-elevated instance')
        app.releaseSingleInstanceLock()
        app.exit(0)
      } else {
        getLogger().error('app', `UAC elevation failed: ${err.message}`)
      }
    })
    return
  }

  getLogger().info('app', 'Already running as admin — skipping UAC elevation')

  // Prevent multiple instances — if another is already running, focus it and quit this one
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  let mainWindow: BrowserWindow | null = null
  let tray: Tray | null = null
  let ipcRegistered = false

  function getIconPath(): string {
    return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../resources/icon.ico')
  }

  function createTrayIcon(): Electron.NativeImage {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(__dirname, '../../resources/icon.ico')
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  }

  const TASK_NAME = 'DiNhoStartup'

  async function applyAutoLaunchWin32(enabled: boolean): Promise<void> {
    // Use Task Scheduler with RunLevel HighestAvailable so the app starts
    // elevated at logon. The HKCU Run key is NOT a viable fallback because
    // the exe manifest is requireAdministrator — Windows silently skips
    // Run-key entries for executables with an admin manifest.
    const exePath = app.getPath('exe')

    if (enabled) {
      // Remove any stale task first, then create a fresh one
      try {
        await execNativeUtf8('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { timeout: 10000 })
      } catch {
        /* task may not exist yet */
      }

      // Build the task via XML so the /TR value is never subject to
      // schtasks command-line quoting quirks (common cause of silent failures
      // when the exe path contains spaces, e.g. "C:\Program Files\...").
      const xml = [
        '<?xml version="1.0" encoding="UTF-16"?>',
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
        '  <Triggers>',
        '    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>',
        '    <SessionStateChangeTrigger>',
        '      <Enabled>true</Enabled>',
        '      <StateChange>ConsoleConnect</StateChange>',
        '    </SessionStateChangeTrigger>',
        '  </Triggers>',
        '  <Principals>',
        '    <Principal id="Author">',
        '      <LogonType>InteractiveToken</LogonType>',
        '      <RunLevel>HighestAvailable</RunLevel>',
        '    </Principal>',
        '  </Principals>',
        '  <Settings>',
        '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
        '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
        '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
        '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
        '    <Enabled>true</Enabled>',
        '  </Settings>',
        '  <Actions Context="Author">',
        '    <Exec>',
        `      <Command>${escapeXml(exePath)}</Command>`,
        '      <Arguments>--startup</Arguments>',
        '    </Exec>',
        '  </Actions>',
        '</Task>',
      ].join('\r\n')

      const tmpPath = join(app.getPath('temp'), `${TASK_NAME}.xml`)
      const { writeFile, unlink } = await import('node:fs/promises')
      await writeFile(tmpPath, `\uFEFF${xml}`, 'utf-16le')

      try {
        await execNativeUtf8('schtasks', ['/Create', '/TN', TASK_NAME, '/XML', tmpPath, '/F'], { timeout: 10000 })
      } finally {
        unlink(tmpPath).catch(() => {})
      }

      // Verify the task was actually registered
      await execNativeUtf8('schtasks', ['/Query', '/TN', TASK_NAME], { timeout: 10000 })
    } else {
      try {
        await execNativeUtf8('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { timeout: 10000 })
      } catch {
        /* task may not exist */
      }
    }

    // Clear any leftover Electron Run-key entry so it doesn't conflict
    app.setLoginItemSettings({ openAtLogin: false })
  }

  function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  async function applyAutoLaunch(enabled: boolean): Promise<void> {
    // Only register auto-launch when packaged — in dev mode this would register
    // the bare Electron binary, causing a generic "Getting Started" window on reboot.
    if (!app.isPackaged) return

    if (process.platform === 'win32') {
      await applyAutoLaunchWin32(enabled)
    } else {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        args: ['--startup'],
      })
    }
  }

  function createTray(): void {
    if (tray) return

    tray = new Tray(createTrayIcon())
    tray.setToolTip(t('trayTooltip'))

    const contextMenu = Menu.buildFromTemplate([
      {
        label: t('openDiNho'),
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
          } else {
            createWindow()
          }
        },
      },
      { type: 'separator' },
      {
        label: t('quit'),
        click: () => {
          // Force quit — don't intercept close
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeAllListeners('close')
          }
          app.quit()
        },
      },
    ])

    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    })
  }

  /** Rebuild the tray context menu (e.g. after a language change) */
  function rebuildTrayMenu(): void {
    if (!tray) return
    tray.setToolTip(t('trayTooltip'))
    const contextMenu = Menu.buildFromTemplate([
      {
        label: t('openDiNho'),
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
          } else {
            createWindow()
          }
        },
      },
      { type: 'separator' },
      {
        label: t('quit'),
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeAllListeners('close')
          }
          app.quit()
        },
      },
    ])
    tray.setContextMenu(contextMenu)
  }

  function destroyTray(): void {
    if (tray) {
      tray.destroy()
      tray = null
    }
  }

  function createWindow(): void {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    const width = Math.round(screenWidth * 0.75)
    const height = Math.round(screenHeight * 0.8)

    const icon = nativeImage.createFromPath(getIconPath())

    mainWindow = new BrowserWindow({
      // window will be maximized after creation
      // (full‑screen mode)

      // start maximized
      // will be maximized after creation

      width,
      height,
      minWidth: 900,
      minHeight: 600,
      frame: false,
      backgroundColor: '#09090b',
      icon,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        allowFileAccessFromFiles: true,
      },
    })
    // abre em tela cheia
    mainWindow.maximize()

    const settings = getSettings()
    const isStartupLaunch = process.argv.includes('--startup')

    attachRendererDiagnostics(mainWindow)

    mainWindow.on('ready-to-show', () => {
      // If launched at startup with minimize-to-tray, stay hidden
      if (isStartupLaunch && settings.minimizeToTray) {
        // Don't show — just sit in tray
      } else {
        mainWindow?.show()
      }
    })

    // Intercept close to minimize to tray if enabled
    mainWindow.on('close', (e) => {
      const currentSettings = getSettings()
      if (currentSettings.minimizeToTray && mainWindow && !mainWindow.isDestroyed()) {
        e.preventDefault()
        mainWindow.hide()
      }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      try {
        const url = new URL(details.url)
        if (url.protocol === 'https:') {
          const trustedHosts = ['github.com', 'discord.com']
          if (trustedHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
            shell.openExternal(details.url)
          } else {
            getLogger().warning('app', `Blocked untrusted external URL: ${details.url}`)
          }
        }
      } catch {
        // Invalid URL, ignore
      }
      return { action: 'deny' }
    })

    // Register IPC handlers only once to avoid stacking on window recreation
    if (!ipcRegistered) {
      // Window control IPC — use current mainWindow reference
      ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize())
      ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
        if (mainWindow?.isMaximized()) {
          mainWindow.unmaximize()
        } else {
          mainWindow?.maximize()
        }
      })
      ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close())

      // Register all IPC handlers (pass getter so handlers always use current window)
      registerCleanerIpc(() => mainWindow)

      // Load winapp2 rules (from disk cache or download on first run)
      ensureRulesLoaded(app.getPath('userData')).catch((err) => {
        getLogger().error('app', `Failed to load winapp2 rules: ${err}`)
      })

      ipcRegistered = true
    }

    // Load the app
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    getLogger().info(
      'app',
      `App starting — v${app.getVersion()}, platform: ${process.platform}, elevated: ${isAdmin()}`,
    )
    getLogger().info('app', `argv: ${process.argv.slice(1).join(' ')}`)
    getLogger().info('app', `isPackaged: ${app.isPackaged}, userData: ${app.getPath('userData')}`)

    // Ensure an Edit menu exists so clipboard shortcuts (Cmd+C/V/X on macOS,
    // Ctrl+C/V/X elsewhere) work in the frameless window.  On macOS Cmd+V
    // relies on an Edit menu with the paste role — without an explicit menu
    // the shortcuts break when the app is relaunched as root.
    // We preserve the default appMenu role so Cmd+Q, Cmd+H, About, etc. stay.
    const appMenu = Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ])
    Menu.setApplicationMenu(appMenu)

    const settings = getSettings()
    getLogger().info(
      'app',
      `settings.runAtStartup=${settings.runAtStartup}, minimizeToTray=${settings.minimizeToTray}, schedules=${settings.schedules.filter((s) => s.enabled).length} active`,
    )

    // Apply auto-launch setting
    getLogger().info('app', `Configuring auto-launch (runAtStartup=${settings.runAtStartup}) — may spawn schtasks`)
    applyAutoLaunch(settings.runAtStartup).catch((err) => {
      getLogger().error('app', `Failed to configure auto-launch: ${err.message}`)
    })

    // Create tray if minimize-to-tray is enabled or any schedule is active
    if (settings.minimizeToTray || settings.schedules.some((s) => s.enabled)) {
      createTray()
    }

    createWindow()

    // Initialize audit log and backup manager
    initAuditLog()
    initBackupManager()

    // Initialize auto-updater
    initAutoUpdater()

    // Start the scheduled scan checker
    startScheduler(() => mainWindow)

    // Listen for settings changes to update auto-launch and tray
    ipcMain.handle(IPC.SETTINGS_APPLY_STARTUP, async (_event, enabled: boolean) => {
      await applyAutoLaunch(enabled)
    })

    ipcMain.on(IPC.SETTINGS_APPLY_TRAY, (_event, enabled: boolean) => {
      if (enabled) {
        createTray()
      } else if (!getSettings().schedules.some((s) => s.enabled)) {
        destroyTray()
      }
    })

    // Rebuild tray menu when language changes so labels update immediately
    app.on('dinho:language-changed' as never, () => {
      rebuildTrayMenu()
    })

    // IPC to get next scan time for the UI
    ipcMain.handle(IPC.SCHEDULE_NEXT_SCAN, () => {
      const s = getSettings()
      const next = getNextScanTime(s)
      return next ? next.toISOString() : null
    })

    // Handle scheduled scan completion notification from renderer
    ipcMain.on(IPC.SCHEDULE_SCAN_COMPLETE, (_event, totalSize: number, itemCount: number) => {
      notifyScheduledScanComplete(totalSize, itemCount)
    })

    // Handle multi-schedule run completion
    ipcMain.on(IPC.SCHEDULE_RUN_COMPLETE, (_event, scheduleId: unknown, status: unknown) => {
      if (typeof scheduleId !== 'string' || typeof status !== 'string') return
      completeScheduleRun(scheduleId, status as ScheduleRunStatus)
    })

    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Window exists but may be hidden (minimize-to-tray) — restore it
        mainWindow.show()
        mainWindow.focus()
      } else if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    const settings = getSettings()
    // Don't quit if minimize-to-tray or any schedule is enabled
    if (settings.minimizeToTray || settings.schedules.some((s) => s.enabled)) {
      // Stay alive in tray
      return
    }
    app.quit()
  })

  app.on('before-quit', () => {
    getLogger().info('app', 'App shutting down')
    stopScheduler()
    stopEngineProcess()
    // Kill any active child processes (reg.exe, cmd.exe, etc.) to prevent orphans
    killAllChildren()
  })
} // end initGui
