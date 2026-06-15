import { Shield, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Win11NoticeBannerProps {
  show: boolean
  onDismiss: () => void
}

export function Win11NoticeBanner({ show, onDismiss }: Win11NoticeBannerProps) {
  const { t } = useTranslation('contextMenu')
  if (!show) return null
  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-2xl px-5 py-4"
      style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-bg)' }}
    >
      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.8} />
      <div className="flex-1 text-[12px]">
        <p className="font-semibold text-amber-500">{t('win11NoticeTitle')}</p>
        <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {t('win11NoticeBody')}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-1 transition-colors hover:bg-zinc-800"
        aria-label={t('win11NoticeDismiss')}
      >
        <X className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} strokeWidth={2} />
      </button>
    </div>
  )
}
