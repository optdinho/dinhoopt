import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { SubItemDef } from './NavTypes'

export const FlyoutMenu = memo(function FlyoutMenu({
  buttonRef,
  popoverRef,
  items,
  badgeCounts,
  onSelect,
  onClose,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  popoverRef: React.RefObject<HTMLDivElement | null>
  items: SubItemDef[]
  badgeCounts?: Record<string, number>
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.top
    const menuHeight = items.length * 36 + 12
    const top = spaceBelow < menuHeight + 20 ? rect.bottom - menuHeight : rect.top
    setPos({ top, left: rect.right + 6 })
  }, [buttonRef, items.length])

  useEffect(() => {
    const firstItem = popoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    firstItem?.focus()
  }, [popoverRef])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const menuItems = popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    if (!menuItems?.length) return
    const currentIndex = Array.from(menuItems).indexOf(document.activeElement as HTMLElement)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        menuItems[(currentIndex + 1) % menuItems.length]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        menuItems[(currentIndex - 1 + menuItems.length) % menuItems.length]?.focus()
        break
      case 'Home':
        e.preventDefault()
        menuItems[0]?.focus()
        break
      case 'End':
        e.preventDefault()
        menuItems[menuItems.length - 1]?.focus()
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div
      ref={popoverRef}
      className="fixed z-[200] animate-scale-in"
      style={{ top: pos.top, left: pos.left, transformOrigin: 'left top' }}
      onKeyDown={handleKeyDown}
    >
      <div
        role="menu"
        className="glass-card w-56 rounded-xl py-1.5"
        style={{
          background: 'var(--flyout-bg)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.4), inset 0 1px 0 var(--glass-inset)',
        }}
      >
        {items.map((child) => {
          const isChildActive = location.pathname === child.path
          return (
            <button
              type="button"
              key={child.path}
              role="menuitem"
              onClick={() => onSelect(child.path)}
              className={cn(
                'flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[12.5px] font-medium transition-all duration-150',
                isChildActive ? 'text-amber-400' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
              )}
              style={isChildActive ? { background: 'var(--accent-muted-bg)' } : undefined}
            >
              <child.icon
                className="h-[14px] w-[14px] shrink-0"
                style={{ color: isChildActive ? 'var(--accent)' : 'var(--text-muted)' }}
                strokeWidth={1.7}
                aria-hidden="true"
              />
              <span className="flex-1">{child.labelKey ? t(child.labelKey) : child.label}</span>
              {(badgeCounts?.[child.path] ?? 0) > 0 && (
                <span
                  className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#0a0600',
                    boxShadow: '0 0 6px rgba(245,158,11,0.3)',
                  }}
                  aria-hidden="true"
                >
                  {badgeCounts![child.path]}
                </span>
              )}
              {child.badge && (
                <span
                  className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-bold leading-none"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#0a0600',
                    boxShadow: '0 0 6px rgba(245,158,11,0.3)',
                  }}
                >
                  NEW
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})
