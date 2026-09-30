import type { PowerPlanInfo } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { BatteryCharging, CircleAlert, Cpu, Gauge, Plug, Plus, RefreshCw, Rocket, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader'
import { usePowerPlansStore } from '@/stores/power-plans-store'

const ULTIMATE_PERFORMANCE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61'

type PlanKind = 'ultimate' | 'high' | 'balanced' | 'saver' | 'custom'

const STOCK_GUIDS = new Set([
  'e9a42b02-d5df-448d-aa00-03f14749eb61',
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  '381b4222-f694-41f0-9685-ff5bb260df2e',
  'a1841308-3541-4fab-bc81-f71556f20b4a',
])

const KIND_STYLE: Record<
  PlanKind,
  { icon: LucideIcon; color: string; tint: string; border: string; labelKey: string }
> = {
  ultimate: {
    icon: Rocket,
    color: 'text-rose-400',
    tint: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    labelKey: 'kindUltimate',
  },
  high: {
    icon: Cpu,
    color: 'text-emerald-400',
    tint: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    labelKey: 'kindHighPerformance',
  },
  balanced: {
    icon: Gauge,
    color: 'text-amber-400',
    tint: 'bg-amber-500/10',
    border: 'border-amber-500/25',
    labelKey: 'kindBalanced',
  },
  saver: {
    icon: BatteryCharging,
    color: 'text-sky-400',
    tint: 'bg-sky-500/10',
    border: 'border-sky-500/25',
    labelKey: 'kindPowerSaver',
  },
  custom: {
    icon: Plug,
    color: 'text-zinc-400',
    tint: 'bg-zinc-500/10',
    border: 'border-zinc-500/25',
    labelKey: 'kindCustom',
  },
}

function getPlanKind(plan: PowerPlanInfo): PlanKind {
  if (plan.isUltimatePerformance || plan.guid === ULTIMATE_PERFORMANCE_GUID) return 'ultimate'
  if (plan.isHighPerformance) return 'high'
  if (plan.isBalanced) return 'balanced'
  if (plan.isPowerSaver) return 'saver'
  return 'custom'
}

function isStockPlan(plan: PowerPlanInfo): boolean {
  return STOCK_GUIDS.has(plan.guid)
}

export function PowerPlansPage() {
  const { t } = useTranslation('powerPlans')
  const {
    plans,
    loading,
    activating,
    unlockingUltimate,
    error,
    activeGuid,
    loadPlans,
    activatePlan,
    deletePlan,
    createPlan,
    unlockUltimate,
    clearError,
  } = usePowerPlansStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newPlanName, setNewPlanName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  const handleCreate = async () => {
    if (!newPlanName.trim()) return
    await createPlan(newPlanName.trim())
    setNewPlanName('')
    setShowCreate(false)
  }

  const handleDelete = async (guid: string) => {
    await deletePlan(guid)
    setDeleteConfirm(null)
  }

  const hasUltimate = plans.some((p) => p.isUltimatePerformance || p.guid === ULTIMATE_PERFORMANCE_GUID)

  const { stock, custom } = useMemo(
    () => ({
      stock: plans.filter(isStockPlan),
      custom: plans.filter((p) => !isStockPlan(p)),
    }),
    [plans],
  )

  const activePlan = plans.find((p) => p.guid === activeGuid || p.isActive)
  const activeKind = activePlan ? getPlanKind(activePlan) : null
  const activeStyle = activeKind ? KIND_STYLE[activeKind] : null

  const renderPlan = (plan: PowerPlanInfo) => {
    const kind = getPlanKind(plan)
    const style = KIND_STYLE[kind]
    const Icon = style.icon
    const isActive = plan.guid === activeGuid || plan.isActive
    const isDeleting = deleteConfirm === plan.guid

    return (
      <div
        key={plan.guid}
        className="group relative flex items-center gap-4 rounded-2xl p-4 transition-all"
        style={{
          background: isActive ? 'var(--card-bg)' : 'var(--bg-hover)',
          border: `1px solid ${isActive ? 'var(--accent-muted-border)' : 'var(--border-default)'}`,
          boxShadow: isActive ? '0 0 0 1px var(--accent-muted-border)' : 'none',
        }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: style.tint }}
        >
          <Icon className={`h-5 w-5 ${style.color}`} strokeWidth={1.8} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {plan.name}
            </p>
            {isActive && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent-hover)' }}
              >
                {t('active')}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t(style.labelKey)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isDeleting ? (
            <>
              <button
                type="button"
                onClick={() => handleDelete(plan.guid)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-white transition-colors"
                style={{ background: '#dc2626' }}
              >
                {t('confirmDelete')}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg px-2 py-1.5 text-[12px] transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('cancel')}
              </button>
            </>
          ) : isActive ? null : (
            <>
              <button
                type="button"
                onClick={() => activatePlan(plan.guid)}
                disabled={activating}
                className="rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              >
                {t('activate')}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(plan.guid)}
                className="rounded-lg p-2 transition-colors hover:bg-red-500/10 hover:text-red-400"
                style={{ color: 'var(--text-muted)' }}
                title={t('delete')}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const renderGroup = (id: string, label: string, items: PowerPlanInfo[]) =>
    items.length > 0 && (
      <section data-testid={`group-${id}`}>
        <div className="mb-2.5 flex items-center gap-2.5 px-1">
          <span
            className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
          </span>
          <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
        </div>
        <div className="space-y-2">{items.map(renderPlan)}</div>
      </section>
    )

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => loadPlans()}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all disabled:opacity-40"
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
              }}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
              {t('refresh')}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-all"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              {t('createPlan')}
            </button>
          </div>
        }
      />

      {activePlan && activeStyle && (
        <div
          className="flex items-center gap-4 rounded-2xl p-5"
          data-testid="active-plan-hero"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--accent-muted-border)' }}
        >
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: activeStyle.tint }}
          >
            <activeStyle.icon className={`h-6 w-6 ${activeStyle.color}`} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {t('activePlan')}
            </p>
            <p className="truncate text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {activePlan.name}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold"
            style={{ background: activeStyle.tint, color: activeStyle.color.replace('text-', '') }}
          >
            {t(activeStyle.labelKey)}
          </span>
        </div>
      )}

      {!hasUltimate && !loading && (
        <div
          className="flex flex-wrap items-center gap-4 rounded-2xl p-5"
          style={{ background: 'var(--bg-hover)', border: '1px dashed var(--border-medium)' }}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/10">
            <Rocket className="h-5 w-5 text-rose-400" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('ultimateTitle')}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {t('ultimateDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={unlockUltimate}
            disabled={unlockingUltimate}
            className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)', color: '#fff' }}
          >
            <Rocket className="h-4 w-4" strokeWidth={2} />
            {t('unlockUltimate')}
          </button>
        </div>
      )}

      {error && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
        >
          <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError} className="transition-colors" title={t('dismiss')}>
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      )}

      {showCreate && (
        <div
          className="flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <input
            type="text"
            value={newPlanName}
            onChange={(e) => setNewPlanName(e.target.value)}
            placeholder={t('createPlaceholder')}
            maxLength={100}
            className="min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-[13px] outline-none transition-colors"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newPlanName.trim()}
            className="shrink-0 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {t('create')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCreate(false)
              setNewPlanName('')
            }}
            className="shrink-0 rounded-xl px-3 py-2.5 text-[13px] transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {loading && plans.length === 0 ? (
        <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw className="mr-2.5 h-5 w-5 animate-spin" />
          <span className="text-[13px]">{t('loading')}</span>
        </div>
      ) : plans.length === 0 ? (
        <div className="py-16 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('noPlans')}
        </div>
      ) : (
        <div className="space-y-6">
          {renderGroup('stock', t('groupStock'), stock)}
          {renderGroup('custom', t('groupCustom'), custom)}
        </div>
      )}
    </div>
  )
}
