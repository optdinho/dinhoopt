import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useWindowsTweaksStore } from '@/stores/windows-tweaks-store'

interface NetworkTweaksSectionProps {
  applying: boolean
}

export function NetworkTweaksSection({ applying }: NetworkTweaksSectionProps) {
  const { t } = useTranslation('windowsTweaks')
  const store = useWindowsTweaksStore

  const handleApply = async () => {
    const r = await store.getState().netshTcpApply()
    if (r.success) toast.success(t('tcpIpApplied', 'TCP/IP tweaks applied!'))
    else toast.error(r.error ?? t('failed', 'Failed'))
  }

  const handleRevert = async () => {
    const r = await store.getState().netshTcpRevert()
    if (r.success) toast.success(t('tcpIpReverted', 'TCP/IP tweaks reverted!'))
    else toast.error(r.error ?? t('failed', 'Failed'))
  }

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Zap className="h-4 w-4 text-cyan-400" />
        {t('tcpIpOptimization', 'TCP/IP Stack Optimization')}
      </h3>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-cyan-700 hover:text-cyan-400 disabled:opacity-40"
        >
          {t('applyTcpTweaks', 'Apply TCP Tweaks')}
        </button>
        <button
          type="button"
          onClick={handleRevert}
          disabled={applying}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-red-700 hover:text-red-400 disabled:opacity-40"
        >
          {t('revertTcpTweaks', 'Revert TCP Tweaks')}
        </button>
      </div>
    </div>
  )
}
