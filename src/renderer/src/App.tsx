import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, Suspense, lazy, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from './components/layout/AppShell'
import { useScheduledScan } from './hooks/useScheduledScan'
import { RTL_LANGUAGES } from './lib/languages'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const CleanerPage = lazy(() => import('./pages/CleanerPage').then((m) => ({ default: m.CleanerPage })))
const RegistryPage = lazy(() => import('./pages/RegistryPage').then((m) => ({ default: m.RegistryPage })))
const ContextMenuCleanerPage = lazy(() =>
  import('./pages/ContextMenuCleanerPage').then((m) => ({ default: m.ContextMenuCleanerPage })),
)
const StartupPage = lazy(() => import('./pages/StartupPage').then((m) => ({ default: m.StartupPage })))
const DebloaterPage = lazy(() => import('./pages/DebloaterPage').then((m) => ({ default: m.DebloaterPage })))
const SoftwareUpdaterPage = lazy(() =>
  import('./pages/SoftwareUpdaterPage').then((m) => ({ default: m.SoftwareUpdaterPage })),
)
const DriverManagerPage = lazy(() =>
  import('./pages/DriverManagerPage').then((m) => ({ default: m.DriverManagerPage })),
)
const DiskAnalyzerPage = lazy(() => import('./pages/DiskAnalyzerPage').then((m) => ({ default: m.DiskAnalyzerPage })))
const DuplicateFinderPage = lazy(() =>
  import('./pages/DuplicateFinderPage').then((m) => ({ default: m.DuplicateFinderPage })),
)
const LargeFileFinderPage = lazy(() =>
  import('./pages/LargeFileFinderPage').then((m) => ({ default: m.LargeFileFinderPage })),
)
const EmptyFolderCleanerPage = lazy(() =>
  import('./pages/EmptyFolderCleanerPage').then((m) => ({ default: m.EmptyFolderCleanerPage })),
)
const FileShredderPage = lazy(() => import('./pages/FileShredderPage').then((m) => ({ default: m.FileShredderPage })))
const DiskRepairPage = lazy(() => import('./pages/DiskRepairPage').then((m) => ({ default: m.DiskRepairPage })))
const DiskMaintenancePage = lazy(() =>
  import('./pages/DiskMaintenancePage').then((m) => ({ default: m.DiskMaintenancePage })),
)
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const NetworkCleanupPage = lazy(() =>
  import('./pages/NetworkCleanupPage').then((m) => ({ default: m.NetworkCleanupPage })),
)
const MalwareScannerPage = lazy(() =>
  import('./pages/MalwareScannerPage').then((m) => ({ default: m.MalwareScannerPage })),
)
const PrivacyShieldPage = lazy(() =>
  import('./pages/PrivacyShieldPage').then((m) => ({ default: m.PrivacyShieldPage })),
)
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const PerformanceMonitorPage = lazy(() =>
  import('./pages/PerformanceMonitorPage').then((m) => ({ default: m.PerformanceMonitorPage })),
)
const UninstallerPage = lazy(() => import('./pages/UninstallerPage').then((m) => ({ default: m.UninstallerPage })))
const ServiceManagerPage = lazy(() =>
  import('./pages/ServiceManagerPage').then((m) => ({ default: m.ServiceManagerPage })),
)
const FirewallAuditPage = lazy(() =>
  import('./pages/FirewallAuditPage').then((m) => ({ default: m.FirewallAuditPage })),
)
const SchedulesPage = lazy(() => import('./pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })))
const GameModePage = lazy(() => import('./pages/GameModePage').then((m) => ({ default: m.GameModePage })))
const WindowsTweaksPage = lazy(() =>
  import('./pages/WindowsTweaksPage').then((m) => ({ default: m.WindowsTweaksPage })),
)
const BenchmarkPage = lazy(() => import('./pages/BenchmarkPage').then((m) => ({ default: m.BenchmarkPage })))
const ClipsPage = lazy(() => import('./pages/ClipsPage').then((m) => ({ default: m.ClipsPage })))
const MemoryOptimizerPage = lazy(() =>
  import('./pages/MemoryOptimizerPage').then((m) => ({ default: m.MemoryOptimizerPage })),
)
const PowerPlansPage = lazy(() => import('./pages/PowerPlansPage').then((m) => ({ default: m.PowerPlansPage })))
const CompliancePage = lazy(() => import('./pages/CompliancePage').then((m) => ({ default: m.CompliancePage })))
const VulnerabilityScannerPage = lazy(() =>
  import('./pages/VulnerabilityScannerPage').then((m) => ({ default: m.VulnerabilityScannerPage })),
)
const HostsEditorPage = lazy(() => import('./pages/HostsEditorPage').then((m) => ({ default: m.HostsEditorPage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })))
const LicensePage = lazy(() => import('./pages/LicensePage').then((m) => ({ default: m.LicensePage })))
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import LicenseGate from './components/LicenseGate'
import { Onboarding } from './components/Onboarding'
import { useBackgroundScans } from './hooks/useBackgroundScans'
import { PlatformContext, usePlatformLoader } from './hooks/usePlatform'
import { useAppUpdateStore } from './stores/app-update-store'
import { initGameModeStore } from './stores/game-mode-store'
import { useHistoryStore } from './stores/history-store'
import { useSettingsStore } from './stores/settings-store'
import { useStatsStore } from './stores/stats-store'

export function App() {
  const { i18n } = useTranslation()
  const loadHistory = useHistoryStore((s) => s.load)
  const historyLoaded = useHistoryStore((s) => s.loaded)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const theme = useSettingsStore((s) => s.settings.theme)

  // Apply theme class to <html> element
  useEffect(() => {
    const root = document.documentElement
    const apply = (mode: 'dark' | 'light') => {
      root.classList.remove('dark', 'light')
      root.classList.add(mode)
    }
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    apply(theme ?? 'dark')
  }, [theme])

  // Sync RTL direction and lang attribute based on current language
  useEffect(() => {
    const html = document.documentElement
    html.dir = RTL_LANGUAGES.includes(i18n.language) ? 'rtl' : 'ltr'
    html.lang = i18n.language
  }, [i18n.language])

  useEffect(() => {
    const p = window.dinho?.onboardingGet?.()
    if (p) {
      p.then((done) => {
        setShowOnboarding(!done)
        setOnboardingChecked(true)
      }).catch(() => setOnboardingChecked(true))
    } else {
      setShowOnboarding(true)
      setOnboardingChecked(true)
    }
  }, [])

  const handleOnboardingComplete = () => {
    window.dinho?.onboardingSet?.(true).catch(() => {})
    setShowOnboarding(false)
  }

  useEffect(() => {
    if (!historyLoaded) loadHistory()
  }, [historyLoaded, loadHistory])

  useEffect(() => {
    if (historyLoaded) recomputeStats()
  }, [historyLoaded, recomputeStats])

  const platformInfo = usePlatformLoader()

  useScheduledScan()

  // Run software-update & driver-update scans silently in the background
  useBackgroundScans()

  // Initialize app update checker on mount
  const initAppUpdate = useAppUpdateStore((s) => s.init)
  useEffect(() => {
    const cleanup = initAppUpdate()
    return cleanup
  }, [initAppUpdate])

  // Hydrate Game Mode status so the sidebar badge works on all pages
  useEffect(() => {
    initGameModeStore()
  }, [])

  if (!onboardingChecked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#09090b' }}>
        <div className="flex flex-col items-center gap-4">
          <img src="" alt="" className="h-16 w-16 rounded-2xl" style={{ visibility: 'hidden' }} />
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
        </div>
      </div>
    )
  }

  return (
    <PlatformContext value={platformInfo}>
      <HashRouter>
        <PageTitleUpdater />
        {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
        <LicenseGate>
          <AppShell>
            <ErrorBoundary>
              <Suspense fallback={null}>
                <AnimatedRoutes />
              </Suspense>
            </ErrorBoundary>
          </AppShell>
        </LicenseGate>
        <Toaster
          position="bottom-right"
          theme={theme === 'system' ? 'system' : theme}
          toastOptions={{
            style: {
              background: 'var(--toast-bg)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--border-strong)',
              color: 'var(--toast-text)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 var(--glass-inset)',
            },
          }}
        />
      </HashRouter>
    </PlatformContext>
  )
}

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

const pageTransition = {
  type: 'tween' as const,
  ease: 'easeOut' as const,
  duration: 0.2,
}

function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
      className="flex h-full w-full flex-col"
    >
      {children}
    </motion.div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  const wrap = (element: ReactNode) => <PageTransition>{element}</PageTransition>
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={wrap(<DashboardPage />)} />
        <Route path="/cleaner" element={wrap(<CleanerPage />)} />
        <Route path="/registry" element={wrap(<RegistryPage />)} />
        <Route path="/context-menu" element={wrap(<ContextMenuCleanerPage />)} />
        <Route path="/startup" element={wrap(<StartupPage />)} />
        <Route path="/disk" element={wrap(<DiskAnalyzerPage />)} />
        <Route path="/duplicates" element={wrap(<DuplicateFinderPage />)} />
        <Route path="/large-files" element={wrap(<LargeFileFinderPage />)} />
        <Route path="/empty-folders" element={wrap(<EmptyFolderCleanerPage />)} />
        <Route path="/file-shredder" element={wrap(<FileShredderPage />)} />
        <Route path="/disk-repair" element={wrap(<DiskRepairPage />)} />
        <Route path="/disk-maintenance" element={wrap(<DiskMaintenancePage />)} />
        <Route path="/network" element={wrap(<NetworkCleanupPage />)} />
        <Route path="/hosts-editor" element={wrap(<HostsEditorPage />)} />
        <Route path="/malware" element={wrap(<MalwareScannerPage />)} />
        <Route path="/game-mode" element={wrap(<GameModePage />)} />
        <Route path="/windows-tweaks" element={wrap(<WindowsTweaksPage />)} />
        <Route path="/benchmark" element={wrap(<BenchmarkPage />)} />
        <Route path="/clips" element={wrap(<ClipsPage />)} />
        <Route path="/memory" element={wrap(<MemoryOptimizerPage />)} />
        <Route path="/performance" element={wrap(<PerformanceMonitorPage />)} />
        <Route path="/uninstaller" element={wrap(<UninstallerPage />)} />
        <Route path="/history" element={wrap(<HistoryPage />)} />
        <Route path="/settings" element={wrap(<SettingsPage />)} />
        <Route path="/about" element={wrap(<AboutPage />)} />
        <Route path="/hardening" element={<Navigate to="/privacy" replace />} />
        <Route path="/privacy" element={wrap(<PrivacyShieldPage />)} />
        <Route path="/services" element={wrap(<ServiceManagerPage />)} />
        <Route path="/compliance" element={wrap(<CompliancePage />)} />
        <Route path="/vulnerability" element={wrap(<VulnerabilityScannerPage />)} />
        <Route path="/firewall" element={wrap(<FirewallAuditPage />)} />
        <Route path="/power-plans" element={wrap(<PowerPlansPage />)} />
        <Route path="/debloater" element={wrap(<DebloaterPage />)} />
        <Route path="/updates" element={wrap(<SoftwareUpdaterPage />)} />
        <Route path="/schedules" element={wrap(<SchedulesPage />)} />
        <Route path="/activation" element={wrap(<LicensePage />)} />
        <Route path="/updater" element={<Navigate to="/updates" replace />} />
        <Route path="/drivers" element={wrap(<DriverManagerPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

// Maps routes to page titles for the window/tab title.
// Uses sidebar i18n keys where possible; nested routes use plain strings
// so each page gets its own distinct title for screen readers / OS window switcher.
const ROUTE_TITLES: Record<string, { key: string; ns?: string } | string> = {
  '/': { key: 'dashboard' },
  '/cleaner': { key: 'cleaner' },
  '/registry': { key: 'registry' },
  '/context-menu': 'Context Menu Cleaner',
  '/startup': { key: 'startup' },
  '/disk': 'Disk Analyzer',
  '/duplicates': 'Duplicate Finder',
  '/large-files': 'Large File Finder',
  '/empty-folders': 'Empty Folder Cleaner',
  '/file-shredder': 'File Shredder',

  '/disk-repair': 'Disk Repair',
  '/disk-maintenance': 'Disk Maintenance',
  '/network': { key: 'network' },
  '/hosts-editor': 'Hosts Editor',
  '/malware': { key: 'malwareScanner' },
  '/game-mode': { key: 'gameMode' },
  '/windows-tweaks': 'Windows Tweaks',
  '/benchmark': 'Benchmark',
  '/clips': { key: 'clips' },
  '/memory': 'Memory Optimizer',
  '/performance': { key: 'performance' },
  '/uninstaller': 'Uninstaller',
  '/history': { key: 'history' },
  '/settings': { key: 'settings' },
  '/about': 'About',
  '/privacy': 'Privacy',
  '/services': 'Services',
  '/compliance': { key: 'compliance' },
  '/vulnerability': { key: 'vulnerability' },
  '/firewall': 'Firewall Audit',
  '/power-plans': 'Power Plans',
  '/debloater': 'Bloatware Remover',
  '/updates': 'Software Updates',
  '/activation': 'Activation',
  '/schedules': { key: 'schedules' },
  '/drivers': 'Driver Updates',
}

function PageTitleUpdater() {
  const location = useLocation()
  const { t } = useTranslation('sidebar')
  useEffect(() => {
    const entry = ROUTE_TITLES[location.pathname]
    let name: string | null = null
    if (typeof entry === 'string') {
      name = entry
    } else if (entry) {
      name = t(entry.key)
    }
    document.title = name ? `${name} - DiNho Optimizer` : 'DiNho Optimizer'
  }, [location.pathname, t])
  return null
}
