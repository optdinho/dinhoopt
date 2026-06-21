import { type ReactNode, useEffect, useRef } from 'react'

interface OutsideClickHandlerProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

export function OutsideClickHandler({ isOpen, onClose, children, className }: OutsideClickHandlerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, onClose])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
