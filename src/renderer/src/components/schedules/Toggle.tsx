import { cn } from '@/lib/utils'

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
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
