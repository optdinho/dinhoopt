import { EmptyState } from '@/components/shared/EmptyState'
import { formatDuration } from '@/lib/utils'
import { FolderX, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyFolderItem } from './EmptyFolderItem'

export interface FolderScanResultData {
  folders: { path: string }[]
  totalFoldersScanned: number
  duration: number
}

interface FolderScanResultProps {
  result: FolderScanResultData
  selectedPaths: Set<string>
  deleteMode: 'recycle' | 'permanent'
  onSelectAll: () => void
  onDeselectAll: () => void
  onDelete: () => void
  onReset: () => void
  onSetDeleteMode: (mode: 'recycle' | 'permanent') => void
  onTogglePath: (path: string) => void
}

export function FolderScanResult({
  result,
  selectedPaths,
  deleteMode,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onReset,
  onSetDeleteMode,
  onTogglePath,
}: FolderScanResultProps) {
  const { t } = useTranslation('emptyFolders')
  const selectedCount = selectedPaths.size

  if (result.folders.length === 0) {
    return <EmptyState icon={FolderX} title={t('emptyTitle')} description={t('emptyDescription')} />
  }

  return (
    <>
      {/* Summary stats */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatCard label={t('emptyFound')} value={result.folders.length.toLocaleString()} accent />
        <StatCard label={t('foldersScanned')} value={result.totalFoldersScanned.toLocaleString()} />
        <StatCard label={t('duration')} value={formatDuration(result.duration)} />
      </div>

      {/* Action bar */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={selectedCount > 0 ? onDeselectAll : onSelectAll}
          className="rounded-xl px-4 py-2 text-[12px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          style={{ background: 'var(--bg-subtle-2)' }}
        >
          {selectedCount > 0 ? t('deselectAll') : t('selectAll')}
        </button>

        <div className="flex overflow-hidden rounded-lg" style={{ background: 'var(--bg-subtle-2)' }}>
          <button
            type="button"
            onClick={() => onSetDeleteMode('recycle')}
            className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
              deleteMode === 'recycle' ? 'text-amber-400' : 'text-zinc-500'
            }`}
            style={deleteMode === 'recycle' ? { background: 'var(--accent-muted-bg)' } : undefined}
          >
            {t('recycleBin')}
          </button>
          <button
            type="button"
            onClick={() => onSetDeleteMode('permanent')}
            className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
              deleteMode === 'permanent' ? 'text-red-400' : 'text-zinc-500'
            }`}
            style={deleteMode === 'permanent' ? { background: 'rgba(239,68,68,0.1)' } : undefined}
          >
            {t('permanentDelete')}
          </button>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          style={{ background: 'var(--bg-subtle-2)' }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('scanAgain')}
        </button>

        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-2 rounded-xl px-5 py-2 text-[13px] font-semibold transition-colors"
            style={{
              background: deleteMode === 'permanent' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
              color: deleteMode === 'permanent' ? '#ef4444' : 'var(--accent)',
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t('deleteSelected', { count: selectedCount })}
          </button>
        )}
      </div>

      {/* Folder list */}
      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
      >
        {result.folders.map((folder, idx) => (
          <div
            key={folder.path}
            className={idx > 0 ? 'border-t' : ''}
            style={{ borderColor: 'var(--bg-subtle)' }}
          >
            <EmptyFolderItem
              folder={folder}
              selected={selectedPaths.has(folder.path)}
              onToggle={onTogglePath}
            />
          </div>
        ))}
      </div>
    </>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-bold" style={{ color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )
}
