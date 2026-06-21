import { IPC } from '@shared/channels'
import type {
  DnsPreset,
  WindowsTweakApplyProgress,
  WindowsTweakCategory,
  WindowsTweakDef,
  WindowsTweakResult,
  WindowsTweakState,
} from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { isAdmin } from '../services/elevation'
import { execFileAsync, psUtf8 } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

export const DNS_PRESETS: DnsPreset[] = [
  { name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' },
  { name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4' },
  { name: 'OpenDNS', primary: '208.67.222.222', secondary: '208.67.220.220' },
  { name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112' },
]

const TWEAK_CATALOG: WindowsTweakDef[] = [
  // Mouse
  {
    id: 'mouse-speed',
    name: 'Mouse 1:1 — Sem aceleração',
    description: 'Desativa aceleração do mouse para movimento 1:1',
    category: 'mouse',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Mouse',
    key: 'MouseSpeed',
    kind: 'String',
    defaultValue: '1',
    optimizedValue: '0',
  },
  {
    id: 'mouse-threshold1',
    name: 'Mouse Threshold 1 — Zero',
    description: 'Zera o limite de aceleração do mouse',
    category: 'mouse',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Mouse',
    key: 'MouseThreshold1',
    kind: 'String',
    defaultValue: '6',
    optimizedValue: '0',
  },
  {
    id: 'mouse-threshold2',
    name: 'Mouse Threshold 2 — Zero',
    description: 'Zera o limite secundário de aceleração do mouse',
    category: 'mouse',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Mouse',
    key: 'MouseThreshold2',
    kind: 'String',
    defaultValue: '10',
    optimizedValue: '0',
  },
  {
    id: 'mouse-queue-size',
    name: 'Mouse Data Queue Size — 16',
    description: 'Reduz buffer interno do mouse para 16 eventos (menor latência)',
    category: 'mouse',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters',
    key: 'MouseDataQueueSize',
    kind: 'DWord',
    defaultValue: 100,
    optimizedValue: 16,
  },
  {
    id: 'mouse-thread-priority',
    name: 'Thread Priority Mouse — 31 (realtime)',
    description: 'Eleva thread do mouse para prioridade máxima (realtime)',
    category: 'mouse',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters',
    key: 'ThreadPriority',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 31,
    needsReboot: true,
  },
  {
    id: 'mouse-transmit-timeout',
    name: 'Mouse Transmit Timeout — 0ms',
    description: 'Envia movimento do mouse sem delay de buffer',
    category: 'mouse',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters',
    key: 'TransmitTimeout',
    kind: 'DWord',
    defaultValue: 64,
    optimizedValue: 0,
  },
  {
    id: 'mouse-hover-time',
    name: 'Mouse Hover Time — 0ms',
    description: 'Remove delay de hover e tooltips do mouse',
    category: 'mouse',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Mouse',
    key: 'MouseHoverTime',
    kind: 'String',
    defaultValue: '400',
    optimizedValue: '0',
  },

  // Keyboard
  {
    id: 'keyboard-queue-size',
    name: 'Keyboard Data Queue Size — 16',
    description: 'Reduz buffer interno do teclado para 16 eventos',
    category: 'keyboard',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters',
    key: 'KeyboardDataQueueSize',
    kind: 'DWord',
    defaultValue: 100,
    optimizedValue: 16,
  },
  {
    id: 'keyboard-thread-priority',
    name: 'Thread Priority Teclado — 31 (realtime)',
    description: 'Eleva thread do teclado para prioridade máxima (realtime)',
    category: 'keyboard',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters',
    key: 'ThreadPriority',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 31,
    needsReboot: true,
  },
  {
    id: 'keyboard-transmit-timeout',
    name: 'Keyboard Transmit Timeout — 0ms',
    description: 'Envia teclas sem delay de buffer',
    category: 'keyboard',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters',
    key: 'TransmitTimeout',
    kind: 'DWord',
    defaultValue: 64,
    optimizedValue: 0,
  },

  // Accessibility
  {
    id: 'sticky-keys-off',
    name: 'Sticky Keys — OFF',
    description: 'Desativa Sticky Keys (atalhos fixos do Windows)',
    category: 'accessibility',
    level: 'medio',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Accessibility\\StickyKeys',
    key: 'Flags',
    kind: 'String',
    defaultValue: '510',
    optimizedValue: '506',
  },
  {
    id: 'toggle-keys-off',
    name: 'Toggle Keys — OFF',
    description: 'Desativa Toggle Keys (sinal sonoro ao travar teclas)',
    category: 'accessibility',
    level: 'medio',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Accessibility\\ToggleKeys',
    key: 'Flags',
    kind: 'String',
    defaultValue: '62',
    optimizedValue: '58',
  },
  {
    id: 'filter-keys-off',
    name: 'Filter Keys — OFF',
    description: 'Desativa Filter Keys (ignora teclas rápidas repetidas)',
    category: 'accessibility',
    level: 'medio',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Accessibility\\Keyboard Response',
    key: 'Flags',
    kind: 'String',
    defaultValue: '126',
    optimizedValue: '122',
  },
  {
    id: 'mouse-keys-off',
    name: 'Mouse Keys — OFF',
    description: 'Desativa Mouse Keys (controle do mouse pelo teclado)',
    category: 'accessibility',
    level: 'medio',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Accessibility\\MouseKeys',
    key: 'Flags',
    kind: 'String',
    defaultValue: '62',
    optimizedValue: '0',
  },

  // Network
  {
    id: 'tcp-no-delay',
    name: 'TCP No Delay — ON',
    description: 'Desativa algoritmo Nagle (envio imediato de pacotes TCP)',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TCPNoDelay',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'tcp-ack-freq',
    name: 'TCP Ack Frequency — 1',
    description: 'Reduz ACKs para 1 por pacote (menor latência de rede)',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces',
    key: 'TcpAckFrequency',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 1,
  },
  {
    id: 'tcp-no-delay-iface',
    name: 'TCP No Delay (Interfaces)',
    description: 'Desativa Nagle em cada interface de rede individualmente',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces',
    key: 'TCPNoDelay',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'default-ttl',
    name: 'Default TTL — 64',
    description: 'Ajusta TTL dos pacotes para 64 saltos',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'DefaultTTL',
    kind: 'DWord',
    defaultValue: 128,
    optimizedValue: 64,
  },
  {
    id: 'max-user-port',
    name: 'Max User Port — 65534',
    description: 'Expande portas disponíveis para 65534 (mais conexões simultâneas)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'MaxUserPort',
    kind: 'DWord',
    defaultValue: 5000,
    optimizedValue: 65534,
  },
  {
    id: 'tcp-1323-opts',
    name: 'TCP Window Scaling — ON',
    description: 'Ativa TCP Window Scaling (melhor throughput em alta latência)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'Tcp1323Opts',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'tcp-max-dup-acks',
    name: 'TCP Max Dup Acks — 2',
    description: 'Reduz ACKs duplicados para 2 (recuperação mais rápida)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TcpMaxDupAcks',
    kind: 'DWord',
    defaultValue: 3,
    optimizedValue: 2,
  },
  {
    id: 'tcp-timed-wait-delay',
    name: 'TCP Timed Wait Delay — 30s',
    description: 'Reduz espera de portas em TIME_WAIT para 30 segundos',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TcpTimedWaitDelay',
    kind: 'DWord',
    defaultValue: 120,
    optimizedValue: 30,
  },
  {
    id: 'network-throttling',
    name: 'Network Throttling Index — OFF',
    description: 'Remove limite de throttle de rede do Windows',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile',
    key: 'NetworkThrottlingIndex',
    kind: 'DWord',
    defaultValue: 10,
    optimizedValue: 4294967295,
  },
  {
    id: 'tcp-window-size',
    name: 'TCP Window Size — 65535',
    description: 'Aumenta janela TCP para 65535 bytes (melhor throughput)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TcpWindowSize',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 65535,
    needsReboot: true,
  },
  {
    id: 'global-max-tcp-window-size',
    name: 'Global Max TCP Window — 65535',
    description: 'Define janela TCP máxima global para 65535 bytes',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'GlobalMaxTcpWindowSize',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 65535,
    needsReboot: true,
  },
  {
    id: 'tcp-del-ack-ticks',
    name: 'TCP Delayed Ack Ticks — 0 (desligado)',
    description: 'Desativa ACK atrasado do TCP (ACK imediato)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces',
    key: 'TcpDelAckTicks',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 0,
  },
  {
    id: 'delivery-opt-off',
    name: 'Delivery Optimization (P2P) — OFF',
    description: 'Desativa compartilhamento P2P de atualizações do Windows',
    category: 'network',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config',
    key: 'DODownloadMode',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'qos-reservable-bw',
    name: 'QoS Reservable Bandwidth — 0% (desligado)',
    description: 'Libera 100% da banda de rede (remove reserva QoS de 20%)',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Psched',
    key: 'NonBestEffortLimit',
    kind: 'DWord',
    defaultValue: 20,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'ecn-capability',
    name: 'ECN — ON (ambos lados)',
    description: 'Ativa Explicit Congestion Notification (menos perda de pacotes)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'EnableECN',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 2,
    needsReboot: true,
  },
  {
    id: 'fast-send-datagram-threshold',
    name: 'UDP Fast Path — 65536 bytes',
    description: 'Aumenta limite do UDP fast path (menos latência em jogos/VoIP)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\AFD\\Parameters',
    key: 'FastSendDatagramThreshold',
    kind: 'DWord',
    defaultValue: 1024,
    optimizedValue: 65536,
    needsReboot: true,
  },
  {
    id: 'disable-ipv6',
    name: 'IPv6 — OFF (todas interfaces)',
    description: 'Desativa IPv6 em todas interfaces de rede',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters',
    key: 'DisabledComponents',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 255,
    needsReboot: true,
  },

  // GPU
  {
    id: 'hags-on',
    name: 'Hardware GPU Scheduling — ON',
    description: 'Ativa agendamento por hardware da GPU (reduz latência)',
    category: 'gpu',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    key: 'HwSchMode',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 2,
    needsReboot: true,
  },
  {
    id: 'mpo-overlay-minfps',
    name: 'MPO Overlay Min FPS — 0',
    description: 'Remove FPS mínimo de overlays MPO (experimental)',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows\\Dwm',
    key: 'OverlayMinFPS',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    experimental: true,
  },
  {
    id: 'vsync-global-off',
    name: 'VSync Global — OFF',
    description: 'Força VSync desligado globalmente em jogos DirectX',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_CURRENT_USER',
    path: 'SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences',
    key: 'DirectXUserGlobalSettings',
    kind: 'String',
    defaultValue: 'SwapEffectUpgradeCache=1;',
    optimizedValue: 'VSync=Off;SwapEffectUpgradeCache=1;',
  },
  {
    id: 'hw-accel-wpf',
    name: 'HW Acceleration WPF — ON',
    description: 'Ativa aceleração de hardware em apps WPF (mais desempenho)',
    category: 'gpu',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'SOFTWARE\\Microsoft\\Avalon.Graphics',
    key: 'DisableHWAcceleration',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'gpu-tdr-level',
    name: 'GPU TDR Level — 0 (desligado)',
    description: 'Desativa detecção de Timeout/Recovery da GPU',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    key: 'TdrLevel',
    kind: 'DWord',
    defaultValue: 3,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'gpu-tdr-delay',
    name: 'GPU TDR Delay — 8s',
    description: 'Aumenta timeout de recuperação da GPU para 8s (evita crashes)',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    key: 'TdrDelay',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 8,
    needsReboot: true,
  },
  {
    id: 'gpu-precise-mem-timing-off',
    name: 'Precise Memory Timing — OFF',
    description: 'Desativa temporização precisa de memória da GPU',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    key: 'DisablePreciseMemoryTiming',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'gpu-panel-self-refresh',
    name: 'Panel Self Refresh — OFF',
    description: 'Desativa refresh seletivo do painel (evita micro-stutters)',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    key: 'DisablePanelSelfRefresh',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'gpu-fclk-override',
    name: 'FCLK Override (AMD) — ON',
    description: 'Força FCLK AMD no máximo (experimental, só AMD)',
    category: 'gpu',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
    key: 'FCLKOverride',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
    experimental: true,
  },

  // System
  {
    id: 'menu-show-delay',
    name: 'Menu Show Delay — 0ms',
    description: 'Remove delay de abertura de menus no Windows',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Desktop',
    key: 'MenuShowDelay',
    kind: 'String',
    defaultValue: '400',
    optimizedValue: '0',
  },
  {
    id: 'win32-priority-sep',
    name: 'Win32 Priority Separation — 38',
    description: 'Ajusta separação de prioridade para melhor desempenho em jogos',
    category: 'system',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl',
    key: 'Win32PrioritySeparation',
    kind: 'DWord',
    defaultValue: 26,
    optimizedValue: 38,
  },
  {
    id: 'system-responsiveness',
    name: 'System Responsiveness — 0',
    description: 'Remove reserva de CPU para tarefas secundárias',
    category: 'system',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile',
    key: 'SystemResponsiveness',
    kind: 'DWord',
    defaultValue: 20,
    optimizedValue: 0,
  },
  {
    id: 'disable-paging-exec',
    name: 'Disable Paging Executive — 1',
    description: 'Mantém drivers do kernel fixos na RAM (sem swap para disco)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    key: 'DisablePagingExecutive',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'svchost-threshold',
    name: 'SvcHost Split Threshold — 64MB',
    description: 'Aumenta limite de split de serviços para 64MB',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control',
    key: 'SvcHostSplitThresholdInKB',
    kind: 'DWord',
    defaultValue: 3670016,
    optimizedValue: 67108864,
  },
  {
    id: 'explorer-delay',
    name: 'Explorer Startup Delay — 0ms',
    description: 'Remove delay de inicialização do Explorer',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize',
    key: 'StartupDelayInMSec',
    kind: 'DWord',
    defaultValue: 4000,
    optimizedValue: 0,
  },
  {
    id: 'transparency-off',
    name: 'Transparência — OFF',
    description: 'Desativa transparência do Windows (ganho leve de FPS)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
    key: 'EnableTransparency',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'ntfs-last-access-off',
    name: 'NTFS Last Access Update — OFF',
    description: 'Desativa atualização de data de último acesso no NTFS',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\FileSystem',
    key: 'NtfsDisableLastAccessUpdate',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'wait-to-kill-timeout',
    name: 'WaitToKillServiceTimeout — 2000ms',
    description: 'Reduz timeout de fechamento de serviços para 2s (desliga mais rápido)',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Desktop',
    key: 'WaitToKillServiceTimeout',
    kind: 'String',
    defaultValue: '5000',
    optimizedValue: '2000',
    needsLogoff: true,
  },
  {
    id: 'widgets-off',
    name: 'Widgets (Win11) — OFF',
    description: 'Remove botão de Widgets da barra de tarefas (Win11)',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Feeds',
    key: 'ShellFeedsTaskbarEnabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'news-interest-off',
    name: 'News & Interests — OFF',
    description: 'Remove Notícias e Interesses da barra de tarefas',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    key: 'TaskbarDa',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'min-animate-off',
    name: 'Animação de Janelas — OFF',
    description: 'Desativa animação de minimizar/maximizar janelas',
    category: 'system',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Control Panel\\Desktop\\WindowMetrics',
    key: 'MinAnimate',
    kind: 'String',
    defaultValue: '1',
    optimizedValue: '0',
  },
  {
    id: 'irq8-priority',
    name: 'IRQ8 (System Clock) Priority — 1',
    description: 'Prioriza IRQ do clock do sistema (reduz latência geral)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl',
    key: 'IRQ8Priority',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'vbs-hvci',
    name: 'VBS Hypervisor Code Integrity — OFF',
    description: 'Desativa integridade de código HVCI (Virtualization-Based Security)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity',
    key: 'Enabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'vbs-lsa-cfg',
    name: 'VBS LSA Credential Guard — OFF',
    description: 'Desativa Credential Guard (LSA) do VBS',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Lsa',
    key: 'LsaCfgFlags',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'vbs-enable',
    name: 'VBS Virtualization — OFF',
    description: 'Desativa Virtualization Based Security (recupera performance)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard',
    key: 'EnableVirtualizationBasedSecurity',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'pool-usage-maximum',
    name: 'PoolUsageMaximum — 80%',
    description: 'Aumenta pool do kernel para 80% (mais drivers em RAM, menos swap)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    key: 'PoolUsageMaximum',
    kind: 'DWord',
    defaultValue: 40,
    optimizedValue: 80,
    needsReboot: true,
  },
  {
    id: 'large-system-cache',
    name: 'LargeSystemCache — ON',
    description: 'Ativa cache grande de sistema (mais assets em RAM)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management',
    key: 'LargeSystemCache',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'hid-power-management',
    name: 'HID Power Save — OFF',
    description: 'Desativa economia de energia de mouse/teclado USB',
    category: 'system',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\HidUsb\\Parameters',
    key: 'DisableIdlePowerManagement',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'ntfs-8dot3-disable',
    name: 'NTFS 8.3 Names — OFF',
    description: 'Desativa criação de nomes 8.3 no NTFS (reduz I/O)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\FileSystem',
    key: 'NtfsDisable8dot3NameCreation',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'ntfs-mft-zone',
    name: 'NTFS MFT Zone — 400MB',
    description: 'Aumenta reserva da MFT para 400MB (menos fragmentação)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\FileSystem',
    key: 'NtfsMftZoneReservation',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 2,
    needsReboot: true,
  },
  {
    id: 'ntfs-tunnel-off',
    name: 'NTFS Tunneling — OFF',
    description: 'Desativa tunelamento NTFS (reduz metadados desnecessários)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\FileSystem',
    key: 'NtfsDisableTunneling',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },

  // Gaming
  {
    id: 'gamedvr-enabled',
    name: 'Game DVR — OFF',
    description: 'Desativa gravação de gameplay em segundo plano (Game DVR)',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'System\\GameConfigStore',
    key: 'GameDVR_Enabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'gamedvr-fse',
    name: 'Game DVR FSE Behavior — 2',
    description: 'Ativa modo exclusivo em tela cheia para jogos',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'System\\GameConfigStore',
    key: 'GameDVR_FSEBehaviorMode',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 2,
  },
  {
    id: 'gamedvr-honor-fse',
    name: 'Game DVR Honor FSE — 1',
    description: 'Respeita escolha de modo exclusivo em tela cheia do usuário',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'System\\GameConfigStore',
    key: 'GameDVR_HonorUserFSEBehaviorMode',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'gamedvr-dxgi',
    name: 'Game DVR DXGI FSE — 1',
    description: 'Permite DXGI em modo exclusivo de tela cheia',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'System\\GameConfigStore',
    key: 'GameDVR_DXGIHonorFSEWindowsCompatible',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'gamedvr-efse',
    name: 'Game DVR EFSE Flags — 0',
    description: 'Desativa flags experimentais do Game DVR',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'System\\GameConfigStore',
    key: 'GameDVR_EFSEFeatureFlags',
    kind: 'DWord',
    defaultValue: 3,
    optimizedValue: 0,
  },
  {
    id: 'app-capture-off',
    name: 'App Capture — OFF',
    description: 'Desativa captura de aplicativos em segundo plano',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
    key: 'AppCaptureEnabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'gamedvr-policy',
    name: 'Allow GameDVR (Policy) — 0',
    description: 'Desativa GameDVR via política de grupo (HKLM)',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR',
    key: 'AllowGameDVR',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'gamedvr-pm',
    name: 'Allow GameDVR (PolicyManager) — 0',
    description: 'Desativa GameDVR via PolicyManager (força política)',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\ApplicationManagement\\AllowGameDVR',
    key: 'value',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'auto-game-mode',
    name: 'Auto Game Mode — ON',
    description: 'Ativa Game Mode automático do Windows',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\GameBar',
    key: 'AutoGameModeEnabled',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'allow-auto-game-mode',
    name: 'Allow Auto Game Mode — ON',
    description: 'Permite ativação automática do Game Mode',
    category: 'gaming',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\GameBar',
    key: 'AllowAutoGameMode',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'perfopt-csgo',
    name: 'CPU Priority — CS2 (High)',
    description: 'Força prioridade Alta para o processo CS2.exe',
    category: 'gaming',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\cs2.exe\\PerfOptions',
    key: 'CpuPriorityClass',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 3,
  },
  {
    id: 'perfopt-fivem',
    name: 'CPU Priority — FiveM (High)',
    description: 'Força prioridade Alta para o processo FiveM.exe',
    category: 'gaming',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM.exe\\PerfOptions',
    key: 'CpuPriorityClass',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 3,
  },

  // Privacy
  {
    id: 'telemetria-off',
    name: 'Telemetria — OFF',
    description: 'Desativa coleta de dados de telemetria da Microsoft',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
    key: 'AllowTelemetry',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'background-apps',
    name: 'Background Apps — OFF',
    description: 'Desativa execução de apps em segundo plano',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications',
    key: 'GlobalUserDisabled',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'allow-cortana-off',
    name: 'Cortana — OFF',
    description: 'Desativa assistente Cortana',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    key: 'AllowCortana',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'start-suggested-content-off',
    name: 'Conteúdo Sugerido no Start — OFF',
    description: 'Remove conteúdo sugerido do Menu Iniciar',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    key: 'SubscribedContent-338388Enabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'recent-files-off',
    name: 'Arquivos Recentes no Start — OFF',
    description: 'Remove arquivos recentes do Menu Iniciar',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    key: 'Start_TrackDocs',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'lock-screen-ads-off',
    name: 'Anúncios Tela Bloqueio — OFF',
    description: 'Desativa anúncios e dicas na tela de bloqueio',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    key: 'RotatingLockScreenOverlayEnabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },

  // MMCSS
  {
    id: 'mmcss-gpu-priority',
    name: 'MMCSS GPU Priority — 8',
    description: 'Prioridade da GPU em jogos via MMCSS',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'GPU Priority',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 8,
  },
  {
    id: 'mmcss-priority',
    name: 'MMCSS CPU Priority — 6',
    description: 'Prioridade da CPU em jogos via MMCSS',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'Priority',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 6,
  },
  {
    id: 'mmcss-sched-cat',
    name: 'MMCSS Scheduling Category — High',
    description: 'Categoria de agendamento Alta para jogos',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'Scheduling Category',
    kind: 'String',
    defaultValue: 'Medium',
    optimizedValue: 'High',
  },
  {
    id: 'mmcss-sfio',
    name: 'MMCSS SFIO Priority — High',
    description: 'Prioridade de I/O Alta para jogos',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'SFIO Priority',
    kind: 'String',
    defaultValue: 'Normal',
    optimizedValue: 'High',
  },
  {
    id: 'mmcss-background',
    name: 'MMCSS Background Only — False',
    description: 'Impede que jogos sejam tratados como tarefa em segundo plano',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'Background Only',
    kind: 'String',
    defaultValue: 'True',
    optimizedValue: 'False',
  },
  {
    id: 'mmcss-affinity',
    name: 'MMCSS Affinity — 0 (todos cores)',
    description: 'Permite que jogos usem todos os núcleos da CPU',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'Affinity',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 0,
  },
  {
    id: 'mmcss-clock-rate',
    name: 'MMCSS Clock Rate — 10000 (1ms)',
    description: 'Clock rate de 1ms para jogos (timer mais preciso)',
    category: 'mmcss',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'Clock Rate',
    kind: 'DWord',
    defaultValue: 10000,
    optimizedValue: 10000,
  },
  {
    id: 'mmcss-nolazymode',
    name: 'MMCSS NoLazyMode — ON',
    description: 'Desativa modo lazy do MMCSS (threads de jogos nunca dormem)',
    category: 'mmcss',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games',
    key: 'NoLazyMode',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },

  // Energy
  {
    id: 'power-throttling-off',
    name: 'Power Throttling — OFF',
    description: 'Desativa throttling de energia do Windows para processos',
    category: 'energy',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling',
    key: 'PowerThrottlingOff',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
    needsReboot: true,
  },
  {
    id: 'hibernate-off',
    name: 'Hibernação — OFF',
    description: 'Desativa hibernação e deleta arquivo hiberfil.sys',
    category: 'energy',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Power',
    key: 'HibernateEnabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'pcie-aspm-off',
    name: 'PCIe ASPM — OFF',
    description: 'Desativa economia de energia PCIe (GPU e NVMe sempre ativos)',
    category: 'energy',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\ee19f59b-bb67-4979-a67f-5f16dfc4bcae\\0a717a8c-0a10-4e57-9b23-2b0ad0b32ec8',
    key: 'Default',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 0,
  },
  {
    id: 'usb-selective-suspend-off',
    name: 'USB Selective Suspend — OFF',
    description: 'Desativa suspensão seletiva de dispositivos USB',
    category: 'energy',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\2a737441-1930-4402-8d77-b2bebba308a3\\48e6b7a6-50f5-4782-a5d4-53bb8f07e226',
    key: 'Default',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'processor-min-max',
    name: 'CPU Min/Max — 100%',
    description: 'Força CPU sempre a 100% mínimo e máximo (remove economia)',
    category: 'energy',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c1-47b60b740d00\\893dee8e-2bef-41e0-89c6-b55d0929964c',
    key: 'Default',
    kind: 'DWord',
    defaultValue: 5,
    optimizedValue: 100,
  },
]

export function getCatalog(): WindowsTweakDef[] {
  return TWEAK_CATALOG
}

export function getCatalogByCategory(cat: WindowsTweakCategory): WindowsTweakDef[] {
  return TWEAK_CATALOG.filter((t) => t.category === cat)
}

async function runPsScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
    { timeout: 30000, windowsHide: true },
  )
  return stdout
}

const POWERCFG_TWEAKS = new Set(['pcie-aspm-off', 'usb-selective-suspend-off', 'processor-min-max'])

const POWERCFG_SETTINGS: Record<
  string,
  { subgroup: string; setting: string; applyValue: number; revertValue: number }[]
> = {
  'pcie-aspm-off': [
    {
      subgroup: 'ee19f59b-bb67-4979-a67f-5f16dfc4bcae',
      setting: '0a717a8c-0a10-4e57-9b23-2b0ad0b32ec8',
      applyValue: 0,
      revertValue: 2,
    },
  ],
  'usb-selective-suspend-off': [
    {
      subgroup: '2a737441-1930-4402-8d77-b2bebba308a3',
      setting: '48e6b7a6-50f5-4782-a5d4-53bb8f07e226',
      applyValue: 0,
      revertValue: 1,
    },
  ],
  'processor-min-max': [
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: '893dee8e-2bef-41e0-89c6-b55d0929964c',
      applyValue: 100,
      revertValue: 5,
    },
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: 'bc5038f7-23e0-4960-96da-33abaf5935ec',
      applyValue: 100,
      revertValue: 100,
    },
  ],
}

