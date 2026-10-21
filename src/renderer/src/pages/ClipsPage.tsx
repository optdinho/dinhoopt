import { motion } from 'framer-motion'
import { Settings, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ClipEditorModal } from '@/components/clips/ClipEditorModal'
import { ClipsConfigPanel } from '@/components/clips/ClipsConfigPanel'
import { ClipsGrid } from '@/components/clips/ClipsGrid'
import { ClipsStatusBar } from '@/components/clips/ClipsStatusBar'
import PublishModal from '@/components/clips/PublishModal'
import { RenameDialog } from '@/components/clips/RenameDialog'
import { useClipsState } from '@/components/clips/useClipsState'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { APP_VERSION } from '@/lib/app-version'
import { useNewVersionBadge } from '@/lib/whats-new'

const CLIPS_NEWS_KEY = 'dinho-clips-new-version'

export function ClipsPage() {
  const state = useClipsState()
  const { t } = useTranslation('clips')
  const { isNew: hasVersionNews, dismiss: dismissVersionNews } = useNewVersionBadge(CLIPS_NEWS_KEY, APP_VERSION)

  return (
    <>
      <div className="flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              state.setShowConfig(!state.showConfig)
              if (hasVersionNews) dismissVersionNews()
            }}
            className="relative mt-1 shrink-0 rounded-lg p-2 transition-colors hover:bg-white/[0.06]"
            style={{ color: state.showConfig ? 'var(--accent)' : 'var(--text-dim)' }}
            title={state.showConfig ? t('hideSettings') : t('showSettings')}
          >
            <motion.div
              animate={{ rotate: state.showConfig ? 90 : 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <Settings className="h-5 w-5" />
            </motion.div>
            {hasVersionNews && !state.showConfig && (
              <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2">
                <motion.span
                  data-testid="clips-news-badge"
                  role="status"
                  aria-label={t('newVersionBadge')}
                  initial={{ opacity: 0, x: 6, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="relative flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium shadow-lg"
                  style={{
                    background: 'var(--card-bg)',
                    borderColor: 'var(--accent-muted-border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                      style={{ background: 'var(--accent)' }}
                    />
                    <span
                      className="relative inline-flex h-2 w-2 rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  </span>
                  {t('configureClipsHint')}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      dismissVersionNews()
                    }}
                    aria-label={t('close')}
                    title={t('close')}
                    className="pointer-events-auto -mr-1 ml-0.5 grid h-4 w-4 shrink-0 place-items-center rounded transition-colors hover:bg-white/10"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <span
                    className="absolute top-1/2 -translate-y-1/2"
                    style={{
                      left: '100%',
                      width: 0,
                      height: 0,
                      borderTop: '6px solid transparent',
                      borderBottom: '6px solid transparent',
                      borderLeft: '6px solid var(--card-bg)',
                    }}
                  />
                </motion.span>
              </span>
            )}
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
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center"
          onMouseDown={() => state.setActiveTip(null)}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: tooltip panel that must intercept mousedown to prevent backdrop close */}
          <div
            className="max-w-xs rounded-xl border bg-[#1a1a2e] p-5 text-sm leading-relaxed shadow-2xl"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
            onMouseDown={(e) => e.stopPropagation()}
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
          startFullscreen={state.editingClipFullscreen}
          onClose={() => state.setEditingClip(null)}
          onSave={() => {
            state.setEditingClip(null)
            state.refreshClips()
          }}
        />
      )}
      {state.publishResult && (
        <PublishModal link={state.publishResult.link} onClose={() => state.setPublishResult(null)} />
      )}

      <RenameDialog
        open={state.renameTarget !== null}
        oldName={state.renameTarget ?? ''}
        onConfirm={(newName) => {
          const oldName = state.renameTarget
          if (oldName) state.handleRenameClip(oldName, newName)
          state.setRenameTarget(null)
        }}
        onCancel={() => state.setRenameTarget(null)}
      />

      {/* F2 — o `confirm()` nativo foi substituído pelos `ConfirmDialog` da app.
          O clipe (ou o conjunto) fica pendente até o utilizador confirmar. */}
      <ConfirmDialog
        open={state.deleteTarget !== null}
        onConfirm={() => {
          const name = state.deleteTarget
          state.setDeleteTarget(null)
          if (name) void state.handleDeleteClip(name)
        }}
        onCancel={() => state.setDeleteTarget(null)}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirm')}
        variant="danger"
      />
      <ConfirmDialog
        open={state.deleteAllPending}
        onConfirm={() => {
          state.setDeleteAllPending(false)
          void state.handleDeleteSelected()
        }}
        onCancel={() => state.setDeleteAllPending(false)}
        title={t('deleteMultipleConfirmTitle')}
        description={t('deleteMultipleConfirm')}
        variant="danger"
      />
    </>
  )
}
