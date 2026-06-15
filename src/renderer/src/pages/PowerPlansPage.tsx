import { PageHeader } from '@/components/layout/PageHeader'
import { usePowerPlansStore } from '@/stores/power-plans-store'
import type { PowerPlanInfo } from '@shared/types'
import { AlertCircle, Check, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PLAN_ICONS: Record<string, string> = {
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': '⚡',
  '381b4222-f694-41f0-9685-ff5bb260df2e': '⚖️',
  'a1841308-3541-4fab-bc81-f71556f20b4a': '🪫',
}

const PLAN_COLORS: Record<string, string> = {
  highPerformance: 'text-emerald-400',
  balanced: 'text-amber-400',
  powerSaver: 'text-blue-400',
}

function getPlanType(plan: PowerPlanInfo): string {
  if (plan.isHighPerformance) return 'highPerformance'
  if (plan.isBalanced) return 'balanced'
  if (plan.isPowerSaver) return 'powerSaver'
  return 'custom'
}

export function PowerPlansPage() {
  const { t } = useTranslation('powerPlans')
  const { plans, loading, activating, error, activeGuid, loadPlans, activatePlan, deletePlan, createPlan, clearError } =
    usePowerPlansStore()
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

  const activePlan = plans.find((p) => p.guid === activeGuid)

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* Active plan badge */}
      {activePlan && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{PLAN_ICONS[activePlan.guid] ?? '🔌'}</span>
            <div>
              <p className="text-xs text-zinc-500">{t('activePlan')}</p>
              <p className="font-medium text-emerald-400">{activePlan.name}</p>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError} className="text-zinc-500 transition-colors hover:text-zinc-300">
            &times;
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => loadPlans()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" />
          {t('createPlan')}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newPlanName}
              onChange={(e) => setNewPlanName(e.target.value)}
              placeholder={t('createPlaceholder')}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newPlanName.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {t('create')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false)
                setNewPlanName('')
              }}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Plans list */}
      {loading && plans.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
          {t('loading')}
        </div>
      ) : plans.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">{t('noPlans')}</div>
      ) : (
        <div className="grid gap-3">
          {plans.map((plan) => {
            const type = getPlanType(plan)
            const isActive = plan.guid === activeGuid
            const isDeleting = deleteConfirm === plan.guid
            const icon = PLAN_ICONS[plan.guid] ?? '🔌'
            const colorClass = PLAN_COLORS[type] ?? 'text-zinc-400'

            return (
              <div
                key={plan.guid}
                className={`group relative rounded-xl border p-4 transition-all ${
                  isActive
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-zinc-700/50 bg-zinc-800/20 hover:border-zinc-600/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-xl ${colorClass}`}>{icon}</span>
                    <div>
                      <p className={`font-medium ${isActive ? 'text-emerald-300' : 'text-zinc-100'}`}>
                        {plan.name}
                        {isActive && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                            <Check className="h-3 w-3" />
                            {t('active')}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {plan.guid.slice(0, 8)}...{plan.guid.slice(-4)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isActive && !isDeleting && (
                      <button
                        type="button"
                        onClick={() => activatePlan(plan.guid)}
                        disabled={activating}
                        className="rounded-lg bg-zinc-700/50 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-emerald-600 hover:text-white disabled:opacity-50"
                      >
                        {activating ? '...' : t('activate')}
                      </button>
                    )}
                    {!isActive && !isDeleting && (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(plan.guid)}
                        className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title={t('delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    {isDeleting && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(plan.guid)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
                        >
                          {t('confirmDelete')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs text-zinc-500 hover:text-zinc-300"
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
