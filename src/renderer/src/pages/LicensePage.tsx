import { TriangleAlert, CircleCheck, Copy, Info, KeyRound, ShieldCheck, CircleX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLicenseStore } from '../stores/license-store'

export function LicensePage() {
  const { t } = useTranslation('license')
  const { hwid, isActivating, error, getHwid, activate, status } = useLicenseStore()
  const [key, setKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [activationSuccess, setActivationSuccess] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    getHwid()
  }, [getHwid])

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

  const alreadyActivated = status?.valid

  return (
    <div className="flex flex-col h-full p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="w-8 h-8 text-emerald-400" />
        <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
      </div>

      {alreadyActivated && (
        <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <CircleCheck className="w-6 h-6 text-emerald-400" />
            <span className="text-emerald-300 font-semibold">{t('activeLicense')}</span>
          </div>
          <p className="text-gray-400 text-sm">{t('activeLicenseDescription')}</p>
        </div>
      )}

      {!activationSuccess && !reason && !alreadyActivated && (
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <TriangleAlert className="w-6 h-6 text-amber-400" />
            <span className="text-amber-300 font-semibold">{t('noActiveLicense')}</span>
          </div>
          <p className="text-gray-400 text-sm">{t('enterKeyPrompt')}</p>
        </div>
      )}

      {reason && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <CircleX className="w-6 h-6 text-red-400" />
            <span className="text-red-300 font-semibold">{t('activationFailed')}</span>
          </div>
          <p className="text-gray-400 text-sm">{reason}</p>
        </div>
      )}

      {activationSuccess && (
        <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <CircleCheck className="w-6 h-6 text-emerald-400" />
            <span className="text-emerald-300 font-semibold">{t('activationSuccess')}</span>
          </div>
          <p className="text-gray-400 text-sm">{t('activationSuccessDescription')}</p>
        </div>
      )}

      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-5 mb-6">
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
            className="flex-1 bg-zinc-900 border border-zinc-600 rounded-lg px-4 py-3 text-white font-mono text-lg tracking-wider placeholder:text-gray-600 focus:outline-none focus:border-emerald-500 transition-colors uppercase"
            disabled={isActivating || activationSuccess}
          />
          <button
            type="button"
            onClick={handleActivate}
            disabled={isActivating || activationSuccess || key.length < 10}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-gray-500 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <KeyRound className="w-4 h-4" />
            {isActivating ? t('activating') : activationSuccess ? t('activated') : t('activate')}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-300">{t('hardwareId')}</span>
          </div>
          {hwid && (
            <button
              type="button"
              onClick={handleCopyHwid}
              className="flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-white"
              title={t('copyHwid')}
            >
              <Copy className="h-4 w-4" />
              {copied ? t('copied') : t('copyHwid')}
            </button>
          )}
        </div>
        <code className="block break-all rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-gray-300 select-all">
          {hwid || t('generating')}
        </code>
        <p className="mt-2 text-xs text-gray-500">{t('hwidDescription')}</p>
      </div>
    </div>
  )
}
