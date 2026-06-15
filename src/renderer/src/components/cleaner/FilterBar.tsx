import type { ContextMenuScope, ContextMenuSource, ContextMenuStatus } from '@shared/types'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SCOPE_LABEL_KEY } from './constants'

interface FilterBarProps {
  filters: {
    search: string
    scope: ContextMenuScope | 'all'
    source: ContextMenuSource | 'all'
    status: ContextMenuStatus | 'all'
  }
  availableScopes: ContextMenuScope[]
  availableSources: ContextMenuSource[]
  onChange: <K extends 'search' | 'scope' | 'source' | 'status'>(key: K, value: FilterBarProps['filters'][K]) => void
}

export function FilterBar({ filters, availableScopes, availableSources, onChange }: FilterBarProps) {
  const { t } = useTranslation('contextMenu')
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[240px]">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: 'var(--text-muted)' }}
          strokeWidth={2}
        />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          placeholder={t('filterSearchPlaceholder')}
          className="w-full rounded-xl pl-9 pr-3 py-2 text-[12px] text-zinc-200 transition-colors outline-none"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
        />
      </div>
      <select
        value={filters.scope}
        onChange={(e) => onChange('scope', e.target.value as ContextMenuScope | 'all')}
        className="rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
      >
        <option value="all">{t('filterScopeAll')}</option>
        {availableScopes.map((s) => (
          <option key={s} value={s}>
            {t(SCOPE_LABEL_KEY[s])}
          </option>
        ))}
      </select>
      <select
        value={filters.source}
        onChange={(e) => onChange('source', e.target.value as ContextMenuSource | 'all')}
        className="rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
      >
        <option value="all">{t('filterSourceAll')}</option>
        {availableSources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={filters.status}
        onChange={(e) => onChange('status', e.target.value as ContextMenuStatus | 'all')}
        className="rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
      >
        <option value="all">{t('filterStatusAll')}</option>
        <option value="enabled">{t('filterStatusEnabled')}</option>
        <option value="disabled">{t('filterStatusDisabled')}</option>
      </select>
    </div>
  )
}
