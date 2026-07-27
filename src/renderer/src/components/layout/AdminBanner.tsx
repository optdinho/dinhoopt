import { ShieldAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlatform } from '@/hooks/usePlatform'

export function AdminBanner() {
  const { t } = useTranslation('common')
  const { platform } = usePlatform()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.dinho.elevationCheck().then((elevated) => {
      if (!elevated) setVisible(true)
    })
  }, [])

  // On macOS the relaunch-as-admin flow doesn't work properly — hide the banner entirely
  if (platform === 'darwin') return null
  if (!visible || dismissed) return null

  return (
    <aside
      className="mx-4 mb-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm"
      style={{
        background: 'var(--accent-muted-bg)',
        border: '1px solid var(--accent-muted-border)',
      }}
    >
      <ShieldAlert size={18} className="shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
      <span style={{ color: 'var(--text-secondary)' }}>{t('adminBannerMessage')}</span>
      <button
        type="button"
        onClick={() => window.dinho.elevationRelaunch()}
        className="ml-1 shrink-0 rounded px-3 py-1 text-xs font-medium transition-colors"
        style={{ color: 'var(--accent)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-muted-bg)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {t('relaunchAsAdmin')}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('dismiss')}
        className="ml-auto shrink-0 text-zinc-600 transition-colors hover:text-zinc-400"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </aside>
  )
}
