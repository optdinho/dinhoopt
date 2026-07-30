import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { AlertBanner } from '@/components/perf/AlertBanner'
import { DiskHealthPanel } from '@/components/perf/DiskHealthPanel'
import { GaugeCard } from '@/components/perf/GaugeCard'
import { ProcessTable } from '@/components/perf/ProcessTable'
import { SystemInfoHeader } from '@/components/perf/SystemInfoHeader'
import { TimeSeriesChart } from '@/components/perf/TimeSeriesChart'
import { cn, formatBytes, formatSpeed } from '@/lib/utils'
import { usePerfStore } from '@/stores/perf-store'

export function PerformanceMonitorPage() {
  const { t } = useTranslation('performance')
  const systemInfo = usePerfStore((s) => s.systemInfo)
  const snapshot = usePerfStore((s) => s.currentSnapshot)
  const history = usePerfStore((s) => s.history)
  const timeRange = usePerfStore((s) => s.timeRange)
  const setSystemInfo = usePerfStore((s) => s.setSystemInfo)
  const pushSnapshot = usePerfStore((s) => s.pushSnapshot)
  const setProcessList = usePerfStore((s) => s.setProcessList)
  const diskHealth = usePerfStore((s) => s.diskHealth)
  const setDiskHealth = usePerfStore((s) => s.setDiskHealth)
  const setMonitoring = usePerfStore((s) => s.setMonitoring)
  const setTimeRange = usePerfStore((s) => s.setTimeRange)
  const reset = usePerfStore((s) => s.reset)

  const [paused, setPaused] = useState(false)

  // Start monitoring on mount — subscribe + start first, load systemInfo/diskHealth in background
  useEffect(() => {
    let snapshotUnsub: (() => void) | undefined
    let processUnsub: (() => void) | undefined
    let cancelled = false

    const start = async () => {
      try {
        // 1. Subscribe to events + start monitoring immediately — gauges appear in ~1s
        snapshotUnsub = window.dinho.onPerfSnapshot((data) => {
          pushSnapshot(data)
        })

        processUnsub = window.dinho.onPerfProcessList((data) => {
          setProcessList(data.processes, data.totalCount)
        })

        await window.dinho.perfStartMonitoring()
        window.dinho.perfStartProcessPolling()
        setMonitoring(true)

        // 2. Load system info + disk health in background (non-blocking, ~2-5s)
        window.dinho
          .perfGetSystemInfo()
          .then((info) => {
            if (!cancelled) setSystemInfo(info)
          })
          .catch(() => {})

        window.dinho
          .perfGetDiskHealth()
          .then((disks) => {
            if (!cancelled) setDiskHealth(disks)
          })
          .catch(() => {})
      } catch {
        if (!cancelled) toast.error(t('failedToStartToast'))
      }
    }

    start()

    return () => {
      cancelled = true
      snapshotUnsub?.()
      processUnsub?.()
      window.dinho.perfStopMonitoring().catch(() => {})
      reset()
    }
  }, [t, reset, pushSnapshot, setProcessList, setSystemInfo, setDiskHealth, setMonitoring])

  const togglePause = useCallback(async () => {
    if (paused) {
      await window.dinho.perfStartMonitoring()
      window.dinho.perfStartProcessPolling()
      setPaused(false)
    } else {
      await window.dinho.perfStopMonitoring()
      setPaused(true)
    }
  }, [paused])

  const timeRangeOptions: Array<{ value: '60s' | '5m' | '15m'; label: string }> = [
    { value: '60s', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
  ]

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <>
            {/* Time range pills */}
            <div
              className="flex rounded-lg p-0.5"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              {timeRangeOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all',
                    timeRange === opt.value ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300',
                  )}
                  style={timeRange === opt.value ? { background: 'rgba(245,158,11,0.1)' } : undefined}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Pause/Resume */}
            <button
              type="button"
              onClick={togglePause}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
              style={{
                background: paused ? 'rgba(34,197,94,0.1)' : 'var(--bg-subtle-2)',
                color: paused ? '#22c55e' : 'var(--text-secondary)',
                border: `1px solid ${paused ? 'rgba(34,197,94,0.2)' : 'var(--border-medium)'}`,
              }}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? t('resume') : t('pause')}
            </button>
          </>
        }
      />

      <SystemInfoHeader info={systemInfo} uptime={snapshot?.uptime ?? 0} />

      <AlertBanner snapshot={snapshot} history={history} />

      {/* Gauges */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <GaugeCard
          label={t('gaugeCpu')}
          percent={snapshot?.cpu.overall ?? 0}
          detail={snapshot ? t('cpuThreadsDetail', { count: snapshot.cpu.perCore.length }) : t('noDataPlaceholder')}
        />
        <GaugeCard
          label={t('gaugeMemory')}
          percent={snapshot?.memory.percent ?? 0}
          detail={
            snapshot
              ? `${formatBytes(snapshot.memory.usedBytes, 1)} / ${formatBytes(snapshot.memory.totalBytes, 1)}`
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label={t('gaugeDiskIo')}
          percent={Math.min(
            100,
            (((snapshot?.disk.readBytesPerSec ?? 0) + (snapshot?.disk.writeBytesPerSec ?? 0)) / (200 * 1024 * 1024)) *
              100,
          )}
          detail={
            snapshot
              ? t('diskIoDetail', {
                  read: formatSpeed(snapshot.disk.readBytesPerSec),
                  write: formatSpeed(snapshot.disk.writeBytesPerSec),
                })
              : t('noDataPlaceholder')
          }
        />
        <GaugeCard
          label={t('gaugeNetwork')}
          percent={Math.min(
            100,
            (((snapshot?.network.rxBytesPerSec ?? 0) + (snapshot?.network.txBytesPerSec ?? 0)) / (125 * 1024 * 1024)) *
              100,
          )}
          detail={
            snapshot
              ? `${formatSpeed(snapshot.network.rxBytesPerSec)} / ${formatSpeed(snapshot.network.txBytesPerSec)}`
              : t('noDataPlaceholder')
          }
        />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="cpu"
          label={t('chartCpuUsage')}
          color="#f59e0b"
        />
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="memory"
          label={t('chartMemoryUsage')}
          color="#3b82f6"
        />
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="disk"
          label={t('chartDiskIo')}
          color="#22c55e"
        />
      </div>

      {/* Disk Health */}
      <DiskHealthPanel disks={diskHealth} />

      {/* Process Table */}
      <ProcessTable />
    </div>
  )
}
