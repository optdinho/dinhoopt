import { cn } from '@/lib/utils'
import { useAppUpdateStore } from '@/stores/app-update-store'
import { History, Info, Settings, ShieldCheck } from 'lucide-react'
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
  const bottomNavItems = useBottomNavItems()

  return (
    <div
      className={cn(collapsed ? 'px-1 pb-1 pt-1' : 'px-3 pb-3 pt-2')}
      style={{ borderTop: '1px solid var(--border-subtle)' }}
    >
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
