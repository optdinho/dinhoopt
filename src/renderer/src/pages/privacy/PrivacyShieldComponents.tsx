import type { PrivacySetting } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import {
  BrainCircuit,
  CalendarClock,
  Compass,
  Cpu,
  Eye,
  Globe,
  Lock,
  Megaphone,
  Radio,
  RefreshCw,
  Search,
  CameraOff,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface CategoryDef {
  id: PrivacySetting['category']
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

export const categories: CategoryDef[] = [
  {
    id: 'telemetry',
    labelKey: 'privacyCategories.telemetryLabel',
    descriptionKey: 'privacyCategories.telemetryDescription',
    icon: Radio,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.15)',
  },
  {
    id: 'ads',
    labelKey: 'privacyCategories.adsLabel',
    descriptionKey: 'privacyCategories.adsDescription',
    icon: Megaphone,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.15)',
  },
  {
    id: 'search',
    labelKey: 'privacyCategories.searchLabel',
    descriptionKey: 'privacyCategories.searchDescription',
    icon: Search,
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.15)',
  },
  {
    id: 'sync',
    labelKey: 'privacyCategories.syncLabel',
    descriptionKey: 'privacyCategories.syncDescription',
    icon: RefreshCw,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    border: 'rgba(139,92,246,0.15)',
  },
  {
    id: 'services',
    labelKey: 'privacyCategories.servicesLabel',
    descriptionKey: 'privacyCategories.servicesDescription',
    icon: Eye,
    color: '#14b8a6',
    bg: 'rgba(20,184,166,0.08)',
    border: 'rgba(20,184,166,0.15)',
  },
  {
    id: 'tasks',
    labelKey: 'privacyCategories.tasksLabel',
    descriptionKey: 'privacyCategories.tasksDescription',
    icon: CalendarClock,
    color: '#a3e635',
    bg: 'rgba(163,230,53,0.08)',
    border: 'rgba(163,230,53,0.15)',
  },
  {
    id: 'kernel',
    labelKey: 'privacyCategories.kernelLabel',
    descriptionKey: 'privacyCategories.kernelDescription',
    icon: Cpu,
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.08)',
    border: 'rgba(168,85,247,0.15)',
  },
  {
    id: 'network',
    labelKey: 'privacyCategories.networkLabel',
    descriptionKey: 'privacyCategories.networkDescription',
    icon: Globe,
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.08)',
    border: 'rgba(6,182,212,0.15)',
  },
  {
    id: 'access',
    labelKey: 'privacyCategories.accessLabel',
    descriptionKey: 'privacyCategories.accessDescription',
    icon: Lock,
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.15)',
  },
  {
    id: 'ai',
    labelKey: 'privacyCategories.aiLabel',
    descriptionKey: 'privacyCategories.aiDescription',
    icon: BrainCircuit,
    color: '#ec4899',
    bg: 'rgba(236,72,153,0.08)',
    border: 'rgba(236,72,153,0.15)',
  },
  {
    id: 'recall',
    labelKey: 'privacyCategories.recallLabel',
    descriptionKey: 'privacyCategories.recallDescription',
    icon: CameraOff,
    color: '#f43f5e',
    bg: 'rgba(244,63,94,0.08)',
    border: 'rgba(244,63,94,0.15)',
  },
  {
    id: 'browser',
    labelKey: 'privacyCategories.browserLabel',
    descriptionKey: 'privacyCategories.browserDescription',
    icon: Compass,
    color: '#0ea5e9',
    bg: 'rgba(14,165,233,0.08)',
    border: 'rgba(14,165,233,0.15)',
  },
]

export function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const { t } = useTranslation('hardening')
  const r = (size - 6) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={t('scoreGaugeAria')}>
        <title>{t('scoreGaugeAria')}</title>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gauge-track)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[20px] font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>
          / 100
        </span>
      </div>
    </div>
  )
}
