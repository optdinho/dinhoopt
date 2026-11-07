import {
  CalendarClock,
  CircleCheck,
  CircleX,
  Copy,
  Info,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLicenseExpiry } from '../lib/license-validity'
import { useLicenseStore } from '../stores/license-store'

export function LicensePage() {
  const { t, i18n } = useTranslation('license')
  const { hwid, isActivating, error, getHwid, activate, status, checkStatus } = useLicenseStore()
  const [key, setKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [activationSuccess, setActivationSuccess] = useState(false)
  const [reason, setReason] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState('')

  useEffect(() => {
    getHwid()
  }, [getHwid])

  const handleCopyHwid = async () => {
    if (!hwid) return
    try {
      await navigator.clipboard.writeText(hwid)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = hwid
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Silently ignore copy failures
      }
    }
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

  const handleRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setRefreshNotice('')
    const result = await checkStatus()
    if (!result.valid) setRefreshNotice(result.reason || t('notActiveYet'))
    setIsRefreshing(false)
  }

  const handleRenew = () => {
    void window.dinho.openExternal('https://dinhooptimizer.netlify.app/')
  }

  const alreadyActivated = status?.valid
  const expiry = alreadyActivated ? getLicenseExpiry(status?.expires_at) : null
  const isLifetimeLicense = alreadyActivated && status?.expires_at === null
  const expiryToneClass =
    expiry?.tone === 'critical' ? 'text-red-300' : expiry?.tone === 'warning' ? 'text-amber-300' : 'text-emerald-300'

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
          {expiry && (
            <div
              data-testid="license-expiry"
              data-tone={expiry.tone}
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            >
              <CalendarClock className={`h-4 w-4 ${expiryToneClass}`} />
              <span className={`font-semibold ${expiryToneClass}`}>
                {expiry.daysLeft > 0
                  ? t('daysRemaining', { count: expiry.daysLeft })
                  : expiry.daysLeft === 0
                    ? t('expiresToday')
                    : t('licenseExpired')}
              </span>
              <span className="text-gray-400">
                {t('expiresOn', { date: expiry.expiresAt.toLocaleDateString(i18n.language) })}
              </span>
            </div>
          )}
          {!expiry && isLifetimeLicense && (
            <p data-testid="license-lifetime" className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
              <CalendarClock className="h-4 w-4" />
              {t('lifetimeLicense')}
            </p>
          )}
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

      <div className="grid grid-cols-2 gap-2 mb-6">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing || isActivating}
          className="flex items-center justify-center gap-2 bg-zinc-800/50 border border-zinc-600 hover:bg-zinc-700/60 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-200 px-4 py-3 rounded-lg font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? t('refreshing') : t('refreshStatus')}
        </button>
        <button
          type="button"
          onClick={handleRenew}
          className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg font-medium transition-colors"
        >
          <ShoppingCart className="w-4 h-4" />
          {t('renewNow')}
        </button>
      </div>

      {refreshNotice && <p className="text-amber-400 text-sm text-center mb-6">{refreshNotice}</p>}

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
