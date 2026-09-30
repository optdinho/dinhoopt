import { cn } from '@/lib/utils'

export function Toggle({
  checked,
  onChange,
  testId,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  testId?: string
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-active)' }}
    >
      <div
        className={cn(
          'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}
