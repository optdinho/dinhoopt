import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { formatBytes } from '@/lib/utils'
import type { ScanHistoryEntry } from '@shared/types'
import { BarChart3, Clock, HardDrive, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MiniStat } from './MiniStat'
import { RecentScanRow } from './RecentScanRow'
import { PIE_COLORS } from './constants'
import { formatDuration } from './formatDuration'

export function OverviewView({
  stats,
  timelineData,
  typeBreakdown,
  categoryBreakdown,
  weeklyData,
  entries,
}: {
  stats: { totalSpace: number; totalItems: number; totalErrors: number; avgDuration: number; totalScans: number }
  timelineData: { date: string; space: number; items: number }[]
  typeBreakdown: { name: string; count: number; space: number; items: number }[]
  categoryBreakdown: { name: string; items: number; space: number }[]
  weeklyData: { week: string; space: number; items: number; count: number }[]
  entries: ScanHistoryEntry[]
}) {
  const { t } = useTranslation('history')
  return (
    <>
      <StaggerContainer className="mb-5 grid grid-cols-4 gap-3">
        <StaggerItem>
          <MiniStat
            icon={BarChart3}
            label={t('overview.totalScans')}
            value={stats.totalScans.toString()}
            color="#f59e0b"
          />
        </StaggerItem>
        <StaggerItem>
          <MiniStat
            icon={HardDrive}
            label={t('overview.spaceRecovered')}
            value={formatBytes(stats.totalSpace)}
            color="#22c55e"
          />
        </StaggerItem>
        <StaggerItem>
          <MiniStat
            icon={TrendingUp}
            label={t('overview.itemsProcessed')}
            value={stats.totalItems.toLocaleString()}
            color="#3b82f6"
          />
        </StaggerItem>
        <StaggerItem>
          <MiniStat
            icon={Clock}
            label={t('overview.avgDuration')}
            value={formatDuration(stats.avgDuration, t)}
            color="#a855f7"
          />
        </StaggerItem>
      </StaggerContainer>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div
          className="col-span-2 rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.spaceRecoveredOverTime')}
          </h3>
          {timelineData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="spaceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatBytes(v as number, 0)}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-stronger)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  formatter={(value) => [formatBytes(Number(value)), t('overview.tooltipSpace')]}
                />
                <Area
                  type="monotone"
                  dataKey="space"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="url(#spaceGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#f59e0b' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="flex h-[220px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.needTwoScansForChart')}
            </div>
          )}
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.scanTypeDistribution')}
          </h3>
          {typeBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={typeBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={60}
                    dataKey="count"
                    stroke="none"
                  >
                    {typeBreakdown.map((item, idx) => (
                      <Cell key={item.name || idx} fill={PIE_COLORS[idx % PIE_COLORS.length] ?? '#888'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-stronger)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value) => [Number(value), t('overview.tooltipScans')]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {typeBreakdown.map((item, i) => (
                  <div key={`${item.name}-${i}`} className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="flex-1 text-[12px] text-zinc-400">{item.name}</span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              className="flex h-[200px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.noData')}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4">
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.topCategoriesBySpace')}
          </h3>
          {categoryBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryBreakdown} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatBytes(v as number, 0)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-stronger)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value) => [formatBytes(Number(value)), t('overview.tooltipSpace')]}
                />
                <Bar dataKey="space" radius={[0, 6, 6, 0]}>
                  {categoryBreakdown.map((item, idx) => (
                    <Cell
                      key={item.name || idx}
                      fill={PIE_COLORS[idx % PIE_COLORS.length] ?? '#888'}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="flex h-[220px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.noCategoryData')}
            </div>
          )}
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.weeklyActivity')}
          </h3>
          {weeklyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                <XAxis
                  dataKey="week"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-stronger)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  formatter={(value, name) => [
                    name === 'count' ? Number(value) : formatBytes(Number(value)),
                    name === 'count' ? t('overview.tooltipScans') : t('overview.tooltipSpace'),
                  ]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} fillOpacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="flex h-[220px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.needTwoWeeksData')}
            </div>
          )}
        </div>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('overview.recentScans')}
        </h3>
        <StaggerContainer className="space-y-2">
          {entries.slice(0, 5).map((entry) => (
            <StaggerItem key={entry.id}>
              <RecentScanRow entry={entry} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </>
  )
}
