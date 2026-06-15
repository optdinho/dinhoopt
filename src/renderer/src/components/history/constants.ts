import type { HistoryEntryType } from '@shared/types'
import {
  Bug,
  ClipboardCheck,
  Cookie,
  Cpu,
  Database,
  Download,
  PackageMinus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wifi,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ViewMode = 'overview' | 'timeline'

export interface TypeConfig {
  labelKey: string
  icon: LucideIcon
  color: string
  bg: string
}

export const typeConfigBase: Record<HistoryEntryType, TypeConfig> = {
  cleaner: { labelKey: 'typeLabels.cleaner', icon: Sparkles, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  registry: { labelKey: 'typeLabels.registry', icon: Database, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  debloater: { labelKey: 'typeLabels.debloater', icon: PackageMinus, color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
  network: { labelKey: 'typeLabels.network', icon: Wifi, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  drivers: { labelKey: 'typeLabels.drivers', icon: Cpu, color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  malware: { labelKey: 'typeLabels.malware', icon: Bug, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  privacy: { labelKey: 'typeLabels.privacy', icon: ShieldCheck, color: '#14b8a6', bg: 'rgba(20,184,166,0.1)' },
  startup: { labelKey: 'typeLabels.startup', icon: Zap, color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
  services: { labelKey: 'typeLabels.services', icon: Settings2, color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
  'software-update': {
    labelKey: 'typeLabels.softwareUpdate',
    icon: RefreshCw,
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.1)',
  },
  compliance: {
    labelKey: 'typeLabels.compliance',
    icon: ClipboardCheck,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.1)',
  },
  vulnerability: { labelKey: 'typeLabels.vulnerability', icon: Bug, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  'delivery-optimization': {
    labelKey: 'typeLabels.deliveryOptimization',
    icon: Download,
    color: '#0ea5e9',
    bg: 'rgba(14,165,233,0.1)',
  },
  cookie: { labelKey: 'typeLabels.cookie', icon: Cookie, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
}

export const PIE_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#6366f1']
