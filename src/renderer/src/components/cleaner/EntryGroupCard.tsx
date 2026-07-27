import type { ContextMenuAction, ContextMenuEntry } from '@shared/types'
import { ChevronDown, MousePointerClick } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useContextMenuStore } from '@/stores/context-menu-store'
import { colorForBinary } from './constants'
import { EntryRow } from './EntryRow'

interface EntryGroupCardProps {
  group: { binary: string; entries: ContextMenuEntry[] }
  applying: boolean
  onEntryAction: (entryId: string, action: ContextMenuAction) => void
}

export function EntryGroupCard({ group, applying, onEntryAction }: EntryGroupCardProps) {
  const { t } = useTranslation('contextMenu')
  const expanded = useContextMenuStore((s) => s.expandedGroups)
  const entries = useContextMenuStore((s) => s.entries)

  const groupKey = `bin:${group.binary}`
  const isExpanded = expanded.has(groupKey)
  const eligibleIds = group.entries.filter((e) => !e.protected).map((e) => e.id)
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => entries.find((e) => e.id === id)?.selected)
  const pill = colorForBinary(group.binary)

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        border: '1px solid var(--border-default)',
        opacity: applying ? 0.5 : 1,
        pointerEvents: applying ? 'none' : 'auto',
      }}
    >
      <div className="flex items-center gap-4 px-5 py-4" style={{ background: 'var(--bg-subtle)' }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: pill.bg }}>
          <MousePointerClick className="h-5 w-5" style={{ color: pill.text }} strokeWidth={1.8} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="truncate font-mono text-[13px] font-semibold text-zinc-200">{group.binary}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
            >
              {group.entries.length}
            </span>
          </div>
        </div>
        {eligibleIds.length > 0 && (
          <button
            type="button"
            onClick={() => useContextMenuStore.getState().toggleAllVisible(eligibleIds, !allSelected)}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{ background: allSelected ? pill.text : 'var(--bg-active)' }}
            aria-label={t('ariaToggleAll')}
          >
            <div
              className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
              style={{
                left: allSelected ? '22px' : '2px',
                background: allSelected ? '#fff' : 'var(--text-secondary)',
              }}
            />
          </button>
        )}
        <button
          type="button"
          onClick={() => useContextMenuStore.getState().toggleGroup(groupKey)}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          style={{ background: 'var(--bg-subtle-2)' }}
        >
          <ChevronDown
            className="h-4 w-4 transition-transform"
            style={{
              color: 'var(--text-secondary)',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
            strokeWidth={2}
          />
        </button>
      </div>

      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {group.entries.map((entry, i) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              isLast={i === group.entries.length - 1}
              onToggle={() => useContextMenuStore.getState().toggleEntry(entry.id)}
              onAction={(action) => onEntryAction(entry.id, action)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
