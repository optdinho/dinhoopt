import { ClipEditorModal } from '@/components/clips/ClipEditorModal'
import { ClipsConfigPanel } from '@/components/clips/ClipsConfigPanel'
import { ClipsGrid } from '@/components/clips/ClipsGrid'
import { ClipsStatusBar } from '@/components/clips/ClipsStatusBar'
import { useClipsState } from '@/components/clips/useClipsState'
import { PageHeader } from '@/components/layout/PageHeader'
import { motion } from 'framer-motion'
import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ClipsPage() {
  const state = useClipsState()
  const { t } = useTranslation('clips')

  return (
    <>
      <div className="flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => state.setShowConfig(!state.showConfig)}
            className="mt-1 shrink-0 rounded-lg p-2 transition-colors hover:bg-white/[0.06]"
            style={{ color: state.showConfig ? 'var(--accent)' : 'var(--text-dim)' }}
            title={state.showConfig ? 'Hide Settings' : 'Settings'}
          >
            <motion.div
              animate={{ rotate: state.showConfig ? 90 : 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <Settings className="h-5 w-5" />
            </motion.div>
          </motion.button>
        </div>

        <div className="mt-6 flex gap-6">
          <div className="min-w-0 flex-1 space-y-6">
            <ClipsStatusBar {...state} />
            <ClipsGrid {...state} />
          </div>
          <ClipsConfigPanel {...state} />
        </div>
      </div>

      {state.activeTip && state.tooltipContent[state.activeTip] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => state.setActiveTip(null)}>
          <div
            className="max-w-xs rounded-xl border bg-[#1a1a2e] p-5 text-sm leading-relaxed shadow-2xl"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {state.tooltipContent[state.activeTip]}
          </div>
        </div>
      )}

      {state.mergeModePaths && (
        <ClipEditorModal
          initialMergePaths={state.mergeModePaths}
          onClose={() => state.setMergeModePaths(null)}
          onSave={() => {
            state.setMergeModePaths(null)
            state.refreshClips()
          }}
        />
      )}
      {state.editingClip && !state.mergeModePaths && (
        <ClipEditorModal
          clip={state.editingClip}
          onClose={() => state.setEditingClip(null)}
          onSave={() => {
            state.setEditingClip(null)
            state.refreshClips()
          }}
        />
      )}
    </>
  )
}
