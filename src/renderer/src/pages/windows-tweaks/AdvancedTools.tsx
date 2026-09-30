import type { CurrentDns, DnsBenchmarkResult, DnsPreset, GamingTimerStatus } from '@shared/types'
import { ExternalLink, Globe, Info, Loader2, Timer, TriangleAlert, Zap, ZapOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from '@/components/schedules/Toggle'
import { rankDnsPresets } from './dns-ranking'

const DOCS = {
  tcpip: 'https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-interface',
  dns: 'https://learn.microsoft.com/en-us/windows-server/networking/dns/dns-overview',
  timer: 'https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/bcdedit--set',
} as const

const ACCENTS = {
  cyan: { color: '#22d3ee', glow: 'rgba(34,211,238,0.12)' },
  orange: { color: '#fb923c', glow: 'rgba(251,146,60,0.12)' },
} as const

export type TimerSettings = Partial<Pick<GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>>

export interface AdvancedToolsProps {
  applying: boolean
  dnsPresets: DnsPreset[]
  dnsBenchmark: DnsBenchmarkResult[]
  dnsBenchmarking: boolean
  currentDns: CurrentDns
  gamingTimer: GamingTimerStatus | null
  gamingTimerLoading: boolean
  onBenchmarkDns: () => void
  onApplyTcp: () => void
  onRevertTcp: () => void
  onSetDns: (primary: string, secondary?: string) => void
  onSetTimer: (settings: TimerSettings) => void
  onRevertTimer: () => void
  onSetAutoTuning: (action: 'apply' | 'revert') => void
  onOpenExternal: (url: string) => void
}

interface ToolCardProps {
  accent: { color: string; glow: string }
  icon: ReactNode
  title: string
  description: string
  learnMoreLabel: string
  learnMoreUrl: string
  onOpenExternal: (url: string) => void
  testId: string
  children: ReactNode
}

function ToolCard({
  accent,
  icon,
  title,
  description,
  learnMoreLabel,
  learnMoreUrl,
  onOpenExternal,
  testId,
  children,
}: ToolCardProps) {
  return (
    <section
      data-testid={testId}
      className="rounded-2xl p-5"
      style={{ border: '1px solid var(--border-subtle)', background: 'var(--card-bg)' }}
    >
      <header className="mb-4 flex items-start gap-3.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: accent.glow }}
        >
          <span style={{ color: accent.color }}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-zinc-100">{title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{description}</p>
        </div>
        <a
          data-testid="learn-more"
          href={learnMoreUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => {
            e.preventDefault()
            onOpenExternal(learnMoreUrl)
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span>{learnMoreLabel}</span>
        </a>
      </header>
      {children}
    </section>
  )
}

export function AdvancedTools(props: AdvancedToolsProps) {
  const { t } = useTranslation()
  const {
    applying,
    dnsPresets,
    dnsBenchmark,
    dnsBenchmarking,
    currentDns,
    gamingTimer,
    gamingTimerLoading,
    onBenchmarkDns,
    onApplyTcp,
    onRevertTcp,
    onSetDns,
    onSetTimer,
    onRevertTimer,
    onSetAutoTuning,
    onOpenExternal,
  } = props

  const learnMore = t('learnMore', 'Saber mais')
  const ranking = rankDnsPresets(dnsPresets, dnsBenchmark)
  const best = ranking.find((r) => r.isBest)
  const unreachable = dnsBenchmark.filter((r) => !r.ok).length
  const activePreset = dnsPresets.find((p) => p.primary === currentDns.primary)

  return (
    <div className="space-y-4 pb-8" data-testid="advanced-tools">
      <div className="flex items-start gap-3 px-1 pt-8" data-testid="advanced-tools-intro">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" strokeWidth={1.8} />
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            {t('advancedTools', 'Ferramentas avançadas')}
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-zinc-500">
            {t(
              'advancedToolsDescription',
              'Ajustam o comportamento interno da pilha de rede e do timer do Windows. Não são necessárias para o dia a dia: aplique apenas se souber o que está a alterar, e reverta sempre que causarem problemas.',
            )}
          </p>
        </div>
      </div>

      <ToolCard
        testId="section-tcpip"
        accent={ACCENTS.cyan}
        icon={<Zap className="h-[18px] w-[18px]" strokeWidth={1.8} />}
        title={t('tcpIpOptimization', 'Otimização TCP/IP')}
        description={t(
          'tcpIpDescription',
          'Ajusta chimney, timestamps e o tempo de espera inicial (RTO) da pilha TCP. Reduz a latência em uso geral, mas desliga recursos que ajudam ligações em redes instáveis.',
        )}
        learnMoreLabel={learnMore}
        learnMoreUrl={DOCS.tcpip}
        onOpenExternal={onOpenExternal}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="tcp-apply"
            onClick={onApplyTcp}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-cyan-300 transition-colors hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: '1px solid rgba(34,211,238,0.28)' }}
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('applyTcpTweaks', 'Aplicar otimizações')}
          </button>
          <button
            type="button"
            data-testid="tcp-revert"
            onClick={onRevertTcp}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: '1px solid var(--border-strong)' }}
          >
            <ZapOff className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('revertTcpTweaks', 'Reverter para o padrão')}
          </button>
        </div>
      </ToolCard>

      <ToolCard
        testId="section-timer"
        accent={ACCENTS.orange}
        icon={<Timer className="h-[18px] w-[18px]" strokeWidth={1.8} />}
        title={t('timerTweaks', 'Timer e escalonamento')}
        description={t(
          'timerTweaksDescription',
          'Altera a resolução do timer do sistema e o escalonamento de CPU. Só é relevante para jogos competitivos e exige reiniciar o Windows.',
        )}
        learnMoreLabel={learnMore}
        learnMoreUrl={DOCS.timer}
        onOpenExternal={onOpenExternal}
      >
        <div
          data-testid="timer-caution"
          className="mb-4 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
          style={{ background: 'rgba(251,146,60,0.07)', border: '1px solid rgba(251,146,60,0.18)' }}
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" strokeWidth={1.8} />
          <p className="text-[11.5px] leading-relaxed text-orange-200/70">
            {t(
              'timerCaution',
              'A Microsoft documenta HPET, TSC Sync Policy e Dynamic Tick como opções de depuração. Em alguns sistemas pode destabilizar o sistema: se notar travamentos, reverta.',
            )}
          </p>
        </div>

        {gamingTimerLoading ? (
          <div className="flex items-center gap-2 py-6" data-testid="timer-loading">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-600" strokeWidth={1.8} />
            <span className="text-[12.5px] text-zinc-500">{t('loadingTimer', 'A ler o estado do timer…')}</span>
          </div>
        ) : gamingTimer ? (
          <div className="space-y-2.5">
            <div
              className="flex items-center justify-between gap-4 rounded-xl px-4 py-3"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-zinc-200">
                  {t('hpetTitle', 'HPET (High Precision Event Timer)')}
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
                  {t(
                    'hpetDescription',
                    'Desliga o relógio da plataforma para reduzir a latência do timer em CPUs Intel. Pode ajudar também em AMD Ryzen.',
                  )}
                </p>
              </div>
              <Toggle
                testId="toggle-hpet"
                label={t('hpetTitle', 'HPET')}
                checked={gamingTimer.hpetOff}
                onChange={() => onSetTimer({ hpetOff: !gamingTimer.hpetOff })}
              />
            </div>

            <div className="rounded-xl px-4 py-3" style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="text-[13.5px] font-medium text-zinc-200">
                {t('tscSyncTitle', 'Política de sincronização do TSC')}
              </div>
              <p className="mt-0.5 mb-2.5 text-[12px] leading-relaxed text-zinc-500">
                {t(
                  'tscSyncDescription',
                  'Legacy = menor latência de input, menos FPS. Enhanced = mais FPS, mais latência de input.',
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(['default', 'legacy', 'enhanced'] as const).map((policy) => (
                  <button
                    type="button"
                    key={policy}
                    data-testid={`tsc-${policy}`}
                    onClick={() => onSetTimer({ tscSyncPolicy: policy })}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
                      gamingTimer.tscSyncPolicy === policy
                        ? 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40'
                        : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
                    }`}
                  >
                    {policy === 'default'
                      ? t('tscDefault', 'Padrão')
                      : policy === 'legacy'
                        ? t('tscLegacy', 'Legacy (baixa latência)')
                        : t('tscEnhanced', 'Enhanced (mais FPS)')}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="flex items-center justify-between gap-4 rounded-xl px-4 py-3"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-zinc-200">
                  {t('dynamicTickTitle', 'Desligar Dynamic Tick')}
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
                  {t(
                    'dynamicTickDescription',
                    'Impede o Windows de suspender o tick do timer em repouso. Reduz micro-encescamentos.',
                  )}
                </p>
              </div>
              <Toggle
                testId="toggle-dynamic-tick"
                label={t('dynamicTickTitle', 'Dynamic Tick')}
                checked={gamingTimer.dynamicTickDisabled}
                onChange={() => onSetTimer({ dynamicTickDisabled: !gamingTimer.dynamicTickDisabled })}
              />
            </div>

            <div
              className="flex items-center justify-between gap-4 rounded-xl px-4 py-3"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-zinc-200">{t('autoTuningTitle', 'TCP AutoTuning')}</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">
                  {t(
                    'autoTuningDescription',
                    'Reduz bufferbloat e jitter durante o jogo. Recomendado para e-sports; pode abrandar transferências grandes.',
                  )}
                </p>
              </div>
              <Toggle
                testId="toggle-autotuning"
                label={t('autoTuningTitle', 'TCP AutoTuning')}
                checked={gamingTimer.autoTuningDisabled}
                onChange={() => onSetAutoTuning(gamingTimer.autoTuningDisabled ? 'revert' : 'apply')}
              />
            </div>

            <button
              type="button"
              data-testid="timer-revert"
              onClick={onRevertTimer}
              className="w-full rounded-xl px-4 py-2 text-[12.5px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
              style={{ border: '1px solid rgba(248,113,113,0.25)' }}
            >
              {t('revertTimerDefaults', 'Reverter todos os valores do timer')}
            </button>
          </div>
        ) : (
          <p className="text-[12.5px] text-zinc-500">
            {t('timerLoadFailed', 'Não foi possível ler o estado do timer.')}
          </p>
        )}
      </ToolCard>

      {dnsPresets.length > 0 && (
        <ToolCard
          testId="section-dns"
          accent={ACCENTS.cyan}
          icon={<Globe className="h-[18px] w-[18px]" strokeWidth={1.8} />}
          title={t('dnsPresets', 'Servidores DNS')}
          description={t(
            'dnsDescription',
            'O resolvedor responde mais depressa quando resolve um nome mais rápido, o que faz páginas e respostas da API chegarem antes. Teste para descobrir qual é o melhor para a sua ligação.',
          )}
          learnMoreLabel={learnMore}
          learnMoreUrl={DOCS.dns}
          onOpenExternal={onOpenExternal}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="dns-benchmark-button"
              onClick={onBenchmarkDns}
              disabled={dnsBenchmarking}
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12.5px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ border: '1px solid var(--border-strong)' }}
            >
              {dnsBenchmarking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" strokeWidth={1.8} />
              ) : (
                <Zap className="h-3.5 w-3.5 text-cyan-400" strokeWidth={1.8} />
              )}
              {dnsBenchmarking ? t('dnsBenchmarking', 'A medir…') : t('dnsTestSpeed', 'Testar velocidade')}
            </button>
            {best && (
              <button
                type="button"
                data-testid="dns-apply-best"
                onClick={() => onSetDns(best.primary, best.secondary)}
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12.5px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/10"
                style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.28)' }}
              >
                {t('dnsApplyBest', 'Aplicar melhor opção')}
                <span className="text-cyan-400/80">{best.name}</span>
              </button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px] text-zinc-500" data-testid="dns-current">
            <span className="shrink-0 uppercase tracking-wide">{t('dnsCurrentLabel', 'Em uso')}</span>
            {currentDns.primary ? (
              <span className="min-w-0 truncate text-zinc-300" data-testid="dns-current-value">
                {activePreset && <span className="text-zinc-100">{activePreset.name} · </span>}
                {currentDns.primary}
                {currentDns.source === 'dhcp' && (
                  <span className="text-zinc-600"> · {t('dnsViaDhcp', 'via DHCP')}</span>
                )}
              </span>
            ) : (
              <span className="text-zinc-600">{t('dnsCurrentUnknown', 'não detetado')}</span>
            )}
          </div>

          <div
            role="radiogroup"
            aria-label={t('dnsChooseLabel', 'Escolher servidor DNS')}
            className="space-y-1.5"
            data-testid="dns-options"
          >
            {ranking.map((entry) => {
              const isActive = entry.primary === currentDns.primary
              const measured = dnsBenchmark.length > 0
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  key={entry.name}
                  data-testid="dns-result-row"
                  data-preset={entry.name}
                  data-best={String(entry.isBest)}
                  data-active={String(isActive)}
                  data-avg={entry.avgMs ?? ''}
                  onClick={() => onSetDns(entry.primary, entry.secondary)}
                  className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                  style={{
                    border: `1px solid ${
                      entry.isBest
                        ? 'rgba(34,211,238,0.3)'
                        : isActive
                          ? 'rgba(34,211,238,0.22)'
                          : 'var(--border-subtle)'
                    }`,
                    background: entry.isBest
                      ? 'rgba(34,211,238,0.05)'
                      : isActive
                        ? 'rgba(34,211,238,0.03)'
                        : 'transparent',
                  }}
                >
                  <span
                    data-testid={`dns-radio-${entry.name}`}
                    aria-hidden="true"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                    style={{ border: `1px solid ${isActive ? 'rgb(34,211,238)' : 'var(--border-strong)'}` }}
                  >
                    {isActive && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                  </span>
                  <span className="w-5 shrink-0 text-center text-[12px] font-semibold tabular-nums text-zinc-500">
                    {measured && entry.ok ? entry.rank : '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-zinc-200">{entry.name}</span>
                    <span className="block text-[11.5px] text-zinc-600">{entry.primary}</span>
                  </span>
                  {isActive && (
                    <span
                      data-testid="dns-active-badge"
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-zinc-300 uppercase"
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      {t('dnsCurrent', 'Atual')}
                    </span>
                  )}
                  {entry.isBest && (
                    <span
                      data-testid="dns-best-badge"
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-cyan-200 uppercase"
                      style={{ background: 'rgba(34,211,238,0.14)' }}
                    >
                      {t('dnsBest', 'Melhor')}
                    </span>
                  )}
                  <span
                    data-testid={`dns-row-${entry.name}`}
                    className="shrink-0 text-[12px] tabular-nums text-zinc-500"
                  >
                    {!measured
                      ? ''
                      : entry.ok && entry.avgMs !== null
                        ? `${entry.avgMs.toFixed(1)} ms`
                        : t('dnsUnavailable', 'sem resposta')}
                  </span>
                </button>
              )
            })}
          </div>

          {dnsBenchmark.length === 0 && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-zinc-600">
              {t('dnsManualHint', 'Pode usar qualquer uma das opções. Testar apenas ordena a lista pela velocidade.')}
            </p>
          )}

          {unreachable > 0 && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-zinc-600">
              {t(
                'dnsPartialFailure',
                'Alguns servidores não responderam dentro do tempo limite e ficam no fim da lista.',
              )}
            </p>
          )}
        </ToolCard>
      )}
    </div>
  )
}