async function applyPowerCfgTweak(tweakId: string, action: 'apply' | 'revert'): Promise<void> {
  const settings = POWERCFG_SETTINGS[tweakId]
  if (!settings) throw new Error(`Unknown powercfg tweak: ${tweakId}`)
  const valueKey = action === 'apply' ? 'applyValue' : ('revertValue' as const)
  const basePowerKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings'

  // Get all power scheme GUIDs
  const listOut = await execFileAsync('powercfg', ['/LIST'], { timeout: 10000, windowsHide: true })
  const guids = [...listOut.stdout.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi)].map((m) => m[0])

  // Get active scheme GUID for reactivation
  const activeOut = await execFileAsync('powercfg', ['/GETACTIVESCHEME'], { timeout: 5000, windowsHide: true })
  const activeGuid = activeOut.stdout.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]

  for (const s of settings) {
    const val = s[valueKey]
    // Apply to ALL power schemes (not just scheme_current)
    for (const guid of guids) {
      await execFileAsync('powercfg', ['-setacvalueindex', guid, s.subgroup, s.setting, String(val)], {
        timeout: 10000,
        windowsHide: true,
      })
      await execFileAsync('powercfg', ['-setdcvalueindex', guid, s.subgroup, s.setting, String(val)], {
        timeout: 10000,
        windowsHide: true,
      })
    }
    // Also write registry Default so the value survives scheme reset
    await execFileAsync(
      'reg',
      [
        'add',
        `${basePowerKey}\\${s.subgroup}\\${s.setting}`,
        '/v',
        'Default',
        '/t',
        'REG_DWORD',
        '/d',
        String(val),
        '/f',
      ],
      { timeout: 10000, windowsHide: true },
    )
  }

  // Reactivate current scheme so the power manager reloads with new values
  if (activeGuid) {
    await execFileAsync('powercfg', ['/SETACTIVE', activeGuid], { timeout: 10000, windowsHide: true })
  }
}

