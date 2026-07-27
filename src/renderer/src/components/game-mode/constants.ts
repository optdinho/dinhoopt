import type { GameModeCategory, GameModeOptimizationId } from '@shared/types'
import { Cpu, MemoryStick, Monitor, Server, Wifi } from 'lucide-react'
import type { CategoryDef, OptimizationDef } from './types'

export const OPTIMIZATIONS: OptimizationDef[] = [
  {
    id: 'svc-wsearch' as GameModeOptimizationId,
    category: 'services' as GameModeCategory,
    labelKey: 'optSvcWsearch',
    descKey: 'optSvcWsearchDesc',
    requiresAdmin: true,
  },
  {
    id: 'svc-sysmain' as GameModeOptimizationId,
    category: 'services' as GameModeCategory,
    labelKey: 'optSvcSysmain',
    descKey: 'optSvcSysmainDesc',
    requiresAdmin: true,
  },
  {
    id: 'svc-wuauserv' as GameModeOptimizationId,
    category: 'services' as GameModeCategory,
    labelKey: 'optSvcWuauserv',
    descKey: 'optSvcWuauservDesc',
    requiresAdmin: true,
  },
  {
    id: 'svc-spooler' as GameModeOptimizationId,
    category: 'services' as GameModeCategory,
    labelKey: 'optSvcSpooler',
    descKey: 'optSvcSpoolerDesc',
    requiresAdmin: true,
  },
  {
    id: 'svc-diagtrack' as GameModeOptimizationId,
    category: 'services' as GameModeCategory,
    labelKey: 'optSvcDiagtrack',
    descKey: 'optSvcDiagtrackDesc',
    requiresAdmin: true,
  },
  {
    id: 'proc-kill-browsers' as GameModeOptimizationId,
    category: 'processes' as GameModeCategory,
    labelKey: 'optProcBrowsers',
    descKey: 'optProcBrowsersDesc',
    requiresAdmin: false,
  },
  {
    id: 'proc-kill-chat' as GameModeOptimizationId,
    category: 'processes' as GameModeCategory,
    labelKey: 'optProcChat',
    descKey: 'optProcChatDesc',
    requiresAdmin: false,
  },
  {
    id: 'proc-kill-updaters' as GameModeOptimizationId,
    category: 'processes' as GameModeCategory,
    labelKey: 'optProcUpdaters',
    descKey: 'optProcUpdatersDesc',
    requiresAdmin: false,
  },
  {
    id: 'proc-kill-background' as GameModeOptimizationId,
    category: 'processes' as GameModeCategory,
    labelKey: 'optProcBackground',
    descKey: 'optProcBackgroundDesc',
    requiresAdmin: false,
  },
  {
    id: 'proc-kill-custom' as GameModeOptimizationId,
    category: 'processes' as GameModeCategory,
    labelKey: 'optProcCustom',
    descKey: 'optProcCustomDesc',
    requiresAdmin: false,
  },
  {
    id: 'mem-clear-standby' as GameModeOptimizationId,
    category: 'memory' as GameModeCategory,
    labelKey: 'optMemStandby',
    descKey: 'optMemStandbyDesc',
    requiresAdmin: false,
  },
  {
    id: 'mem-empty-working-set' as GameModeOptimizationId,
    category: 'memory' as GameModeCategory,
    labelKey: 'optMemEmptyWorkingSet',
    descKey: 'optMemEmptyWorkingSetDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-focus-assist' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysFocusAssist',
    descKey: 'optSysFocusAssistDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-power-plan' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysPowerPlan',
    descKey: 'optSysPowerPlanDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-prevent-sleep' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysPreventSleep',
    descKey: 'optSysPreventSleepDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-disable-game-bar' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysGameBar',
    descKey: 'optSysGameBarDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-disable-fse-opt' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysFseOpt',
    descKey: 'optSysFseOptDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-disable-transparency' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysTransparency',
    descKey: 'optSysTransparencyDesc',
    requiresAdmin: false,
  },
  {
    id: 'sys-timer-resolution' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optSysTimerRes',
    descKey: 'optSysTimerResDesc',
    requiresAdmin: false,
  },
  {
    id: 'cpu-game-priority' as GameModeOptimizationId,
    category: 'system' as GameModeCategory,
    labelKey: 'optCpuGamePriority',
    descKey: 'optCpuGamePriorityDesc',
    requiresAdmin: false,
  },
  {
    id: 'net-flush-dns' as GameModeOptimizationId,
    category: 'network' as GameModeCategory,
    labelKey: 'optNetFlushDns',
    descKey: 'optNetFlushDnsDesc',
    requiresAdmin: false,
  },
  {
    id: 'net-disable-nagle' as GameModeOptimizationId,
    category: 'network' as GameModeCategory,
    labelKey: 'optNetNagle',
    descKey: 'optNetNagleDesc',
    requiresAdmin: true,
  },
]

export const OPTIMIZATION_SERVICE_MAP: Record<string, string> = {
  'svc-wsearch': 'WSearch',
  'svc-sysmain': 'SysMain',
  'svc-wuauserv': 'wuauserv',
  'svc-spooler': 'Spooler',
  'svc-diagtrack': 'DiagTrack',
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'services' as GameModeCategory,
    labelKey: 'categoryServices',
    descKey: 'categoryServicesDesc',
    icon: Server,
    color: '#06b6d4',
    glow: 'rgba(6,182,212,0.12)',
  },
  {
    id: 'processes' as GameModeCategory,
    labelKey: 'categoryProcesses',
    descKey: 'categoryProcessesDesc',
    icon: Cpu,
    color: '#8b5cf6',
    glow: 'rgba(139,92,246,0.12)',
  },
  {
    id: 'memory' as GameModeCategory,
    labelKey: 'categoryMemory',
    descKey: 'categoryMemoryDesc',
    icon: MemoryStick,
    color: '#22c55e',
    glow: 'rgba(34,197,94,0.12)',
  },
  {
    id: 'system' as GameModeCategory,
    labelKey: 'categorySystem',
    descKey: 'categorySystemDesc',
    icon: Monitor,
    color: '#f59e0b',
    glow: 'rgba(245,158,11,0.12)',
  },
  {
    id: 'network' as GameModeCategory,
    labelKey: 'categoryNetwork',
    descKey: 'categoryNetworkDesc',
    icon: Wifi,
    color: '#ec4899',
    glow: 'rgba(236,72,153,0.12)',
  },
]

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
