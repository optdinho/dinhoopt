import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useWindowsTweaksStore } from '@/stores/windows-tweaks-store'

interface DnsPresetsSectionProps {
  dnsPresets: { name: string; primary: string; secondary: string }[]
  dnsStatus: string | null
  onDnsStatusChange: (status: string | null) => void
}

export function DnsPresetsSection({ dnsPresets, dnsStatus, onDnsStatusChange }: DnsPresetsSectionProps) {
  const { t } = useTranslation('windowsTweaks')
  const store = useWindowsTweaksStore

  if (dnsPresets.length === 0) return null

  const handleSetDns = async (primary: string, secondary: string) => {
    const ok = await store.getState().setDns(primary, secondary)
    onDnsStatusChange(
      ok ? t('dnsChangedSuccess', 'DNS changed successfully!') : t('dnsChangeFailed', 'Failed to change DNS'),
    )
    if (ok) toast.success(t('dnsChanged', 'DNS changed!'))
    else toast.error(t('dnsChangeFailed', 'Failed to change DNS'))
  }

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Globe className="h-4 w-4 text-cyan-400" />
        {t('dnsPresets', 'DNS Presets')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {dnsPresets.map((preset) => (
          <button
            type="button"
            key={preset.name}
            onClick={() => handleSetDns(preset.primary, preset.secondary)}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-cyan-700 hover:text-cyan-400"
          >
            {preset.name}
            <span className="ml-2 text-xs text-zinc-600">{preset.primary}</span>
          </button>
        ))}
      </div>
      {dnsStatus && <p className="mt-2 text-xs text-zinc-500">{dnsStatus}</p>}
    </div>
  )
}
