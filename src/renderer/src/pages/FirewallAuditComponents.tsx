import { Checkbox } from '@/components/shared/Checkbox'
import { useFirewallStore } from '@/stores/firewall-store'
import type { FirewallIssue, FirewallRiskLevel, FirewallRule } from '@shared/types'
import { FileWarning, FileX, Globe, Inbox, Network } from 'lucide-react'

export const RISK_COLORS: Record<FirewallRiskLevel, { dot: string; bg: string; border: string; text: string }> = {
  high: { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.20)', text: '#ef4444' },
  medium: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)', text: '#f59e0b' },
  low: { dot: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.20)', text: '#22c55e' },
}

export const ISSUE_ICON: Record<FirewallIssue, typeof FileX> = {
  stale: FileX,
  unsigned: FileWarning,
  'broad-scope': Globe,
  'any-remote': Network,
}

export function RuleRow({ rule, t }: { rule: FirewallRule; t: (key: string, options?: Record<string, unknown>) => string }) {
  const colors = RISK_COLORS[rule.risk]
  return (
    <div
      className="flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3 transition-colors"
      style={{
        background: rule.selected ? colors.bg : 'var(--card-bg)',
        border: `1px solid ${rule.selected ? colors.border : 'var(--border-medium)'}`,
      }}
    >
      <div className="mt-1">
        <Checkbox
          checked={rule.selected}
          onChange={() => useFirewallStore.getState().toggleRule(rule.name)}
          aria-label={t('ariaSelectRule', { name: rule.displayName })}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white">{rule.displayName}</span>
          {rule.group && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
            >
              {rule.group}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          <span>
            Profiles:{' '}
            <span className="text-zinc-300">{rule.profiles.length ? rule.profiles.join(', ') : t('profileAny')}</span>
          </span>
          <span>
            {rule.protocol} {rule.localPort !== 'Any' && `· port ${rule.localPort}`}
          </span>
          <span>
            Remote: <span className="text-zinc-300">{rule.remoteAddress}</span>
          </span>
        </div>
        {rule.programResolved && (
          <div
            className="mt-1 truncate font-mono text-[11px]"
            style={{ color: rule.programExists ? 'var(--text-muted)' : '#ef4444' }}
            title={rule.programResolved}
          >
            {rule.programResolved}
          </div>
        )}
        {rule.issues.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rule.issues.map((issue) => {
              const Icon = ISSUE_ICON[issue]
              return (
                <span
                  key={issue}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                  style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                >
                  <Icon className="h-3 w-3" strokeWidth={2} />
                  {t(
                    `issue${issue === 'stale' ? 'ProgramMissing' : issue === 'unsigned' ? 'UnsignedBinary' : issue === 'broad-scope' ? 'PublicAnyPort' : 'AnyRemoteIp'}`,
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function StatBox({
  label,
  value,
  icon: Icon,
  color,
}: { label: string; value: number; icon: typeof Inbox; color: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color }} strokeWidth={2} />
      <div className="min-w-0">
        <div className="text-[18px] font-semibold tabular-nums text-white">{value}</div>
        <div className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {label}
        </div>
      </div>
    </div>
  )
}

export function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border-0 px-3 py-2 text-[13px] outline-none"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
