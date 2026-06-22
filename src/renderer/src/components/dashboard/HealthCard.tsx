import { HealthScore } from '@/components/shared/HealthScore'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toolRoutes } from './constants'
import type { ToolCoverageItem } from './types'

export function HealthCard({
  healthScore,
  toolCoverage,
}: {
  healthScore: number
  toolCoverage: ToolCoverageItem[]
}) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  return (
    <div
      className="glass-card depth-emphasis flex flex-col items-center justify-center rounded-2xl px-4 py-5 sm:px-6 sm:py-6 animate-fade-in"
      style={{
        borderLeft: '2px solid var(--accent)',
        boxShadow: '0 0 24px rgba(139,92,246,0.04), 0 2px 8px rgba(0,0,0,0.12), inset 0 1px 0 var(--glass-inset)',
      }}
    >
      <HealthScore score={healthScore} size="md" />
      <div className="mt-4 flex flex-wrap justify-center items-center gap-1.5 sm:gap-2">
        {toolCoverage.map((tool, i) => {
          const Icon = tool.icon
          const route = toolRoutes[tool.key]
          return (
            <div
              key={tool.key}
              className="relative flex h-7 w-7 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-lg transition-all duration-200 hover:brightness-110 hover:scale-110"
              style={{
                animation: `fade-in 0.3s ease-out ${0.2 + i * 0.05}s both`,
                background: tool.usedRecently ? `${tool.color}18` : 'var(--bg-subtle)',
                border: `1px solid ${tool.usedRecently ? `${tool.color}30` : 'var(--border-subtle)'}`,
              }}
              title={`${tool.label}: ${tool.usedRecently ? t('toolTipUsedRecently') : tool.usedEver ? t('toolTipNotUsedRecently') : t('toolTipNeverUsed')}`}
              onClick={() => route && navigate(route)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && route) {
                  e.preventDefault()
                  navigate(route)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <Icon
                className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                style={{ color: tool.usedRecently ? tool.color : 'var(--text-faint)' }}
                strokeWidth={1.8}
              />
              {tool.usedRecently && (
                <div
                  className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full"
                  style={{ background: '#22c55e' }}
                >
                  <Check className="h-2 w-2 text-white" strokeWidth={3} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
