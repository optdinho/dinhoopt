import { AnimatePresence, motion } from 'framer-motion'
import {
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Loader2,
  Monitor,
  Rocket,
  Shield,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import logoSrc from '@/assets/logo.png'
import { usePlatform } from '@/hooks/usePlatform'
import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { formatBytes } from '@/lib/utils'

interface OnboardingProps {
  onComplete: () => void
}

export type UserProfile = 'gamer' | 'professional' | 'general'

interface OnboardingSettings {
  runAtStartup: boolean
  minimizeToTray: boolean
  scheduledClean: boolean
  userProfile: UserProfile
  healthScanResult: HealthScanResult | null
}

interface HealthScanResult {
  itemsFound: number
  spaceRecovered: number
  score: number
  duration: number
}

const TOTAL_STEPS = 5

const USER_TYPES = [
  {
    id: 'gamer' as const,
    icon: Gamepad2,
    color: '#06b6d4',
    highlight: 'gameMode',
  },
  {
    id: 'professional' as const,
    icon: Briefcase,
    color: '#8b5cf6',
    highlight: 'privacy',
  },
  {
    id: 'general' as const,
    icon: Monitor,
    color: '#f59e0b',
    highlight: 'cleaning',
  },
]

export function Onboarding({ onComplete }: OnboardingProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<OnboardingSettings>({
    runAtStartup: true,
    minimizeToTray: true,
    scheduledClean: true,
    userProfile: 'general',
    healthScanResult: null,
  })

  const applyAndFinish = async () => {
    try {
      const settingsPayload: Record<string, unknown> = {
        runAtStartup: settings.runAtStartup,
        minimizeToTray: settings.minimizeToTray,
        userProfile: settings.userProfile,
      }
      if (settings.scheduledClean) {
        settingsPayload.schedule = { enabled: true, frequency: 'weekly', day: 1, hour: 9 }
      }
      await window.dinho?.settingsSet?.(settingsPayload)
      await window.dinho?.applyStartup?.(settings.runAtStartup).catch(() => {})
      window.dinho?.applyTray?.(settings.minimizeToTray)
    } catch {
      // Best-effort
    }
    onComplete()
    navigate('/')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-lg rounded-2xl p-8"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
      >
        <AnimatePresence mode="wait">
          {step === 0 && <WelcomeStep key="welcome" onNext={() => setStep(1)} />}
          {step === 1 && (
            <UserTypeStep
              key="userType"
              selected={settings.userProfile}
              onSelect={(profile) => setSettings((s) => ({ ...s, userProfile: profile }))}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <SettingsStep
              key="settings"
              settings={settings}
              onChange={setSettings}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <HealthCheckStep
              key="healthCheck"
              result={settings.healthScanResult}
              onResult={(result) => setSettings((s) => ({ ...s, healthScanResult: result }))}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <FinishStep
              key="finish"
              scheduledClean={settings.scheduledClean}
              onBack={() => setStep(3)}
              onFinish={applyAndFinish}
            />
          )}
        </AnimatePresence>

        {/* Step dots */}
        <div className="mt-8 flex justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i).map((stepIdx) => (
            <div
              key={stepIdx}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: stepIdx === step ? 24 : 8,
                background: stepIdx === step ? 'var(--accent)' : 'var(--bg-active)',
              }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}

function StepWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  )
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation('onboarding')
  const { platform } = usePlatform()
  const isWin = platform === 'win32'
  return (
    <StepWrapper>
      <div className="flex flex-col items-center text-center">
        <img src={logoSrc} alt="DiNho Optimizer" className="mb-5 h-20 w-20 rounded-2xl" />
        <h2 className="mb-2 text-[22px] font-bold text-zinc-100">{t('welcomeTitle')}</h2>
        <p className="mb-2 text-[13px] leading-relaxed text-zinc-400">
          {isWin ? t('welcomeDescriptionWindows') : t('welcomeDescriptionOther')}
        </p>
        <div className="mb-6 mt-4 flex gap-4">
          <Feature icon={Sparkles} label={t('featureSmartCleaning')} />
          <Feature icon={Rocket} label={t('featureFasterBoot')} />
          <Feature icon={Check} label={t('featureSafeSecure')} />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-2 rounded-xl px-8 py-3 text-[14px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {t('getStarted')} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </StepWrapper>
  )
}

