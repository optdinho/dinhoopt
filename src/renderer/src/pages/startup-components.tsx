import type { StartupItem } from '@shared/types'
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export const impactStyles: Record<StartupItem['impact'], { bg: string; text: string }> = {
  high: { bg: 'rgba(239,68,68,0.08)', text: '#ef4444' },
  medium: { bg: 'rgba(245,158,11,0.08)', text: '#f59e0b' },
  low: { bg: 'rgba(34,197,94,0.08)', text: '#22c55e' },
  none: { bg: 'var(--bg-subtle-2)', text: 'var(--text-muted)' },
}

export const impactBarColors: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
}

export const sourceKeys: Record<StartupItem['source'], string> = {
  'registry-hkcu': 'sourceUserRegistry',
  'registry-hklm': 'sourceSystemRegistry',
  'startup-folder': 'sourceStartupFolder',
  'task-scheduler': 'sourceTaskScheduler',
  'launch-agent-user': 'sourceLaunchAgentUser',
  'launch-agent-global': 'sourceLaunchAgentGlobal',
  'login-item': 'sourceLoginItem',
  'systemd-user': 'sourceSystemdUser',
  'autostart-desktop': 'sourceAutostartDesktop',
  cron: 'sourceCron',
}

export function safetyScoreColor(score: number): { bg: string; text: string } {
  if (score >= 8) return { bg: 'rgba(34,197,94,0.10)', text: '#22c55e' }
  if (score >= 5) return { bg: 'rgba(245,158,11,0.10)', text: '#f59e0b' }
  if (score >= 3) return { bg: 'rgba(249,115,22,0.10)', text: '#f97316' }
  return { bg: 'rgba(239,68,68,0.10)', text: '#ef4444' }
}

export function safetyIcon(score: number) {
  if (score >= 8) return ShieldCheck
  if (score >= 5) return Shield
  return ShieldAlert
}

export function SafetyTooltip({ children, text }: { children: React.ReactNode; text: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-medium pointer-events-none z-50 shadow-lg"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          {text}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid var(--border-strong)',
            }}
          />
        </div>
      )}
    </div>
  )
}

export function formatMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

export function StatMini({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType
  label: string
  value: string
  color: string
}) {
  return (
    <div
      className="rounded-xl p-3.5"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color }} strokeWidth={1.8} />
        <span className="text-[11px] text-zinc-500">{label}</span>
      </div>
      <span className="text-[18px] font-semibold text-zinc-200">{value}</span>
    </div>
  )
}

interface BootTrace {
  available: boolean
  needsAdmin?: boolean
  totalBootMs: number
  mainPathMs: number
  startupAppsMs: number
  lastBootDate?: string
  entries: Array<{ displayName: string; delayMs: number; impact: string }>
}

