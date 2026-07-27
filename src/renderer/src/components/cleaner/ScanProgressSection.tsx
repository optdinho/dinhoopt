import { StopCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScanProgress } from '@/components/shared/ScanProgress'

interface ScanProgressSectionProps {
  scanning: boolean
  onCancel: () => void
}

export function ScanProgressSection({ scanning, onCancel }: ScanProgressSectionProps) {
  const { t } = useTranslation('contextMenu')
  if (!scanning) return null
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex-1">
        <ScanProgress status="scanning" progress={0} currentPath={t('scanningLabel')} />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-medium text-red-400 transition-all hover:text-red-300"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
      >
        <StopCircle className="h-3.5 w-3.5" strokeWidth={2} /> {t('cancelButton')}
      </button>
    </div>
  )
}
