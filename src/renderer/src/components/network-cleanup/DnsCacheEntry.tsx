import type { NetworkItem } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { Network } from 'lucide-react'
import { Checkbox } from '@/components/shared/Checkbox'
import { cn } from '@/lib/utils'

interface DnsCacheEntryProps {
  item: NetworkItem
  checked: boolean
  categoryIcons: Record<string, LucideIcon>
  onToggle: (id: string) => void
}

export function DnsCacheEntry({ item, checked, categoryIcons, onToggle }: DnsCacheEntryProps) {
  const CatIcon = categoryIcons[item.type] || Network

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3.5 transition-all',
        checked && 'ring-1 ring-amber-500/20',
      )}
      style={{
        background: checked ? 'rgba(245,158,11,0.04)' : 'var(--card-bg)',
        border: '1px solid var(--border-default)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = checked ? 'var(--accent-muted-bg)' : 'var(--bg-subtle)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = checked ? 'rgba(245,158,11,0.04)' : 'var(--card-bg)'
      }}
    >
      <Checkbox checked={checked} onChange={() => onToggle(item.id)} />
      <CatIcon
        className="h-4 w-4 shrink-0"
        style={{ color: checked ? 'var(--accent)' : 'var(--text-muted)' }}
        strokeWidth={1.8}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-zinc-300">{item.label}</p>
        <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {item.detail}
        </p>
      </div>
    </div>
  )
}
