import { CircleCheckBig, Power, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface BulkActionBarProps {
  selectedCount: number
  onDisable: () => void
  onEnable: () => void
  onDelete: () => void
}

export function BulkActionBar({ selectedCount, onDisable, onEnable, onDelete }: BulkActionBarProps) {
  const { t } = useTranslation('contextMenu')
  return (
    <div
      className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-2xl px-3 py-2 will-change-transform"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-medium)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      }}
    >
      <span className="px-3 text-[12px] font-medium text-zinc-300">{t('selectedCount', { count: selectedCount })}</span>
      <button
        type="button"
        onClick={onDisable}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-zinc-200 transition-colors"
        style={{ background: 'var(--bg-hover)' }}
        aria-label={t('disableSelected')}
      >
        <Power className="h-3.5 w-3.5" strokeWidth={2} /> {t('disableSelected')}
      </button>
      <button
        type="button"
        onClick={onEnable}
        aria-label={t('enableSelected')}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-emerald-400 transition-colors"
        style={{ background: 'rgba(34,197,94,0.08)' }}
      >
        <CircleCheckBig className="h-3.5 w-3.5" strokeWidth={2} /> {t('enableSelected')}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t('deleteSelected')}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-red-400 transition-colors"
        style={{ background: 'rgba(239,68,68,0.08)' }}
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> {t('deleteSelected')}
      </button>
    </div>
  )
}
