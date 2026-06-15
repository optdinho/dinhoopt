import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ElevationBannerProps {
  show: boolean
}

export function ElevationBanner({ show }: ElevationBannerProps) {
  const { t } = useTranslation('contextMenu')
  if (!show) return null
  return (
    <div
      className="mb-3 flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[12px]"
      style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)' }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
      <span className="flex-1 text-zinc-300">{t('elevationPrompt')}</span>
      <button
        type="button"
        onClick={() => window.dinho.elevationRelaunch?.().catch(() => {})}
        className="rounded-md px-3 py-1 text-[11px] font-medium text-amber-400"
        style={{ background: 'rgba(245,158,11,0.10)' }}
      >
        {t('elevationRelaunch')}
      </button>
    </div>
  )
}