function Feature({ icon: Icon, label }: { icon: typeof Sparkles; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: 'var(--accent-muted-bg)' }}
      >
        <Icon className="h-4.5 w-4.5" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
      </div>
      <span className="text-[11px] font-medium text-zinc-500">{label}</span>
    </div>
  )
}

function UserTypeStep({
  selected,
  onSelect,
  onBack,
  onNext,
}: {
  selected: UserProfile
  onSelect: (profile: UserProfile) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useTranslation('onboarding')
  return (
    <StepWrapper>
      <div>
        <h2 className="mb-1 text-[18px] font-bold text-zinc-100">{t('userTypeTitle')}</h2>
        <p className="mb-6 text-[13px] text-zinc-500">{t('userTypeDescription')}</p>

        <StaggerContainer className="space-y-2">
          {USER_TYPES.map((ut) => {
            const isActive = selected === ut.id
            return (
              <StaggerItem key={ut.id}>
                <button
                  type="button"
                  onClick={() => onSelect(ut.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 transition-all"
                  style={{
                    background: isActive ? `${ut.color}15` : 'var(--bg-subtle)',
                    border: isActive ? `1px solid ${ut.color}30` : '1px solid transparent',
                  }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `${ut.color}15` }}
                  >
                    <ut.icon className="h-5 w-5" style={{ color: ut.color }} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-[13px] font-medium text-zinc-200">
                      {t(`userType${ut.id.charAt(0).toUpperCase() + ut.id.slice(1)}`)}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {t(`userType${ut.id.charAt(0).toUpperCase() + ut.id.slice(1)}Desc`)}
                    </p>
                  </div>
                  {isActive && (
                    <Check className="h-4 w-4 shrink-0" style={{ color: ut.color }} strokeWidth={2} />
                  )}
                </button>
              </StaggerItem>
            )
          })}
        </StaggerContainer>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-500 transition-colors"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {t('back')}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {t('continue')} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </StepWrapper>
  )
}

function SettingsStep({
  settings,
  onChange,
  onBack,
  onNext,
}: {
  settings: OnboardingSettings
  onChange: (s: OnboardingSettings) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useTranslation('onboarding')
  const { platform } = usePlatform()
  const isWin = platform === 'win32'
  return (
    <StepWrapper>
      <div>
        <h2 className="mb-1 text-[18px] font-bold text-zinc-100">{t('recommendedSetupTitle')}</h2>
        <p className="mb-6 text-[13px] text-zinc-500">{t('recommendedSetupDescription')}</p>

        <div className="space-y-1">
          <SettingRow
            label={t('runAtStartupLabel')}
            desc={isWin ? t('runAtStartupDescriptionWindows') : t('runAtStartupDescriptionOther')}
            checked={settings.runAtStartup}
            onChange={(v) => onChange({ ...settings, runAtStartup: v })}
          />
          <SettingRow
            label={t('minimizeToTrayLabel')}
            desc={t('minimizeToTrayDescription')}
            checked={settings.minimizeToTray}
            onChange={(v) => onChange({ ...settings, minimizeToTray: v })}
          />
          <SettingRow
            label={t('weeklyAutoCleanLabel')}
            desc={t('weeklyAutoCleanDescription')}
            checked={settings.scheduledClean}
            onChange={(v) => onChange({ ...settings, scheduledClean: v })}
            last
          />
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-500 transition-colors"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {t('back')}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {t('continue')} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </StepWrapper>
  )
}

function HealthCheckStep({
  result,
  onResult,
  onBack,
  onNext,
}: {
  result: HealthScanResult | null
  onResult: (r: HealthScanResult) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useTranslation('onboarding')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)

  const runHealthCheck = async () => {
    setScanning(true)
    setProgress(0)
    const startTime = Date.now()
    const maxDuration = 10_000

    try {
      const stepDuration = 800
      const steps = Math.ceil(maxDuration / stepDuration)

      for (let i = 0; i < steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, stepDuration))
        setProgress(Math.min(((i + 1) / steps) * 100, 95))
      }

      const scanResult = await window.dinho?.systemScan?.()
      const itemsFound = Array.isArray(scanResult) ? scanResult.reduce((s, r) => s + r.itemCount, 0) : 0
      const spaceRecovered = Array.isArray(scanResult)
        ? scanResult.reduce((s, r) => s + r.totalSize, 0)
        : 0
      const duration = Date.now() - startTime
      const score = Math.max(10, 100 - Math.min(itemsFound / 10, 50))

      setProgress(100)
      onResult({ itemsFound, spaceRecovered, score, duration })
    } catch {
      onResult({ itemsFound: 0, spaceRecovered: 0, score: 100, duration: Date.now() - startTime })
    }
    setScanning(false)
  }

  return (
    <StepWrapper>
      <div className="flex flex-col items-center text-center">
        <div
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(59,130,246,0.1)' }}
        >
          <Shield className="h-8 w-8 text-blue-500" strokeWidth={1.8} />
        </div>
        <h2 className="mb-2 text-[18px] font-bold text-zinc-100">{t('healthCheckTitle')}</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-zinc-400">{t('healthCheckDescription')}</p>

        {scanning && (
          <div className="mb-5 w-full">
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'var(--accent)' }}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('healthCheckScanning')}
            </p>
          </div>
        )}

        {result && !scanning && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 w-full rounded-xl p-4"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('healthCheckScore')}
                </p>
                <p className="text-[20px] font-bold text-zinc-200">{result.score}%</p>
              </div>
              <div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('healthCheckItems')}
                </p>
                <p className="text-[20px] font-bold text-zinc-200">{result.itemsFound.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('healthCheckSpace')}
                </p>
                <p className="text-[20px] font-bold text-green-500">{formatBytes(result.spaceRecovered)}</p>
              </div>
              <div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('healthCheckDuration')}
                </p>
                <p className="text-[20px] font-bold text-zinc-200">
                  {(result.duration / 1000).toFixed(1)}s
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {!result && !scanning && (
          <button
            type="button"
            onClick={runHealthCheck}
            className="flex items-center gap-2 rounded-xl px-6 py-3 text-[14px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            <Shield className="h-4 w-4" strokeWidth={2} />
            {t('healthCheckButton')}
          </button>
        )}

        <div className="mt-6 flex items-center justify-between w-full">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-500 transition-colors"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {t('back')}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {result ? t('continue') : t('skip')} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </StepWrapper>
  )
}

