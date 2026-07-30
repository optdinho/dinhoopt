import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheckBig } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { DURATION } from '@/lib/animation'
import { formatBytes, formatNumber } from '@/lib/utils'
import type { OneClickResult } from './types'

export function ResultBanner({ result }: { result: OneClickResult | null }) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()

  return (
    <AnimatePresence onExitComplete={() => {}}>
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: 'tween', ease: 'easeOut', duration: DURATION.slow }}
          className="glass-card depth-emphasis rounded-2xl p-4"
          style={{
            background: 'linear-gradient(135deg, rgba(34,197,94,0.06) 0%, rgba(34,197,94,0.02) 100%)',
            borderColor: 'rgba(34,197,94,0.12)',
            boxShadow: '0 0 24px rgba(34,197,94,0.06)',
          }}
        >
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: DURATION.normal }}
          >
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'tween', duration: DURATION.normal, delay: 0.1 }}
              className="shrink-0"
            >
              <CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />
            </motion.div>
            <div>
              <p className="text-sm font-medium text-zinc-200">{t('resultCleanupComplete')}</p>
              <StaggerContainer className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                {result.spaceRecovered > 0 && (
                  <StaggerItem key="space">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t('resultSpaceRecovered', { size: formatBytes(result.spaceRecovered) })}
                    </p>
                  </StaggerItem>
                )}
                {result.filesCleaned > 0 && (
                  <StaggerItem key="files">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t('resultFilesCleaned', { count: formatNumber(result.filesCleaned) })}
                    </p>
                  </StaggerItem>
                )}
                {result.registryFixed > 0 && (
                  <StaggerItem key="registry">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t('resultRegistryFixed', { count: result.registryFixed })}
                    </p>
                  </StaggerItem>
                )}
                {result.driversRemoved > 0 && (
                  <StaggerItem key="drivers">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t('resultDriversRemoved', { count: result.driversRemoved })}
                    </p>
                  </StaggerItem>
                )}
                {result.threatsFound > 0 &&
                  (result.threatsQuarantined > 0 ? (
                    <StaggerItem key="threats">
                      <button
                        type="button"
                        onClick={() => navigate('/malware', { state: { tab: 'quarantine' } })}
                        className="text-[12px] hover:underline transition-all hover:translate-x-0.5"
                        style={{ color: '#22c55e' }}
                      >
                        {t(
                          result.threatsQuarantined !== 1
                            ? 'resultThreatsQuarantinedPlural'
                            : 'resultThreatsQuarantined',
                          {
                            count: result.threatsQuarantined,
                          },
                        )}{' '}
                        &rarr;
                      </button>
                    </StaggerItem>
                  ) : (
                    <StaggerItem key="threats">
                      <p className="text-[12px]" style={{ color: '#ef4444' }}>
                        {t(
                          result.threatsQuarantined !== 1
                            ? 'resultThreatsQuarantinedPlural'
                            : 'resultThreatsQuarantined',
                          {
                            count: result.threatsQuarantined,
                          },
                        )}
                      </p>
                    </StaggerItem>
                  ))}
                {result.threatsFound === 0 && result.privacyScore > 0 && (
                  <StaggerItem key="no-threats">
                    <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      {t('resultNoThreatsFound')}
                    </p>
                  </StaggerItem>
                )}
                {result.privacyIssues > 0 && (
                  <StaggerItem key="privacy">
                    <button
                      type="button"
                      onClick={() => navigate('/privacy')}
                      className="text-[12px] hover:underline transition-all hover:translate-x-0.5"
                      style={{ color: '#3b82f6' }}
                    >
                      {t(result.privacyIssues !== 1 ? 'resultPrivacyImprovementsPlural' : 'resultPrivacyImprovements', {
                        count: result.privacyIssues,
                      })}{' '}
                      &rarr;
                    </button>
                  </StaggerItem>
                )}
                {result.startupHighImpact > 0 && (
                  <StaggerItem key="startup">
                    <button
                      type="button"
                      onClick={() => navigate('/startup')}
                      className="text-[12px] hover:underline transition-all hover:translate-x-0.5"
                      style={{ color: '#3b82f6' }}
                    >
                      {t(result.startupHighImpact !== 1 ? 'resultStartupHighImpactPlural' : 'resultStartupHighImpact', {
                        count: result.startupHighImpact,
                      })}{' '}
                      &rarr;
                    </button>
                  </StaggerItem>
                )}
                {result.updatesAvailable > 0 && (
                  <StaggerItem key="updates">
                    <button
                      type="button"
                      onClick={() => navigate('/updates')}
                      className="text-[12px] hover:underline transition-all hover:translate-x-0.5"
                      style={{ color: '#3b82f6' }}
                    >
                      {t(result.updatesAvailable !== 1 ? 'resultSoftwareUpdatesPlural' : 'resultSoftwareUpdates', {
                        count: result.updatesAvailable,
                      })}{' '}
                      &rarr;
                    </button>
                  </StaggerItem>
                )}
                {result.networkCleaned > 0 && (
                  <StaggerItem key="network">
                    <button
                      type="button"
                      onClick={() => navigate('/network')}
                      className="text-[12px] hover:underline transition-all hover:translate-x-0.5"
                      style={{ color: '#3b82f6' }}
                    >
                      {t('resultNetworkCleaned', { count: result.networkCleaned })} &rarr;
                    </button>
                  </StaggerItem>
                )}
                {result.vulnerabilitiesFound > 0 && (
                  <StaggerItem key="vuln">
                    <button
                      type="button"
                      onClick={() => navigate('/vulnerability')}
                      className="text-[12px] hover:underline transition-all hover:translate-x-0.5"
                      style={{ color: result.vulnerabilitiesFound > 5 ? '#ef4444' : '#f59e0b' }}
                    >
                      {t(result.vulnerabilitiesFound !== 1 ? 'resultVulnerabilitiesPlural' : 'resultVulnerabilities', {
                        count: result.vulnerabilitiesFound,
                      })}{' '}
                      &rarr;
                    </button>
                  </StaggerItem>
                )}
                {result.memoryFreed > 0 && (
                  <StaggerItem key="memory">
                    <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      {t('resultMemoryFreed', { size: formatBytes(result.memoryFreed) })}
                    </p>
                  </StaggerItem>
                )}
                {result.spaceRecovered === 0 &&
                  result.filesCleaned === 0 &&
                  result.registryFixed === 0 &&
                  result.driversRemoved === 0 &&
                  result.threatsFound === 0 &&
                  result.privacyIssues === 0 &&
                  result.startupHighImpact === 0 &&
                  result.updatesAvailable === 0 &&
                  result.networkCleaned === 0 &&
                  result.vulnerabilitiesFound === 0 &&
                  result.memoryFreed === 0 && (
                    <StaggerItem key="clean">
                      <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('resultSystemAlreadyClean')}
                      </p>
                    </StaggerItem>
                  )}
              </StaggerContainer>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