export function BootTracePanel({ trace, loading }: { trace: BootTrace | null; loading: boolean }) {
  const { t } = useTranslation('startup')
  const [expanded, setExpanded] = useState(true)

  if (loading) {
    return (
      <div
        className="mb-5 rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
          <span className="text-[13px] text-zinc-500">{t('bootTraceAnalyzing')}</span>
        </div>
      </div>
    )
  }

  if (!trace?.available) {
    return (
      <div
        className="mb-5 rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3 text-zinc-500">
          <BarChart3 className="h-4.5 w-4.5" strokeWidth={1.8} />
          <span className="text-[13px]">
            {trace?.needsAdmin ? t('bootTraceNeedsAdmin') : t('bootTraceNotAvailable')}
          </span>
        </div>
      </div>
    )
  }

  const barData = trace.entries.slice(0, 15).map((e) => {
    const clean = e.displayName.replace(/\.exe$/i, '')
    return {
      name: clean.length > 18 ? `${clean.slice(0, 16)}…` : clean,
      fullName: clean,
      delay: e.delayMs,
      impact: e.impact,
    }
  })

  const pieData = [
    { name: t('pieCoreBoot'), value: Math.max(0, trace.mainPathMs - trace.startupAppsMs), fill: '#3b82f6' },
    { name: t('pieStartupApps'), value: trace.startupAppsMs, fill: '#f59e0b' },
    { name: t('pieOther'), value: Math.max(0, trace.totalBootMs - trace.mainPathMs), fill: 'var(--bg-overlay)' },
  ].filter((d) => d.value > 0)

  const highCount = trace.entries.filter((e) => e.impact === 'high').length
  const potentialSavings = trace.entries.filter((e) => e.impact === 'high').reduce((s, e) => s + e.delayMs, 0)

  return (
    <div
      className="mb-5 rounded-2xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-white/2"
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'rgba(245,158,11,0.1)' }}
          >
            <Activity className="h-4.5 w-4.5" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-zinc-200">{t('bootTraceTitle')}</h3>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {trace.lastBootDate
                ? t('bootTraceLastBoot', {
                    date: new Date(trace.lastBootDate).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })
                : t('bootTraceBasedOnLastBoot')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-4 text-[12px]">
            <span className="text-zinc-500">
              {t('bootTraceTotalBoot')}{' '}
              <span className="font-semibold text-zinc-300">{formatMs(trace.totalBootMs)}</span>
            </span>
            {highCount > 0 && (
              <span className="text-red-400/80">
                {highCount === 1
                  ? t('bootTraceHighImpactApp', { count: highCount })
                  : t('bootTraceHighImpactApps', { count: highCount })}
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-600" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-600" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5">
          {/* Stat cards row */}
          <div className="grid grid-cols-2 gap-3 mb-5 sm:grid-cols-4">
            <StatMini icon={Clock} label={t('statTotalBootTime')} value={formatMs(trace.totalBootMs)} color="#3b82f6" />
            <StatMini
              icon={Zap}
              label={t('statStartupAppsDelay')}
              value={formatMs(trace.startupAppsMs)}
              color="#f59e0b"
            />
            <StatMini
              icon={Activity}
              label={t('statAppsMeasured')}
              value={String(trace.entries.length)}
              color="#8b5cf6"
            />
            <StatMini
              icon={TrendingDown}
              label={t('statPotentialSavings')}
              value={potentialSavings > 0 ? formatMs(potentialSavings) : '—'}
              color="#22c55e"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Bar chart — per-app delay */}
            <div
              className="lg:col-span-2 rounded-xl p-4"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
            >
              <h4 className="mb-3 text-[12px] font-medium text-zinc-400">{t('chartBootTimeImpact')}</h4>
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 32 + 20)}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <XAxis
                      type="number"
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      tickFormatter={(v: number) => formatMs(v)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      width={130}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--bg-subtle)' }}
                      contentStyle={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 12,
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                      }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                      itemStyle={{ color: 'var(--text-secondary)' }}
                      formatter={(value: unknown) => [formatMs(value as number), t('chartTooltipDelay')]}
                      labelFormatter={(label: unknown, payload: readonly { payload?: { fullName?: string } }[]) =>
                        payload?.[0]?.payload?.fullName || String(label)
                      }
                    />
                    <Bar dataKey="delay" radius={[0, 6, 6, 0]} maxBarSize={22}>
                      {barData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={impactBarColors[entry.impact] || 'var(--text-muted)'}
                          fillOpacity={0.85}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[200px] items-center justify-center text-[13px] text-zinc-600">
                  {t('chartNoPerAppData')}
                </div>
              )}
            </div>

            {/* Pie chart — boot time breakdown */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
            >
              <h4 className="mb-3 text-[12px] font-medium text-zinc-400">{t('chartBootTimeBreakdown')}</h4>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 12,
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-secondary)' }}
                    formatter={(value: unknown) => [formatMs(value as number), '']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-sm" style={{ background: d.fill }} />
                      <span className="text-zinc-400">{d.name}</span>
                    </div>
                    <span className="font-mono text-zinc-500">{formatMs(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
