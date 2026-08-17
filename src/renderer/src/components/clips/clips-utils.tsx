import type { ClipsConfig } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type FilterTab = 'all' | 'today' | 'week' | 'favorites'

export const VK_MAP: Record<number, string> = {
  5: 'Mouse4',
  6: 'Mouse5',
  8: 'Backspace',
  9: 'Tab',
  12: 'Clear',
  13: 'Enter',
  19: 'Pause',
  20: 'CapsLock',
  27: 'Esc',
  32: 'Space',
  33: 'PageUp',
  34: 'PageDown',
  35: 'End',
  36: 'Home',
  37: '\u2190',
  38: '\u2191',
  39: '\u2192',
  40: '\u2193',
  44: 'PrintScreen',
  45: 'Insert',
  46: 'Delete',
  48: '0',
  49: '1',
  50: '2',
  51: '3',
  52: '4',
  53: '5',
  54: '6',
  55: '7',
  56: '8',
  57: '9',
  65: 'A',
  66: 'B',
  67: 'C',
  68: 'D',
  69: 'E',
  70: 'F',
  71: 'G',
  72: 'H',
  73: 'I',
  74: 'J',
  75: 'K',
  76: 'L',
  77: 'M',
  78: 'N',
  79: 'O',
  80: 'P',
  81: 'Q',
  82: 'R',
  83: 'S',
  84: 'T',
  85: 'U',
  86: 'V',
  87: 'W',
  88: 'X',
  89: 'Y',
  90: 'Z',
  91: 'Win',
  92: 'Win',
  93: 'Menu',
  96: 'Num0',
  97: 'Num1',
  98: 'Num2',
  99: 'Num3',
  100: 'Num4',
  101: 'Num5',
  102: 'Num6',
  103: 'Num7',
  104: 'Num8',
  105: 'Num9',
  106: 'Num*',
  107: 'Num+',
  109: 'Num-',
  110: 'Num.',
  111: 'Num/',
  112: 'F1',
  113: 'F2',
  114: 'F3',
  115: 'F4',
  116: 'F5',
  117: 'F6',
  118: 'F7',
  119: 'F8',
  120: 'F9',
  121: 'F10',
  122: 'F11',
  123: 'F12',
  124: 'F13',
  125: 'F14',
  126: 'F15',
  127: 'F16',
  128: 'F17',
  129: 'F18',
  130: 'F19',
  131: 'F20',
  132: 'F21',
  133: 'F22',
  134: 'F23',
  135: 'F24',
  144: 'NumLock',
  145: 'ScrollLock',
  160: 'LShift',
  161: 'RShift',
  162: 'LCtrl',
  163: 'RCtrl',
  164: 'LAlt',
  165: 'RAlt',
  186: ';',
  187: '=',
  188: ',',
  189: '-',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
  226: '\\',
}
export const MODIFIER_KEYS = new Set([0x11, 0x10, 0x12])
export const MODIFIER_MAP: Record<number, 'Ctrl' | 'Shift' | 'Alt'> = {
  17: 'Ctrl',
  16: 'Shift',
  18: 'Alt',
}
export const REPLAY_DURATIONS = [30, 60, 120, 300, 600]

export function formatUptime(seconds: number, t: (key: string) => string): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) return `${Math.floor(m / 60)}${t('hours')} ${m % 60}${t('minutes')}`
  if (m > 0) return `${m}${t('minutes')} ${s}${t('seconds')}`
  return `${s}${t('seconds')}`
}

export function formatKey(vk: number, modifiers: string[]): string {
  const order: Record<string, number> = { Ctrl: 0, Shift: 1, Alt: 2 }
  const parts = [...modifiers.sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99)), VK_MAP[vk] || `0x${vk.toString(16)}`]
  return parts.join('+')
}

/* ── Shared UI Components ── */

export function ConfigSection({
  icon: Icon,
  label,
  defaultOpen,
  content,
}: {
  icon: React.ElementType
  label: React.ReactNode
  defaultOpen: boolean
  content: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className="rounded-xl border overflow-hidden transition-all"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(!open)
          }
        }}
        className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold transition-colors hover:bg-white/[0.03]"
        style={{ color: 'var(--text-primary)' }}
      >
        <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-dim)' }} />
        <span className="flex-1 text-left">{label}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--text-dim)' }} />
        </motion.div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden will-change-transform"
          >
            <div className="px-4 pb-4">{content}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[10px] shrink-0" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={400}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(113,113,122,0.2) ${pct}%)`,
          accentColor: 'var(--accent)',
        }}
      />
      <span className="w-8 text-right text-[10px] font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {pct}%
      </span>
    </div>
  )
}

export function ToggleItem({
  label,
  enabled,
  accent,
  onToggle,
}: {
  label: React.ReactNode
  enabled: boolean
  accent: 'green' | 'amber' | 'blue'
  onToggle: () => void
}) {
  const colorMap = { green: '#22c55e', amber: '#f59e0b', blue: '#3b82f6' }
  const bgMap = {
    green: 'rgba(34,197,94,0.12)',
    amber: 'rgba(245,158,11,0.12)',
    blue: 'rgba(59,130,246,0.12)',
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[10px] font-medium transition-all hover:bg-white/[0.03]"
      style={{
        background: enabled ? bgMap[accent] : 'rgba(113,113,122,0.06)',
        color: enabled ? colorMap[accent] : 'var(--text-dim)',
      }}
    >
      <span>{label}</span>
      <span
        className="ml-2 rounded-full px-2 py-0.5 text-[8px] font-semibold"
        style={{ background: enabled ? `${colorMap[accent]}22` : 'rgba(113,113,122,0.15)' }}
      >
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

export function TogglePill({
  enabled,
  accent = 'blue',
  onToggle,
}: {
  enabled: boolean
  accent?: 'blue'
  onToggle: () => void
}) {
  const colorMap = { blue: '#3b82f6' }
  const c = colorMap[accent]
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all"
      style={{
        background: enabled ? `${c}22` : 'rgba(113,113,122,0.1)',
        color: enabled ? c : 'var(--text-dim)',
      }}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
  )
}

export function CollapsibleMini({
  label,
  defaultOpen,
  children,
}: {
  label: React.ReactNode
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg" style={{ background: 'rgba(113,113,122,0.04)' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium transition-colors hover:bg-white/[0.02]"
        style={{ color: 'var(--text-dim)' }}
      >
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="h-3 w-3" />
        </motion.div>
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mini-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden will-change-transform"
          >
            <div className="px-2.5 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function GamePickerBtn({
  config,
  onClear,
  onOpenPicker,
}: {
  config: ClipsConfig
  onClear: () => void
  onOpenPicker: () => void
}) {
  const { t } = useTranslation('clips')
  if (config.customGameProcess) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPicker}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
          style={{ background: 'rgba(113,113,122,0.12)', color: 'var(--text-dim)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.12)')}
        >
          {t('change')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all hover:bg-red-500/15"
          style={{ color: '#ef4444' }}
        >
          {t('clear')}
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpenPicker}
      className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
      style={{ background: 'rgba(113,113,122,0.12)', color: 'var(--text-dim)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.12)')}
    >
      {t('choose')}
    </button>
  )
}
