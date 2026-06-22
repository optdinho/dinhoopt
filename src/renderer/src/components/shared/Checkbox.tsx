import { cn } from '@/lib/utils'

const sizeMap = {
  sm: {
    box: 'h-4 w-4',
    rounded: 'rounded',
    svg: 'h-2.5 w-2.5',
    viewBox: '0 0 10 10',
    path: 'M2 5L4.2 7.5L8 2.5',
    strokeWidth: '1.5',
  },
  md: {
    box: 'h-[18px] w-[18px]',
    rounded: 'rounded-[5px]',
    svg: 'h-3 w-3',
    viewBox: '0 0 12 12',
    path: 'M2.5 6l2.5 2.5 4.5-5',
    strokeWidth: '2',
  },
} as const

interface CheckboxProps {
  checked: boolean
  onChange?: () => void
  disabled?: boolean
  color?: string
  glow?: string
  size?: keyof typeof sizeMap
  'aria-label'?: string
}

export function Checkbox({
  checked,
  onChange,
  disabled,
  color,
  glow,
  size = 'md',
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const s = sizeMap[size]
  const bg = disabled ? 'var(--bg-hover-2)' : checked ? (color ?? 'var(--accent)') : 'var(--bg-hover-2)'
  const border = disabled ? 'none' : checked ? 'none' : '1.5px solid var(--border-stronger)'
  const shadow = disabled ? undefined : checked ? `0 0 8px ${glow ?? 'rgba(245,158,11,0.25)'}` : undefined
  const cursor = disabled ? 'cursor-not-allowed' : onChange ? 'cursor-pointer' : undefined

  const box = (
    <div
      className={cn('flex items-center justify-center transition-all', s.box, s.rounded)}
      style={{ background: bg, border, boxShadow: shadow }}
    >
      {checked && (
        <svg className={s.svg} viewBox={s.viewBox} fill="none" role="img" aria-label={ariaLabel ?? 'Checked'}>
          <title>{ariaLabel ?? 'Checked'}</title>
          <path d={s.path} stroke="#fff" strokeWidth={s.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )

  if (onChange) {
    return (
      <label className={cn('relative inline-flex shrink-0', cursor)}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="sr-only"
          aria-label={ariaLabel}
        />
        {box}
      </label>
    )
  }

  return <span className={cn('relative inline-flex shrink-0', cursor)}>{box}</span>
}