function SettingRow({
  label,
  desc,
  checked,
  onChange,
  last,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
  last?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3.5"
      style={{
        background: 'var(--bg-subtle)',
        ...(last ? {} : { marginBottom: 4 }),
      }}
    >
      <div className="mr-4">
        <p className="text-[13px] font-medium text-zinc-300">{label}</p>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {desc}
        </p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-active)' }}
    >
      <div
        className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-[3px]'}`}
      />
    </button>
  )
}

function FinishStep({
  scheduledClean,
  onBack,
  onFinish,
}: {
  scheduledClean: boolean
  onBack: () => void
  onFinish: () => void
}) {
  const { t } = useTranslation('onboarding')
  return (
    <StepWrapper>
      <div className="flex flex-col items-center text-center">
        <div
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(34,197,94,0.1)' }}
        >
          <Check className="h-8 w-8" style={{ color: '#22c55e' }} strokeWidth={1.8} />
        </div>
        <h2 className="mb-2 text-[18px] font-bold text-zinc-100">{t('allSetTitle')}</h2>
        <p className="mb-1 text-[13px] leading-relaxed text-zinc-400">{t('allSetDescription')}</p>
        {scheduledClean && (
          <p className="text-[12px]" style={{ color: 'var(--accent)' }}>
            {t('firstScanScheduled')}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-500 transition-colors"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {t('back')}
          </button>
          <button
            type="button"
            onClick={onFinish}
            className="flex items-center gap-2 rounded-xl px-8 py-3 text-[14px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {t('startCleaning')} <Rocket className="h-4 w-4" />
          </button>
        </div>
      </div>
    </StepWrapper>
  )
}
