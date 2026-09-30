interface ToggleProps {
  checked: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  ariaLabel?: string
  'data-testid'?: string
}

export function Toggle({
  checked,
  disabled = false,
  onChange,
  label,
  ariaLabel,
  'data-testid': dataTestId,
}: ToggleProps) {
  const handleClick = () => {
    if (disabled) return
    onChange?.(!checked)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      data-testid={dataTestId}
      onClick={handleClick}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-emerald-500' : 'bg-zinc-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-4.5' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