async function checkPowerCfgTweak(tweakId: string, expectedValue: number): Promise<boolean> {
  const settings = POWERCFG_SETTINGS[tweakId]
  if (!settings || settings.length === 0) return false
  const { stdout: schemeOut } = await execFileAsync('powercfg', ['/GETACTIVESCHEME'], {
    timeout: 10000,
    windowsHide: true,
  })
  const guidMatch = schemeOut.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)
  if (!guidMatch) return false
  const schemeGuid = guidMatch[0]
  for (const s of settings) {
    let stdout: string
    try {
      const result = await execFileAsync('powercfg', ['-query', schemeGuid, s.subgroup, s.setting], {
        timeout: 10000,
        windowsHide: true,
      })
      stdout = result.stdout
    } catch {
      // Subgroup/setting GUID may not exist in the active power scheme
      // (e.g. PCIe ASPM on systems without that power setting).
      return false
    }
    const match = stdout.match(/Current AC Power Setting Index: 0x([0-9a-fA-F]+)/i)
    if (!match) return false
    if (Number.parseInt(match[1], 16) !== expectedValue) return false
  }
  return true
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
  return tweak.requiresAdmin ?? tweak.hive === 'HKEY_LOCAL_MACHINE'
}

/** Maps reg.exe stderr to a user-friendly error message */
function mapRegError(err: unknown, _tweak: WindowsTweakDef): string {
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
    if (POWERCFG_TWEAKS.has(tweak.id)) {
      await applyPowerCfgTweak(tweak.id, 'apply')
      return { ok: true }
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const value = typeof tweak.optimizedValue === 'string' ? tweak.optimizedValue : String(tweak.optimizedValue)
    const type = tweak.kind === 'DWord' ? 'REG_DWORD' : 'REG_SZ'

    await execFileAsync(
      'reg.exe',
      ['add', `${baseKey}\\${tweak.path}`, '/v', tweak.key, '/t', type, '/d', value, '/f'],
      { timeout: 10000, windowsHide: true },
    )

    // Apply via fsutil for NTFS Last Access (Windows-supported API)
    if (tweak.id === 'ntfs-last-access-off') {
      await execFileAsync('fsutil', ['behavior', 'set', 'disablelastaccess', value], {
        timeout: 10000,
        windowsHide: true,
      })
    }

    return { ok: true }
  } catch (err) {
    getLogger().error('windows-tweaks', `Apply failed: ${tweak.id} — ${mapRegError(err, tweak)}`)
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
    if (POWERCFG_TWEAKS.has(tweak.id)) {
      await applyPowerCfgTweak(tweak.id, 'revert')
      return { ok: true }
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const value = typeof tweak.defaultValue === 'string' ? tweak.defaultValue : String(tweak.defaultValue)
    const type = tweak.kind === 'DWord' ? 'REG_DWORD' : 'REG_SZ'

    await execFileAsync(
      'reg.exe',
      ['add', `${baseKey}\\${tweak.path}`, '/v', tweak.key, '/t', type, '/d', value, '/f'],
      { timeout: 10000, windowsHide: true },
    )

    // Revert via fsutil for NTFS Last Access
    if (tweak.id === 'ntfs-last-access-off') {
      await execFileAsync('fsutil', ['behavior', 'set', 'disablelastaccess', value], {
        timeout: 10000,
        windowsHide: true,
      })
    }

    return { ok: true }
  } catch (err) {
    getLogger().error('windows-tweaks', `Revert failed: ${tweak.id} — ${mapRegError(err, tweak)}`)
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
    if (POWERCFG_TWEAKS.has(tweak.id)) {
      return await checkPowerCfgTweak(tweak.id, Number(tweak.optimizedValue))
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const { stdout } = await execFileAsync('reg.exe', ['query', `${baseKey}\\${tweak.path}`, '/v', tweak.key], {
      timeout: 10000,
      windowsHide: true,
    })

    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const dataLine = lines.find((l) => l.includes(tweak.key))
    if (!dataLine) return false

    const match = dataLine.match(REG_TYPE_RE)
    if (!match) return false
    const valueStr = match[2]
    if (!valueStr) return false
    const trimmedValue = valueStr.trim()

    if (tweak.kind === 'DWord') {
      const actual = trimmedValue.startsWith('0x')
        ? Number.parseInt(trimmedValue, 16)
        : Number.parseInt(trimmedValue, 10)
      return actual === Number(tweak.optimizedValue)
    }
    return trimmedValue === String(tweak.optimizedValue)
  } catch (err) {
    getLogger().warning('windows-tweaks', `Check failed: ${tweak.id} — ${err}`)
    return false
  }
}

async function listTweakStatuses(): Promise<WindowsTweakState[]> {
  const statuses = await Promise.all(
    TWEAK_CATALOG.map(async (tweak) => {
      const applied = await checkTweakApplied(tweak)
      return { tweak, applied }
    }),
  )
  return statuses
}

export function registerWindowsTweaksIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINDOWS_TWEAKS_LIST, async () => {
    getLogger().info('windows-tweaks', 'Listing tweak statuses')
    return listTweakStatuses()
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_APPLY, async (_event, ids: string[]) => {
    getLogger().info('windows-tweaks', `Applying ${ids.length} tweaks`)
    const win = getWindow()
    const selected = TWEAK_CATALOG.filter((t) => ids.includes(t.id))
    let succeeded = 0
    const errors: { id: string; name: string; reason: string }[] = []
    const rebootRequired: { id: string; name: string }[] = []
    const logoffRequired: { id: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const tweak = selected[i]
      if (!tweak) continue
      win?.webContents.send(IPC.WINDOWS_TWEAKS_APPLY_PROGRESS, {
        current: i + 1,
        total: selected.length,
        currentTweak: tweak.name,
      } satisfies WindowsTweakApplyProgress)

      const result = await applyRegistryTweak(tweak)
      if (result.ok) {
        succeeded++
        getLogger().success('windows-tweaks', `Tweak applied: ${tweak.id}`)
        if (tweak.needsReboot) rebootRequired.push({ id: tweak.id, name: tweak.name })
        if (tweak.needsLogoff) logoffRequired.push({ id: tweak.id, name: tweak.name })
      } else {
        getLogger().error('windows-tweaks', `Tweak failed: ${tweak.id} — ${result.reason}`)
        errors.push({ id: tweak.id, name: tweak.name, reason: result.reason ?? 'Falha ao escrever no registro.' })
      }
    }

    getLogger().success('windows-tweaks', `Applied ${succeeded}/${selected.length} tweaks (${errors.length} failed)`)
    return { succeeded, failed: errors.length, errors, rebootRequired, logoffRequired } satisfies WindowsTweakResult
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_REVERT, async (_event, ids: string[]) => {
    getLogger().info('windows-tweaks', `Reverting ${ids.length} tweaks`)
    const win = getWindow()
    const selected = TWEAK_CATALOG.filter((t) => ids.includes(t.id))
    let succeeded = 0
    const errors: { id: string; name: string; reason: string }[] = []
    const rebootRequired: { id: string; name: string }[] = []
    const logoffRequired: { id: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const tweak = selected[i]
      if (!tweak) continue
      win?.webContents.send(IPC.WINDOWS_TWEAKS_REVERT_PROGRESS, {
        current: i + 1,
        total: selected.length,
        currentTweak: tweak.name,
      } satisfies WindowsTweakApplyProgress)

      const result = await revertRegistryTweak(tweak)
      if (result.ok) {
        succeeded++
        getLogger().success('windows-tweaks', `Tweak reverted: ${tweak.id}`)
        if (tweak.needsReboot) rebootRequired.push({ id: tweak.id, name: tweak.name })
        if (tweak.needsLogoff) logoffRequired.push({ id: tweak.id, name: tweak.name })
      } else {
        getLogger().error('windows-tweaks', `Revert failed: ${tweak.id} — ${result.reason}`)
        errors.push({ id: tweak.id, name: tweak.name, reason: result.reason ?? 'Falha ao reverter o registro.' })
      }
    }

    getLogger().success('windows-tweaks', `Reverted ${succeeded}/${selected.length} tweaks (${errors.length} failed)`)
    return { succeeded, failed: errors.length, errors, rebootRequired, logoffRequired } satisfies WindowsTweakResult
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_STATUS, async () => {
    getLogger().info('windows-tweaks', 'Status requested via IPC')
    return listTweakStatuses()
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_GET_DNS, async () => {
    getLogger().info('windows-tweaks', 'DNS presets requested')
    return DNS_PRESETS
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_SET_DNS, async (_event, primary: string, secondary?: string) => {
    getLogger().info('windows-tweaks', `Setting DNS: ${primary}${secondary ? ` / ${secondary}` : ''}`)
    try {
      const plat = getPlatform()
      if (plat.network.setDnsServer) {
        const result = await plat.network.setDnsServer(primary, secondary)
        if (result) getLogger().success('windows-tweaks', 'DNS set successfully')
        else getLogger().error('windows-tweaks', 'Failed to set DNS server')
        return result
      }
      getLogger().warning('windows-tweaks', 'setDnsServer not available on this platform')
      return false
    } catch (err) {
      getLogger().error('windows-tweaks', `DNS set failed: ${err}`)
      return false
    }
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_NETSH_TCP,
    async (_event, action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('windows-tweaks', `netsh TCP global: ${action}`)
      try {
        const script =
          action === 'apply'
            ? `
          $e = $null
          try { netsh int tcp set global autotuning=normal } catch { $e = $_ }
          try { netsh int tcp set global chimney=disabled } catch { $e = $_ }
          try { netsh int tcp set global rss=enabled } catch { $e = $_ }
          try { netsh int tcp set global timestamps=disabled } catch { $e = $_ }
          try { netsh int tcp set global initialRto=2000 } catch { $e = $_ }
          if ($e) { Write-Output "ERROR: $e" } else { Write-Output "OK" }
        `
            : `
          try { netsh int tcp set global autotuning=normal } catch {}
          try { netsh int tcp set global chimney=enabled } catch {}
          try { netsh int tcp set global rss=default } catch {}
          try { netsh int tcp set global timestamps=default } catch {}
          try { netsh int tcp set global initialRto=3000 } catch {}
          Write-Output "OK"
        `
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
          { timeout: 30000, windowsHide: true },
        )

        if (stdout.includes('ERROR')) {
          getLogger().error('windows-tweaks', `netsh TCP failed: ${stdout}`)
          return { success: false, error: stdout.replace('ERROR: ', '').trim() }
        }
        getLogger().success('windows-tweaks', `netsh TCP ${action} concluído`)
        return { success: true }
      } catch (err) {
        getLogger().error('windows-tweaks', `netsh TCP ${action} error: ${err}`)
        return { success: false, error: String(err) }
      }
    },
  )
}
