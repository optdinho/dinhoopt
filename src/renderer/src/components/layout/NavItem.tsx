import { ChevronRight } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { FlyoutMenu } from './FlyoutMenu'
import type { NavItemDef, SectionColor } from './NavTypes'

const sectionStyles: Record<SectionColor, { bg: string; bar: string; icon: string }> = {
  amber: { bg: 'bg-amber-500/[0.08]', bar: 'bg-amber-500', icon: 'text-amber-400' },
  red: { bg: 'bg-red-500/[0.08]', bar: 'bg-red-500', icon: 'text-red-400' },
  blue: { bg: 'bg-blue-500/[0.08]', bar: 'bg-blue-500', icon: 'text-blue-400' },
  green: { bg: 'bg-emerald-500/[0.08]', bar: 'bg-emerald-500', icon: 'text-emerald-400' },
  purple: { bg: 'bg-purple-500/[0.08]', bar: 'bg-purple-500', icon: 'text-purple-400' },
}

export const NavItem = memo(function NavItem({
  item,
  badge,
  badgeCount,
  badgeCounts,
  badgeLabel,
  isActive: isActiveProp,
  submenuOpen,
  onToggleSubmenu,
  onCloseSubmenu,
  collapsed,
  sectionColor = 'amber',
}: {
  item: NavItemDef
  badge?: boolean
  badgeCount?: number
  badgeCounts?: Record<string, number>
  badgeLabel?: string
  isActive?: boolean
  submenuOpen?: boolean
  openSubmenu?: string | null
  onToggleSubmenu?: (path: string) => void
  onCloseSubmenu?: () => void
  collapsed?: boolean
  sectionColor?: SectionColor
}) {
  const highlight = item.highlight
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = isActiveProp ?? location.pathname === item.path
  const hasChildren = item.children && item.children.length > 0
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const styles = sectionStyles[sectionColor]

  useEffect(() => {
    if (!submenuOpen) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        onCloseSubmenu?.()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [submenuOpen, onCloseSubmenu])

  const handleClick = () => {
    if (hasChildren) {
      onToggleSubmenu?.(item.path)
    }
    navigate(item.path)
  }

  return (
    <div className="relative">
      <button
        type="button"
        ref={buttonRef}
        onClick={handleClick}
        aria-current={isActive && !hasChildren ? 'page' : undefined}
        aria-expanded={hasChildren ? !!submenuOpen : undefined}
        aria-haspopup={hasChildren ? 'true' : undefined}
        className={cn(
          'group relative flex w-full items-center rounded-lg px-3 py-2 font-medium transition-all duration-200',
          collapsed ? 'justify-center gap-0' : 'gap-2.5',
          'text-[13px]',
          isActive ? cn(styles.bg, 'text-white') : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300',
        )}
      >
        {isActive && (
          <div
            className={cn(
              'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-200',
              styles.bar,
            )}
            style={{ boxShadow: `0 0 8px currentColor` }}
          />
        )}
        <item.icon
          className={cn(
            'h-[15px] w-[15px] shrink-0 transition-colors duration-200',
            isActive
              ? styles.icon
              : highlight
                ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.35)]'
                : 'text-zinc-600 group-hover:text-zinc-400',
          )}
          strokeWidth={1.7}
          aria-hidden="true"
        />
        {!collapsed && <span className="flex-1 text-left">{item.labelKey ? t(item.labelKey) : item.label}</span>}
        {!collapsed && (badge || (badgeCount != null && badgeCount > 0)) && (
          <span
            className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#0a0600',
              boxShadow: '0 0 8px rgba(245,158,11,0.3)',
            }}
            aria-label={`${badgeCount ?? 1}`}
          >
            {badgeCount ?? 1}
          </span>
        )}
        {!collapsed && badgeLabel && (
          <span
            className="flex h-[15px] items-center rounded-[3px] px-[5px] text-[8px] font-bold leading-none uppercase tracking-wider"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#0a0600',
            }}
          >
            {badgeLabel}
          </span>
        )}
        {!collapsed && hasChildren && (
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 transition-all duration-200',
              submenuOpen ? 'rotate-90 text-zinc-400' : 'text-zinc-600',
            )}
            strokeWidth={1.7}
            aria-hidden="true"
          />
        )}
      </button>

      {hasChildren && submenuOpen && (
        <FlyoutMenu
          buttonRef={buttonRef}
          popoverRef={popoverRef}
          items={item.children!}
          {...(badgeCounts !== undefined ? { badgeCounts } : {})}
          onSelect={(path) => {
            navigate(path)
            onCloseSubmenu?.()
          }}
          onClose={() => {
            onCloseSubmenu?.()
            buttonRef.current?.focus()
          }}
        />
      )}
    </div>
  )
})
