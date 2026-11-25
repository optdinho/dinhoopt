import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function CaptureBorderPermissionCard() {
  const { t } = useTranslation('hardening')
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const get = window.dinho?.captureBorderGet
    if (!get) {
      setLoading(false)
      return
    }

    get()
      .then((status) => {
        if (!cancelled) setEnabled(status.enabled)
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = useCallback(async () => {
    const next = !enabled
    setEnabled(next)
    setLoading(true)
    try {
      const result = await window.dinho?.captureBorderSet?.(next)
      if (!result?.success) {
        setEnabled(!next)
        toast.error(result?.error ?? t('privacy.captureBorderApplyFailed'))
      } else {
        toast.success(t('privacy.captureBorderApplied'))
      }
    } catch {
      setEnabled(!next)
      toast.error(t('privacy.captureBorderApplyFailed'))
    } finally {
      setLoading(false)
    }
  }, [enabled, t])

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{ border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(34,197,94,0.1)' }}
        >
          <ShieldCheck className="h-[18px] w-[18px] text-green-500" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <span className="text-[14px] font-semibold text-zinc-200">{t('privacy.captureBorderTitle')}</span>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {t('privacy.captureBorderDesc')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('privacy.captureBorderTitle')}
          onClick={handleToggle}
          disabled={loading}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40"
          style={{ background: enabled ? '#22c55e' : 'var(--bg-active)' }}
        >
          <div
            className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
            style={{
              left: enabled ? '22px' : '2px',
              background: enabled ? '#fff' : 'var(--text-muted)',
            }}
          />
        </button>
      </div>
      <div className="flex items-start gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} />
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {t('privacy.captureBorderWarning')}
        </p>
      </div>
    </div>
  )
}
