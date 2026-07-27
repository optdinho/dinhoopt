import { Checkbox } from '@/components/shared/Checkbox'
import { SquareArrowOutUpRight, FolderX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface FolderItem {
  path: string
}

interface EmptyFolderItemProps {
  folder: FolderItem
  selected: boolean
  onToggle: (path: string) => void
}

export function EmptyFolderItem({ folder, selected, onToggle }: EmptyFolderItemProps) {
  const { t } = useTranslation('emptyFolders')

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.02]">
      <Checkbox checked={selected} onChange={() => onToggle(folder.path)} size="sm" />
      <FolderX className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
      <span
        className="min-w-0 flex-1 truncate text-[12.5px]"
        style={{ color: 'var(--text-secondary)' }}
        title={folder.path}
      >
        {folder.path}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          window.dinho?.emptyFoldersOpenLocation?.(folder.path)
        }}
        className="shrink-0 text-zinc-600 hover:text-zinc-400"
        title={t('openLocation')}
      >
        <SquareArrowOutUpRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
