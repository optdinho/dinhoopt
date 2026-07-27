import { CircleCheck, CircleX, Copy, Info, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLicenseStore } from '../stores/license-store'

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('license')
  const { hwid, isActivating, error, getHwid, activate, checkStatus } = useLicenseStore()
  const [gateState, setGateState] = useState<'loading' | 'unlocked' | 'locked'>('loading')
  const [key, setKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [activationSuccess, setActivationSuccess] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await checkStatus()
      if (cancelled) return
      if (result.valid) {
        setGateState('unlocked')
      } else {
        await getHwid()
        if (!cancelled) setGateState('locked')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [checkStatus, getHwid])

  const handleCopyHwid = () => {
    navigator.clipboard.writeText(hwid)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleActivate = async () => {
    if (!key.trim()) return
    setActivationSuccess(false)
    setReason('')
    const result = await activate(key.trim())
    if (result.valid) {
      setActivationSuccess(true)
      setTimeout(() => setGateState('unlocked'), 1500)
    } else {
      setReason(result.reason || t('invalidKeyDefault'))
    }
  }

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.toUpperCase()
    v = v.replace(/[^A-Z0-9-]/g, '')
    if (v.length > 49) v = v.slice(0, 49)
    setKey(v)
  }

  if (gateState === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#09090b' }}>
        <div className="flex flex-col items-center gap-4">
          <ShieldCheck className="h-10 w-10 text-amber-500" />
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
          <p className="text-zinc-500 text-sm">{t('loading')}</p>
        </div>
      </div>
    )
  }

  if (gateState === 'unlocked') {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center p-4" style={{ background: '#09090b' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
            <ShieldCheck className="h-8 w-8 text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">DiNho Optimizer</h1>
          <p className="mt-1 text-sm text-zinc-500">{t('subtitle')}</p>
        </div>

        {!activationSuccess && !reason && (
          <div className="rounded-xl border border-amber-700/50 bg-amber-900/30 p-4">
            <div className="flex items-center gap-2 mb-1">
              <TriangleAlert className="h-5 w-5 text-amber-400" />
              <span className="text-amber-300 font-semibold">{t('noActiveLicense')}</span>
            </div>
            <p className="text-gray-400 text-sm">{t('enterKeyPrompt')}</p>
          </div>
        )}

        {reason && (
          <div className="rounded-xl border border-red-700/50 bg-red-900/30 p-4">
            <div className="flex items-center gap-2 mb-1">
              <CircleX className="h-5 w-5 text-red-400" />
              <span className="text-red-300 font-semibold">{t('activationFailed')}</span>
            </div>
            <p className="text-gray-400 text-sm">{reason}</p>
          </div>
        )}

        {activationSuccess && (
          <div className="rounded-xl border border-emerald-700/50 bg-emerald-900/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <CircleCheck className="h-5 w-5 text-emerald-400" />
              <span className="text-emerald-300 font-semibold">{t('activationSuccess')}</span>
            </div>
            <p className="text-gray-400 text-sm">{t('redirecting')}</p>
          </div>
        )}

        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4">
          <label htmlFor="license-key" className="block text-sm text-gray-400 mb-2">
            {t('licenseKey')}
          </label>
          <div className="flex gap-2">
            <input
              id="license-key"
              type="text"
              value={key}
              onChange={handleKeyChange}
              placeholder={t('keyPlaceholder')}
              className="flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-3 font-mono text-lg tracking-wider text-white uppercase placeholder:text-gray-600 focus:border-emerald-500 focus:outline-none transition-colors"
              disabled={isActivating || activationSuccess}
            />
            <button
              type="button"
              onClick={handleActivate}
              disabled={isActivating || activationSuccess || key.length < 10}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-gray-500"
            >
              <KeyRound className="h-4 w-4" />
              {isActivating ? t('activating') : activationSuccess ? t('activated') : t('activate')}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-300">{t('hardwareId')}</span>
            </div>
            {hwid && (
              <button
                type="button"
                onClick={handleCopyHwid}
                className="flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-white"
              >
                <Copy className="h-4 w-4" />
                {copied ? t('copied') : t('copy')}
              </button>
            )}
          </div>
          <code className="block break-all rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-gray-300 select-all">
            {hwid || t('generating')}
          </code>
          <p className="mt-2 text-xs text-gray-500">{t('hwidDescription')}</p>
          <p className="mt-1 text-xs text-gray-600">{t('licensedBy')}</p>
        </div>
      </div>
    </div>
  )
}
