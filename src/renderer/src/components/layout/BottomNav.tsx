import { cn } from '@/lib/utils'
import { useAppUpdateStore } from '@/stores/app-update-store'
import { History, Info, Settings, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavItem } from './NavItem'
import type { NavItemDef } from './NavTypes'

function useBottomNavItems(): NavItemDef[] {
  const updateState = useAppUpdateStore((s) => s.status.state)
  const showUpdateBadge = updateState === 'available' || updateState === 'downloaded'

  return [
    {
      icon: Settings,
      labelKey: 'settings',
      path: '/settings',
      children: [
        { icon: Settings, labelKey: 'preferences', path: '/settings' },
        { icon: History, labelKey: 'history', path: '/history' },
        { icon: Info, labelKey: 'aboutUpdates', path: '/about', badge: showUpdateBadge },
        { icon: ShieldCheck, labelKey: 'activation', path: '/activation' },
      ],
    },
  ]
}

export function BottomNav({
  openSubmenu,
  isPathActive,
  badgeCounts,
  collapsed,
  onToggleSubmenu,
  onCloseSubmenu,
}: {
  openSubmenu: string | null
  isPathActive: (item: NavItemDef) => boolean
  badgeCounts: Record<string, number>
  collapsed: boolean
  onToggleSubmenu: (path: string) => void
  onCloseSubmenu: () => void
}) {
  const { t } = useTranslation('sidebar')
  const bottomNavItems = useBottomNavItems()

  return (
    <div
      className={cn(collapsed ? 'px-1 pb-1 pt-1' : 'px-3 pb-3 pt-2')}
      style={{ borderTop: '1px solid var(--border-subtle)' }}
    >
      <div className={cn('mb-1', collapsed ? 'px-0 text-center' : 'px-3')}>
        <span
          className={cn('text-[10px] font-semibold uppercase tracking-[0.15em]', collapsed ? 'text-[8px]' : '')}
          style={{ color: 'var(--text-faint)' }}
        >
          {collapsed ? t('settingsHeading').charAt(0) : t('settingsHeading')}
        </span>
      </div>
      {bottomNavItems.map((item) => (
        <NavItem
          key={item.path}
          item={item}
          badgeCount={badgeCounts[item.path] ?? 0}
          badgeCounts={badgeCounts}
          isActive={isPathActive(item)}
          submenuOpen={openSubmenu === item.path}
          collapsed={collapsed}
          onToggleSubmenu={onToggleSubmenu}
          onCloseSubmenu={onCloseSubmenu}
        />
      ))}
    </div>
  )
}
