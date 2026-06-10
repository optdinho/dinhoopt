import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Cpu,
  MemoryStick,
  Wifi,
  Timer,
  Thermometer,
  Zap,
  Star,
  Gauge,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useBenchmarkStore } from '@/stores/benchmark-store'
import type { BenchmarkScoreClass } from '@shared/types'

const SCORE_COLORS: Record<BenchmarkScoreClass, string> = {
  S: '#00FF87',
  A: '#00D4FF',
  B: '#7B2FFF',
  C: '#FFB800',
  D: '#FF3B5C',
}

const SCORE_GLOWS: Record<BenchmarkScoreClass, string> = {
  S: 'rgba(0,255,135,0.2)',
  A: 'rgba(0,212,255,0.2)',
  B: 'rgba(123,47,255,0.2)',
  C: 'rgba(255,184,0,0.2)',
  D: 'rgba(255,59,92,0.2)',
}

function ScoreRing({ score, scoreClass }: { score: number; scoreClass: BenchmarkScoreClass }) {
  const radius = 80
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = SCORE_COLORS[scoreClass]

  return (
    <div className="relative flex items-center justify-center">
      <svg width="200" height="200" className="transform -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        <motion.circle
          cx="100" cy="100" r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 10px ${SCORE_GLOWS[scoreClass]})` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className="text-5xl font-bold"
          style={{ color }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
        >
          {score}
        </motion.span>
        <motion.span
          className="text-2xl font-bold"
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          {scoreClass}
        </motion.span>
      </div>
    </div>
  )
}

const STEPS_LABELS = [
  'Inicializando sensores...',
  'Medindo CPU (baseline)',
  'Medindo RAM disponível',
  'Medindo latência de rede',
  'Medindo latência DPC',
  'Medindo temperaturas',
  'Verificando tweaks aplicados',
  'Verificando plano de energia',
  'Calculando score competitivo',
  'Gerando recomendações',
]

export function BenchmarkPage() {
  const status = useBenchmarkStore((s) => s.status)
  const progress = useBenchmarkStore((s) => s.progress)
  const result = useBenchmarkStore((s) => s.result)
  const run = useBenchmarkStore((s) => s.run)
  const cancel = useBenchmarkStore((s) => s.cancel)
  const reset = useBenchmarkStore((s) => s.reset)

  const metricCards = result ? [
    { icon: Cpu, label: 'CPU', score: result.details.cpu.score, max: 20, detail: result.details.cpu.detail, color: '#06b6d4' },
    { icon: MemoryStick, label: 'RAM', score: result.details.ram.score, max: 20, detail: result.details.ram.detail, color: '#22c55e' },
    { icon: Wifi, label: 'Rede', score: result.details.network.score, max: 15, detail: result.details.network.detail, color: '#ec4899' },
    { icon: Timer, label: 'DPC', score: result.details.latencyDpc.score, max: 25, detail: result.details.latencyDpc.detail, color: '#8b5cf6' },
    { icon: Thermometer, label: 'Temperatura', score: result.details.temperature.score, max: 20, detail: result.details.temperature.detail, color: '#f59e0b' },
    { icon: Star, label: 'Bônus Tweaks', score: result.details.tweakBonus.score, max: 10, detail: `${result.details.tweakBonus.applied}/${result.details.tweakBonus.total} tweaks`, color: '#14b8a6' },
    { icon: Zap, label: 'Plano de Energia', score: result.details.powerBonus.score, max: 5, detail: result.details.powerBonus.plan, color: '#eab308' },
  ] : []

  return (
    <div className="p-6">
      <PageHeader
        title="Benchmark Competitivo"
        description="Avalie o desempenho do seu sistema para jogos"
      />

      <div className="mt-6 flex flex-col items-center gap-8">
        {/* Score ring */}
        <div className="relative">
          {status === 'done' && result && (
            <ScoreRing score={result.score} scoreClass={result.scoreClass} />
          )}
          {status === 'idle' && !result && (
            <div className="flex h-[200px] w-[200px] items-center justify-center rounded-full border-2 border-dashed border-zinc-700">
              <Gauge className="h-12 w-12 text-zinc-600" />
            </div>
          )}
          {status === 'running' && (
            <div className="flex h-[200px] w-[200px] items-center justify-center">
              <motion.div
                className="h-16 w-16 rounded-full border-4 border-zinc-700 border-t-cyan-400"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            </div>
          )}
        </div>

        {/* Progress steps */}
        {status === 'running' && progress && (
          <div className="w-full max-w-md space-y-2">
            {STEPS_LABELS.map((label, i) => {
              const isActive = i === progress.step
              const isDone = i < progress.step
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg px-4 py-2 text-sm transition-all ${
                    isActive ? 'bg-cyan-900/10 text-cyan-300' : isDone ? 'text-zinc-500' : 'text-zinc-700'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  ) : isActive ? (
                    <motion.div
                      className="h-4 w-4 shrink-0 rounded-full border-2 border-cyan-400"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  ) : (
                    <div className="h-4 w-4 shrink-0 rounded-full border-2 border-zinc-700" />
                  )}
                  <span>{isActive ? progress.detail : label}</span>
                </div>
              )
            })}
            <div className="mt-4 flex justify-center">
              <button
                onClick={cancel}
                className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-400 hover:bg-red-900/10"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {status === 'done' && result && (
          <motion.div
            className="w-full max-w-2xl space-y-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {/* Metric cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {metricCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border p-4"
                  style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <card.icon className="h-4 w-4" style={{ color: card.color }} />
                    <span className="text-xs font-medium text-zinc-400">{card.label}</span>
                  </div>
                  <div className="text-lg font-bold text-white">{card.score}/{card.max}</div>
                  <div className="mt-1 text-[10px] text-zinc-600">{card.detail}</div>
                  <div className="mt-2 h-1 rounded-full bg-zinc-800">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: card.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(card.score / card.max) * 100}%` }}
                      transition={{ duration: 1, delay: 0.5 }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Score total bar */}
            <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-300">Score Total</span>
                <span className="text-lg font-bold" style={{ color: SCORE_COLORS[result.scoreClass] }}>
                  {result.score}/100
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-800">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${SCORE_COLORS[result.scoreClass]}, ${SCORE_COLORS[result.scoreClass]}88)`,
                    boxShadow: `0 0 12px ${SCORE_GLOWS[result.scoreClass]}`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${result.score}%` }}
                  transition={{ duration: 1.5, delay: 0.8, ease: 'easeOut' }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-600">
                <span>D</span><span>C</span><span>B</span><span>A</span><span>S</span>
              </div>
            </div>

            {/* Refresh button */}
            <div className="flex justify-center">
              <button
                onClick={reset}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white"
              >
                <RefreshCw className="h-4 w-4" />
                Executar novamente
              </button>
            </div>
          </motion.div>
        )}

        {/* Start button */}
        {status === 'idle' && !result && (
          <motion.button
            onClick={run}
            className="rounded-xl px-8 py-4 text-lg font-bold text-white transition-all hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #00D4FF, #7B2FFF)',
              boxShadow: '0 0 30px rgba(0,212,255,0.2), 0 0 60px rgba(123,47,255,0.1)',
            }}
            whileHover={{ boxShadow: '0 0 40px rgba(0,212,255,0.3), 0 0 80px rgba(123,47,255,0.15)' }}
            whileTap={{ scale: 0.98 }}
          >
            INICIAR BENCHMARK
          </motion.button>
        )}

        {/* Classification legend */}
        {status === 'idle' && !result && (
          <div className="grid grid-cols-5 gap-3 text-center text-xs">
            {(['S', 'A', 'B', 'C', 'D'] as BenchmarkScoreClass[]).map((cls) => (
              <div key={cls} className="rounded-lg border border-zinc-800 p-3">
                <div className="text-lg font-bold" style={{ color: SCORE_COLORS[cls] }}>{cls}</div>
                <div className="text-zinc-600">
                  {cls === 'S' ? '≥ 90' : cls === 'A' ? '≥ 80' : cls === 'B' ? '≥ 70' : cls === 'C' ? '≥ 50' : '< 50'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
