import logoSrc from '@/assets/logo.png'
import { usePlatform } from '@/hooks/usePlatform'
import { cn } from '@/lib/utils'
import { useDriverStore } from '@/stores/driver-store'
import { useGameModeStore } from '@/stores/game-mode-store'
import { useUpdaterStore } from '@/stores/updater-store'
import {
  Activity,
  BatteryCharging,
  Bug,
  CalendarClock,
  ClipboardCheck,
  CopyCheck,
  Cpu,
  Database,
  Download,
  Eraser,
  Eye,
  FileUp,
  Flame,
  FolderX,
  Gamepad2,
  Gauge,
  Globe,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  Menu,
  MousePointerClick,
  Package,
  PackageMinus,
  Radar,
  RotateCcw,
  Server,
  Shield,
  ShieldAlert,
  ShieldAlert as ShieldAlertIcon,
  Sliders,
  Sparkles,
  Trash2,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { NavItem } from './NavItem'
import type { NavGroup } from './NavTypes'

const navGroups: NavGroup[] = [
  {
    items: [{ icon: LayoutDashboard, labelKey: 'dashboard', path: '/' }],
  },
  {
    headingKey: 'securityHeading',
    items: [
      { icon: ShieldAlert, labelKey: 'malwareScanner', path: '/malware' },
      {
        icon: Shield,
        labelKey: 'systemHardening',
        path: '/hardening',
        children: [
          { icon: Eye, labelKey: 'privacy', path: '/privacy' },
          { icon: Server, labelKey: 'services', path: '/services' },
          { icon: Flame, labelKey: 'firewallAudit', path: '/firewall' },
          { icon: BatteryCharging, labelKey: 'powerPlans', path: '/power-plans' },
          { icon: Globe, labelKey: 'hostsEditor', path: '/hosts-editor' },
        ],
      },
      {
        icon: Radar,
        labelKey: 'monitoring',
        path: '/monitoring',
        children: [
          { icon: ClipboardCheck, labelKey: 'compliance', path: '/compliance' },
          { icon: Bug, labelKey: 'vulnerability', path: '/vulnerability' },
        ],
      },
    ],
  },
  {
    headingKey: 'maintainHeading',
    items: [
      { icon: Sparkles, labelKey: 'cleaner', path: '/cleaner' },
      { icon: Database, labelKey: 'registry', path: '/registry' },
      { icon: Zap, labelKey: 'startup', path: '/startup' },
      {
        icon: Wifi,
        labelKey: 'network',
        path: '/network',
        children: [{ icon: Wifi, labelKey: 'network', path: '/network' }],
      },
      {
        icon: Package,
        labelKey: 'software',
        path: '/software',
        children: [
          { icon: Download, labelKey: 'softwareUpdates', path: '/updates' },
          { icon: Cpu, labelKey: 'driverUpdates', path: '/drivers' },
          { icon: Trash2, labelKey: 'uninstaller', path: '/uninstaller' },
          { icon: PackageMinus, labelKey: 'bloatwareRemover', path: '/debloater' },
          { icon: MousePointerClick, labelKey: 'contextMenu', path: '/context-menu' },
        ],
      },
      { icon: CalendarClock, labelKey: 'schedules', path: '/schedules' },
      { icon: RotateCcw, labelKey: 'restorePoints', path: '/restore-points' },
    ],
  },
  {
    headingKey: 'toolsHeading',
    items: [
      { icon: Gamepad2, labelKey: 'gameMode', path: '/game-mode' },
      { icon: Sliders, labelKey: 'windowsTweaks', path: '/windows-tweaks' },
      { icon: Gauge, labelKey: 'benchmark', path: '/benchmark' },
      { icon: MemoryStick, labelKey: 'memoryOptimizer', path: '/memory' },
      { icon: Activity, labelKey: 'performance', path: '/performance' },
      {
        icon: HardDrive,
        labelKey: 'diskTools',
        path: '/disk',
        children: [
          { icon: HardDrive, labelKey: 'diskAnalyzer', path: '/disk' },
          { icon: CopyCheck, labelKey: 'duplicateFinder', path: '/duplicates' },
          { icon: FileUp, labelKey: 'largeFileFinder', path: '/large-files' },
          { icon: FolderX, labelKey: 'emptyFolderCleaner', path: '/empty-folders' },
          { icon: ShieldAlertIcon, labelKey: 'fileShredder', path: '/file-shredder' },
          { icon: Wrench, labelKey: 'diskRepair', path: '/disk-repair' },
          { icon: Eraser, labelKey: 'diskMaintenance', path: '/disk-maintenance' },
        ],
      },
    ],
  },
]

function useBadgeCounts(): Record<string, number> {
  const updaterApps = useUpdaterStore((s) => s.apps)
  const driverUpdates = useDriverStore((s) => s.updates)
  const gameModeActive = useGameModeStore((s) => s.active)

  const updatesCount = updaterApps.length + driverUpdates.length

  return {
    '/updates': updaterApps.length,
    '/software': updatesCount,
    '/drivers': driverUpdates.length,
    '/game-mode': gameModeActive ? 1 : 0,
  }
}

export const Sidebar = memo(function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const badgeCounts = useBadgeCounts()
  const { features } = usePlatform()
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: navGroups is a module-level const
  const filteredNavGroups = useMemo(
    () =>
      navGroups.map((group) => ({
        ...group,
        items: group.items
          .filter((item) => {
            if (item.path === '/registry' && !features.registry) return false
            if (item.path === '/game-mode' && !features.gameMode) return false
            if (item.path === '/windows-tweaks' && !features.windowsTweaks) return false
            if (item.path === '/benchmark' && !features.benchmark) return false
            return true
          })
          .map((item) => {
            if (!item.children) return item
            const filtered = item.children.filter((child) => {
              if (child.path === '/debloater' && !features.debloater) return false
              if (child.path === '/drivers' && !features.drivers) return false
              if (child.path === '/context-menu' && !features.contextMenu) return false
              if (child.path === '/firewall' && !features.firewallAudit) return false
              if (child.path === '/vulnerability' && !features.vulnerability) return false
              return true
            })
            return { ...item, children: filtered }
          })
          .filter((item) => {
            if (item.children && item.children.length === 0) return false
            return true
          }),
      })),
    [navGroups, features],
  )

  const effectiveBadgeCounts = useMemo(() => {
    const counts = { ...badgeCounts }
    for (const group of filteredNavGroups) {
      for (const item of group.items) {
        if (item.children && item.children.length > 0) {
          counts[item.path] = item.children.reduce((sum, child) => sum + (badgeCounts[child.path] ?? 0), 0)
        }
      }
    }
    return counts
  }, [badgeCounts, filteredNavGroups])

  const isPathActive = (item: { children?: { path: string }[]; path: string }) => {
    if (item.children) {
      return item.children.some((c) => c.path === location.pathname)
    }
    return location.pathname === item.path
  }

  return (
    <div
      className={cn('flex h-full shrink-0 flex-col transition-all duration-300', collapsed ? 'w-[60px]' : 'w-[240px]')}
      style={{
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-medium)',
      }}
    >
      <div
        className={cn('drag-region relative flex items-center gap-3 px-3 pb-3 pt-4', collapsed ? 'justify-center' : '')}
      >
        <div
          className="absolute h-8 w-8 rounded-xl opacity-25 blur-xl"
          style={{
            background: 'var(--accent)',
            ...(collapsed ? { left: '50%', marginLeft: '-16px' } : { left: '12px', top: '20px' }),
          }}
        />
        <img src={logoSrc} alt="DiNho Optimizer" className="relative h-8 w-8 shrink-0 rounded-xl" />
        {!collapsed && (
          <div>
            <div className="text-[13px] font-semibold text-white">{t('appName')}</div>
            <div className="text-[9px] font-medium tracking-wide" style={{ color: 'var(--text-dim)' }}>
              {t('subtitle')}
            </div>
          </div>
        )}
      </div>

      <nav className="mt-1 min-h-0 flex-1 overflow-y-auto px-3" aria-label={t('mainNavigation', 'Main navigation')}>
        {filteredNavGroups.map((group) => (
          <div
            key={group.headingKey || group.items.map((i: { id?: string; label?: string }) => i.id || i.label).join(',')}
            className={group.headingKey ? 'mt-3' : ''}
            role={group.headingKey ? 'group' : undefined}
            aria-labelledby={group.headingKey ? `nav-group-${group.headingKey}` : undefined}
          >
            {group.headingKey && (
              <div
                className={cn('flex items-center pt-0.5', collapsed ? 'justify-center px-0' : 'mb-1.5 gap-2.5 px-3')}
              >
                <span
                  id={`nav-group-${group.headingKey}`}
                  className={cn('text-[10px] font-semibold uppercase tracking-[0.15em]', collapsed ? 'text-[8px]' : '')}
                  style={{ color: 'var(--text-faint)' }}
                >
                  {collapsed ? t(group.headingKey).charAt(0) : t(group.headingKey)}
                </span>
                {!collapsed && <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />}
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavItem
                  key={item.path}
                  item={item}
                  badgeCount={effectiveBadgeCounts[item.path] ?? 0}
                  badgeCounts={effectiveBadgeCounts}
                  isActive={isPathActive(item)}
                  submenuOpen={openSubmenu === item.path}
                  collapsed={collapsed}
                  onToggleSubmenu={(path: string) => setOpenSubmenu((prev) => (prev === path ? null : path))}
                  onCloseSubmenu={() => setOpenSubmenu(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <BottomNav
        openSubmenu={openSubmenu}
        isPathActive={isPathActive}
        badgeCounts={effectiveBadgeCounts}
        collapsed={collapsed}
        onToggleSubmenu={(path: string) => setOpenSubmenu((prev) => (prev === path ? null : path))}
        onCloseSubmenu={() => setOpenSubmenu(null)}
      />
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-center py-2 text-zinc-500 transition-colors hover:text-zinc-300"
        aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
      >
        <Menu className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </div>
  )
})
