import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/channels'
import type { WindowGetter } from './index'
import { psUtf8, execFileAsync } from '../services/exec-utf8'
import { getPlatform } from '../platform'
import { isAdmin } from '../services/elevation'
import type {
  WindowsTweakDef,
  WindowsTweakCategory,
  WindowsTweakLevel,
  DnsPreset,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  WindowsTweakState,
} from '@shared/types'

export const DNS_PRESETS: DnsPreset[] = [
  { name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' },
  { name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4' },
  { name: 'OpenDNS', primary: '208.67.222.222', secondary: '208.67.220.220' },
  { name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112' },
]

const TWEAK_CATALOG: WindowsTweakDef[] = [
  // Mouse
  { id: 'mouse-speed', name: 'Mouse 1:1 — Sem aceleração', category: 'mouse', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Mouse', key: 'MouseSpeed', kind: 'String', defaultValue: '1', optimizedValue: '0' },
  { id: 'mouse-threshold1', name: 'Mouse Threshold 1 — Zero', category: 'mouse', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Mouse', key: 'MouseThreshold1', kind: 'String', defaultValue: '6', optimizedValue: '0' },
  { id: 'mouse-threshold2', name: 'Mouse Threshold 2 — Zero', category: 'mouse', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Mouse', key: 'MouseThreshold2', kind: 'String', defaultValue: '10', optimizedValue: '0' },
  { id: 'mouse-queue-size', name: 'Mouse Data Queue Size — 16', category: 'mouse', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters', key: 'MouseDataQueueSize', kind: 'DWord', defaultValue: 100, optimizedValue: 16 },

  // Keyboard
  { id: 'keyboard-queue-size', name: 'Keyboard Data Queue Size — 16', category: 'keyboard', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters', key: 'KeyboardDataQueueSize', kind: 'DWord', defaultValue: 100, optimizedValue: 16 },

  // Accessibility
  { id: 'sticky-keys-off', name: 'Sticky Keys — OFF', category: 'accessibility', level: 'medio', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Accessibility\\StickyKeys', key: 'Flags', kind: 'String', defaultValue: '510', optimizedValue: '506' },
  { id: 'toggle-keys-off', name: 'Toggle Keys — OFF', category: 'accessibility', level: 'medio', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Accessibility\\ToggleKeys', key: 'Flags', kind: 'String', defaultValue: '62', optimizedValue: '58' },
  { id: 'filter-keys-off', name: 'Filter Keys — OFF', category: 'accessibility', level: 'medio', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Accessibility\\Keyboard Response', key: 'Flags', kind: 'String', defaultValue: '126', optimizedValue: '122' },
  { id: 'mouse-keys-off', name: 'Mouse Keys — OFF', category: 'accessibility', level: 'medio', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Accessibility\\MouseKeys', key: 'Flags', kind: 'String', defaultValue: '62', optimizedValue: '0' },

  // Network
  { id: 'tcp-no-delay', name: 'TCP No Delay — ON', category: 'network', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', key: 'TCPNoDelay', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'tcp-ack-freq', name: 'TCP Ack Frequency — 1', category: 'network', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces', key: 'TcpAckFrequency', kind: 'DWord', defaultValue: 2, optimizedValue: 1 },
  { id: 'tcp-no-delay-iface', name: 'TCP No Delay (Interfaces)', category: 'network', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces', key: 'TCPNoDelay', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'default-ttl', name: 'Default TTL — 64', category: 'network', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', key: 'DefaultTTL', kind: 'DWord', defaultValue: 128, optimizedValue: 64 },
  { id: 'max-user-port', name: 'Max User Port — 65534', category: 'network', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', key: 'MaxUserPort', kind: 'DWord', defaultValue: 5000, optimizedValue: 65534 },
  { id: 'tcp-1323-opts', name: 'TCP Window Scaling — ON', category: 'network', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', key: 'Tcp1323Opts', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'tcp-max-dup-acks', name: 'TCP Max Dup Acks — 2', category: 'network', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', key: 'TcpMaxDupAcks', kind: 'DWord', defaultValue: 3, optimizedValue: 2 },
  { id: 'tcp-timed-wait-delay', name: 'TCP Timed Wait Delay — 30s', category: 'network', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters', key: 'TcpTimedWaitDelay', kind: 'DWord', defaultValue: 120, optimizedValue: 30 },
  { id: 'network-throttling', name: 'Network Throttling Index — OFF', category: 'network', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile', key: 'NetworkThrottlingIndex', kind: 'DWord', defaultValue: 10, optimizedValue: 4294967295 },
  { id: 'delivery-opt-off', name: 'Delivery Optimization (P2P) — OFF', category: 'network', level: 'basico', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config', key: 'DODownloadMode', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },

  // GPU
  { id: 'hags-on', name: 'Hardware GPU Scheduling — ON', category: 'gpu', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', key: 'HwSchMode', kind: 'DWord', defaultValue: 1, optimizedValue: 2, needsReboot: true },
  { id: 'mpo-overlay-minfps', name: 'MPO Overlay Min FPS — 0', category: 'gpu', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows\\Dwm', key: 'OverlayMinFPS', kind: 'DWord', defaultValue: 1, optimizedValue: 0, experimental: true },
  { id: 'vsync-global-off', name: 'VSync Global — OFF', category: 'gpu', level: 'full', hive: 'HKEY_CURRENT_USER', path: 'SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences', key: 'DirectXUserGlobalSettings', kind: 'String', defaultValue: 'SwapEffectUpgradeCache=1;', optimizedValue: 'VSync=Off;' },
  { id: 'hw-accel-wpf', name: 'HW Acceleration WPF — ON', category: 'gpu', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'SOFTWARE\\Microsoft\\Avalon.Graphics', key: 'DisableHWAcceleration', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },

  // System
  { id: 'menu-show-delay', name: 'Menu Show Delay — 0ms', category: 'system', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Desktop', key: 'MenuShowDelay', kind: 'String', defaultValue: '400', optimizedValue: '0' },
  { id: 'win32-priority-sep', name: 'Win32 Priority Separation — 38', category: 'system', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl', key: 'Win32PrioritySeparation', kind: 'DWord', defaultValue: 26, optimizedValue: 38 },
  { id: 'system-responsiveness', name: 'System Responsiveness — 0', category: 'system', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile', key: 'SystemResponsiveness', kind: 'DWord', defaultValue: 20, optimizedValue: 0 },
  { id: 'disable-paging-exec', name: 'Disable Paging Executive — 1', category: 'system', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', key: 'DisablePagingExecutive', kind: 'DWord', defaultValue: 0, optimizedValue: 1, needsReboot: true },
  { id: 'svchost-threshold', name: 'SvcHost Split Threshold — 64MB', category: 'system', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control', key: 'SvcHostSplitThresholdInKB', kind: 'DWord', defaultValue: 3670016, optimizedValue: 67108864 },
  { id: 'power-throttling-off', name: 'Power Throttling — OFF', category: 'energy', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', key: 'PowerThrottlingOff', kind: 'DWord', defaultValue: 0, optimizedValue: 1, needsReboot: true },
  { id: 'explorer-delay', name: 'Explorer Startup Delay — 0ms', category: 'system', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize', key: 'StartupDelayInMSec', kind: 'DWord', defaultValue: 4000, optimizedValue: 0 },
  { id: 'transparency-off', name: 'Transparência — OFF', category: 'system', level: 'full', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', key: 'EnableTransparency', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'ntfs-last-access-off', name: 'NTFS Last Access Update — OFF', category: 'system', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', key: 'NtfsDisableLastAccessUpdate', kind: 'DWord', defaultValue: 0, optimizedValue: 1, needsReboot: true },
  { id: 'wait-to-kill-timeout', name: 'WaitToKillServiceTimeout — 2000ms', category: 'system', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Desktop', key: 'WaitToKillServiceTimeout', kind: 'String', defaultValue: '5000', optimizedValue: '2000', needsLogoff: true },
  { id: 'widgets-off', name: 'Widgets (Win11) — OFF', category: 'system', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Feeds', key: 'ShellFeedsTaskbarEnabled', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'news-interest-off', name: 'News & Interests — OFF', category: 'system', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', key: 'TaskbarDa', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'min-animate-off', name: 'Animação de Janelas — OFF', category: 'system', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Control Panel\\Desktop\\WindowMetrics', key: 'MinAnimate', kind: 'String', defaultValue: '1', optimizedValue: '0' },
  { id: 'irq8-priority', name: 'IRQ8 (System Clock) Priority — 1', category: 'system', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl', key: 'IRQ8Priority', kind: 'DWord', defaultValue: 0, optimizedValue: 1, needsReboot: true },

  // Gaming
  { id: 'gamedvr-enabled', name: 'Game DVR — OFF', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'System\\GameConfigStore', key: 'GameDVR_Enabled', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'gamedvr-fse', name: 'Game DVR FSE Behavior — 2', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'System\\GameConfigStore', key: 'GameDVR_FSEBehaviorMode', kind: 'DWord', defaultValue: 0, optimizedValue: 2 },
  { id: 'gamedvr-honor-fse', name: 'Game DVR Honor FSE — 1', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'System\\GameConfigStore', key: 'GameDVR_HonorUserFSEBehaviorMode', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'gamedvr-dxgi', name: 'Game DVR DXGI FSE — 1', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'System\\GameConfigStore', key: 'GameDVR_DXGIHonorFSEWindowsCompatible', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'gamedvr-efse', name: 'Game DVR EFSE Flags — 0', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'System\\GameConfigStore', key: 'GameDVR_EFSEFeatureFlags', kind: 'DWord', defaultValue: 3, optimizedValue: 0 },
  { id: 'app-capture-off', name: 'App Capture — OFF', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', key: 'AppCaptureEnabled', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'gamedvr-policy', name: 'Allow GameDVR (Policy) — 0', category: 'gaming', level: 'basico', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR', key: 'AllowGameDVR', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'gamedvr-pm', name: 'Allow GameDVR (PolicyManager) — 0', category: 'gaming', level: 'basico', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\ApplicationManagement\\AllowGameDVR', key: 'value', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'auto-game-mode', name: 'Auto Game Mode — ON', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\GameBar', key: 'AutoGameModeEnabled', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'allow-auto-game-mode', name: 'Allow Auto Game Mode — ON', category: 'gaming', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\GameBar', key: 'AllowAutoGameMode', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'perfopt-csgo', name: 'CPU Priority — CS2 (High)', category: 'gaming', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\cs2.exe\\PerfOptions', key: 'CpuPriorityClass', kind: 'DWord', defaultValue: 0, optimizedValue: 3 },
  { id: 'perfopt-fivem', name: 'CPU Priority — FiveM (High)', category: 'gaming', level: 'full', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM.exe\\PerfOptions', key: 'CpuPriorityClass', kind: 'DWord', defaultValue: 0, optimizedValue: 3 },

  // Privacy
  { id: 'telemetria-off', name: 'Telemetria — OFF', category: 'privacy', level: 'basico', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', key: 'AllowTelemetry', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'background-apps', name: 'Background Apps — OFF', category: 'privacy', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', key: 'GlobalUserDisabled', kind: 'DWord', defaultValue: 0, optimizedValue: 1 },
  { id: 'allow-cortana-off', name: 'Cortana — OFF', category: 'privacy', level: 'basico', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', key: 'AllowCortana', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'start-suggested-content-off', name: 'Conteúdo Sugerido no Start — OFF', category: 'privacy', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', key: 'SubscribedContent-338388Enabled', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'recent-files-off', name: 'Arquivos Recentes no Start — OFF', category: 'privacy', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', key: 'Start_TrackDocs', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },
  { id: 'lock-screen-ads-off', name: 'Anúncios Tela Bloqueio — OFF', category: 'privacy', level: 'basico', hive: 'HKEY_CURRENT_USER', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', key: 'RotatingLockScreenOverlayEnabled', kind: 'DWord', defaultValue: 1, optimizedValue: 0 },

  // MMCSS
  { id: 'mmcss-gpu-priority', name: 'MMCSS GPU Priority — 8', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'GPU Priority', kind: 'DWord', defaultValue: 2, optimizedValue: 8 },
  { id: 'mmcss-priority', name: 'MMCSS CPU Priority — 6', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'Priority', kind: 'DWord', defaultValue: 2, optimizedValue: 6 },
  { id: 'mmcss-sched-cat', name: 'MMCSS Scheduling Category — High', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'Scheduling Category', kind: 'String', defaultValue: 'Medium', optimizedValue: 'High' },
  { id: 'mmcss-sfio', name: 'MMCSS SFIO Priority — High', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'SFIO Priority', kind: 'String', defaultValue: 'Normal', optimizedValue: 'High' },
  { id: 'mmcss-background', name: 'MMCSS Background Only — False', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'Background Only', kind: 'String', defaultValue: 'True', optimizedValue: 'False' },
  { id: 'mmcss-affinity', name: 'MMCSS Affinity — 0 (todos cores)', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'Affinity', kind: 'DWord', defaultValue: 0, optimizedValue: 0 },
  { id: 'mmcss-clock-rate', name: 'MMCSS Clock Rate — 10000 (1ms)', category: 'mmcss', level: 'medio', hive: 'HKEY_LOCAL_MACHINE', path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', key: 'Clock Rate', kind: 'DWord', defaultValue: 10000, optimizedValue: 10000 },
]

export function getCatalog(): WindowsTweakDef[] {
  return TWEAK_CATALOG
}

export function getCatalogByCategory(cat: WindowsTweakCategory): WindowsTweakDef[] {
  return TWEAK_CATALOG.filter((t) => t.category === cat)
}

async function runPsScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    psUtf8(script),
  ], { timeout: 30000, windowsHide: true })
  return stdout
}

async function applyInterfaceTweak(tweak: WindowsTweakDef, field: 'defaultValue' | 'optimizedValue'): Promise<boolean> {
  const val = tweak[field]
  const psVal = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : String(val)
  const kind = tweak.kind === 'DWord' ? 'DWord' : 'String'
  const script = `Get-ChildItem "HKLM:\\${tweak.path}" -Name | ForEach-Object { New-ItemProperty -Path "HKLM:\\${tweak.path}\\$_" -Name "${tweak.key}" -Value ${psVal} -PropertyType ${kind} -Force -ErrorAction Stop }`
  await runPsScript(script)
  return true
}

async function checkInterfaceTweakApplied(tweak: WindowsTweakDef): Promise<boolean> {
  const expected = Number(tweak.optimizedValue)
  const script = `$ok = $true; Get-ChildItem "HKLM:\\${tweak.path}" -Name | ForEach-Object { $val = (Get-ItemProperty -Path "HKLM:\\${tweak.path}\\$_" -Name "${tweak.key}" -ErrorAction SilentlyContinue)."${tweak.key}"; if ($val -ne ${expected}) { $ok = $false } }; if ($ok) { Write-Output "OK" }`
  const stdout = await runPsScript(script)
  return stdout.includes('OK')
}

async function applyPolicyTweak(value: number): Promise<boolean> {
  const script = `
    Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\default\\ApplicationManagement\\AllowGameDVR" -Name "value" -Value ${value} -Type DWord -Force
    Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\ApplicationManagement\\AllowGameDVR" -Name "value" -Value ${value} -Type DWord -Force -ErrorAction SilentlyContinue
    gpupdate /target:computer /force 2>&1 | Out-Null
  `
  await runPsScript(script)
  return true
}

function tweakRequiresAdmin(tweak: WindowsTweakDef): boolean {
  return tweak.requiresAdmin ?? (tweak.hive === 'HKEY_LOCAL_MACHINE')
}

/** Maps reg.exe stderr to a user-friendly error message */
function mapRegError(err: unknown, tweak: WindowsTweakDef): string {
  const msg = String(err?.toString?.() ?? err ?? '')
  if (/access is denied/i.test(msg) || /accesso negado/i.test(msg)) {
    return 'Acesso negado — execute o DiNho Optimizer como administrador.'
  }
  if (/system cannot find (the path|the file|the registry)/i.test(msg)) {
    return 'Chave de registro não encontrada.'
  }
  if (/incorrect function/i.test(msg)) {
    return 'Tipo de valor inválido para esta chave.'
  }
  return 'Falha ao escrever no registro.'
}

async function applyRegistryTweak(tweak: WindowsTweakDef): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (tweakRequiresAdmin(tweak) && !isAdmin()) {
      return { ok: false, reason: 'Acesso negado — execute o DiNho Optimizer como administrador.' }
    }
    if (tweak.path.includes('\\Interfaces')) {
      await applyInterfaceTweak(tweak, 'optimizedValue')
      return { ok: true }
    }
    if (tweak.id === 'gamedvr-pm') {
      await applyPolicyTweak(Number(tweak.optimizedValue))
      return { ok: true }
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const value = typeof tweak.optimizedValue === 'string' ? tweak.optimizedValue : String(tweak.optimizedValue)
    const type = tweak.kind === 'DWord' ? 'REG_DWORD' : 'REG_SZ'

    await execFileAsync('reg.exe', [
      'add', `${baseKey}\\${tweak.path}`,
      '/v', tweak.key,
      '/t', type,
      '/d', value,
      '/f',
    ], { timeout: 10000, windowsHide: true })
    return { ok: true }
  } catch (err) {
    console.error(`[windows-tweaks] apply failed: ${tweak.id}`, err)
    return { ok: false, reason: mapRegError(err, tweak) }
  }
}

async function revertRegistryTweak(tweak: WindowsTweakDef): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (tweakRequiresAdmin(tweak) && !isAdmin()) {
      return { ok: false, reason: 'Acesso negado — execute o DiNho Optimizer como administrador.' }
    }
    if (tweak.path.includes('\\Interfaces')) {
      await applyInterfaceTweak(tweak, 'defaultValue')
      return { ok: true }
    }
    if (tweak.id === 'gamedvr-pm') {
      await applyPolicyTweak(Number(tweak.defaultValue))
      return { ok: true }
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const value = typeof tweak.defaultValue === 'string' ? tweak.defaultValue : String(tweak.defaultValue)
    const type = tweak.kind === 'DWord' ? 'REG_DWORD' : 'REG_SZ'

    await execFileAsync('reg.exe', [
      'add', `${baseKey}\\${tweak.path}`,
      '/v', tweak.key,
      '/t', type,
      '/d', value,
      '/f',
    ], { timeout: 10000, windowsHide: true })
    return { ok: true }
  } catch (err) {
    console.error(`[windows-tweaks] revert failed: ${tweak.id}`, err)
    return { ok: false, reason: mapRegError(err, tweak) }
  }
}

// Regex matches locale-independent registry type keywords
// Example line: "    MouseSpeed    REG_SZ    0"
export const REG_TYPE_RE = /\s+(REG_\w+)\s+(.+)$/

async function checkTweakApplied(tweak: WindowsTweakDef): Promise<boolean> {
  try {
    if (tweak.path.includes('\\Interfaces')) {
      return await checkInterfaceTweakApplied(tweak)
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const { stdout } = await execFileAsync('reg.exe', [
      'query', `${baseKey}\\${tweak.path}`,
      '/v', tweak.key,
    ], { timeout: 10000, windowsHide: true })

    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
    const dataLine = lines.find(l => l.includes(tweak.key))
    if (!dataLine) return false

    const match = dataLine.match(REG_TYPE_RE)
    if (!match) return false
    const valueStr = match[2].trim()

    if (tweak.kind === 'DWord') {
      const actual = valueStr.startsWith('0x') ? parseInt(valueStr, 16) : parseInt(valueStr, 10)
      return actual === Number(tweak.optimizedValue)
    }
    return valueStr === String(tweak.optimizedValue)
  } catch (err) {
    console.error(`[windows-tweaks] check failed: ${tweak.id}`, err)
    return false
  }
}

async function listTweakStatuses(): Promise<WindowsTweakState[]> {
  const statuses = await Promise.all(TWEAK_CATALOG.map(async (tweak) => {
    const applied = await checkTweakApplied(tweak)
    return { tweak, applied }
  }))
  return statuses
}

export function registerWindowsTweaksIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINDOWS_TWEAKS_LIST, async () => {
    return listTweakStatuses()
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_APPLY, async (_event, ids: string[]) => {
    const win = getWindow()
    const selected = TWEAK_CATALOG.filter((t) => ids.includes(t.id))
    let succeeded = 0
    const errors: { id: string; name: string; reason: string }[] = []
    const rebootRequired: { id: string; name: string }[] = []
    const logoffRequired: { id: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const tweak = selected[i]
      win?.webContents.send(IPC.WINDOWS_TWEAKS_APPLY_PROGRESS, {
        current: i + 1,
        total: selected.length,
        currentTweak: tweak.name,
      } satisfies WindowsTweakApplyProgress)

      const result = await applyRegistryTweak(tweak)
      if (result.ok) {
        succeeded++
        if (tweak.needsReboot) rebootRequired.push({ id: tweak.id, name: tweak.name })
        if (tweak.needsLogoff) logoffRequired.push({ id: tweak.id, name: tweak.name })
      } else {
        errors.push({ id: tweak.id, name: tweak.name, reason: result.reason ?? 'Falha ao escrever no registro.' })
      }
    }

    return { succeeded, failed: errors.length, errors, rebootRequired, logoffRequired } satisfies WindowsTweakResult
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_REVERT, async (_event, ids: string[]) => {
    const win = getWindow()
    const selected = TWEAK_CATALOG.filter((t) => ids.includes(t.id))
    let succeeded = 0
    const errors: { id: string; name: string; reason: string }[] = []
    const rebootRequired: { id: string; name: string }[] = []
    const logoffRequired: { id: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const tweak = selected[i]
      win?.webContents.send(IPC.WINDOWS_TWEAKS_REVERT_PROGRESS, {
        current: i + 1,
        total: selected.length,
        currentTweak: tweak.name,
      } satisfies WindowsTweakApplyProgress)

      const result = await revertRegistryTweak(tweak)
      if (result.ok) {
        succeeded++
        if (tweak.needsReboot) rebootRequired.push({ id: tweak.id, name: tweak.name })
        if (tweak.needsLogoff) logoffRequired.push({ id: tweak.id, name: tweak.name })
      } else {
        errors.push({ id: tweak.id, name: tweak.name, reason: result.reason ?? 'Falha ao reverter o registro.' })
      }
    }

    return { succeeded, failed: errors.length, errors, rebootRequired, logoffRequired } satisfies WindowsTweakResult
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_STATUS, async () => {
    return listTweakStatuses()
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_GET_DNS, async () => {
    return DNS_PRESETS
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_SET_DNS, async (_event, primary: string, secondary?: string) => {
    try {
      const plat = getPlatform()
      if (plat.network.setDnsServer) {
        return await plat.network.setDnsServer(primary, secondary)
      }
      return false
    } catch (err) {
      console.error('[windows-tweaks] set-dns failed:', err)
      return false
    }
  })
}
