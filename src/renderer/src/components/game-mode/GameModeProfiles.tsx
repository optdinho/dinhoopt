import { useGameModeStore } from '@/stores/game-mode-store'
import type { GameModeOptimizationId } from '@shared/types'
import { motion } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { OPTIMIZATIONS } from './constants'

interface GameModeProfilesProps {
  profileGameName: string
  profileProcessName: string
  profileOpts: GameModeOptimizationId[]
  editingProfile: string | null
  onProfileGameNameChange: (v: string) => void
  onProfileProcessNameChange: (v: string) => void
  onProfileOptsChange: (v: GameModeOptimizationId[]) => void
  onStartNewProfile: () => void
  onStartEditProfile: (key: string, gameName: string, processName: string, opts: GameModeOptimizationId[]) => void
  onCancelProfile: () => void
}

export function GameModeProfiles({
  profileGameName,
  profileProcessName,
  profileOpts,
  editingProfile,
  onProfileGameNameChange,
  onProfileProcessNameChange,
  onProfileOptsChange,
  onStartNewProfile,
  onStartEditProfile,
  onCancelProfile,
}: GameModeProfilesProps) {
  const { t } = useTranslation('gameMode')
  const store = useGameModeStore
  const config = useGameModeStore((s) => s.config)
  const gameProfiles = config.gameProfiles ?? {}
  const hasProfiles = Object.keys(gameProfiles).length > 0

  const handleSave = useCallback(() => {
    if (editingProfile === '__new__') {
      if (profileProcessName && profileGameName && profileOpts.length > 0) {
        store
          .getState()
          .setGameProfile(profileProcessName, { gameName: profileGameName, enabledOptimizations: profileOpts })
      }
    } else if (editingProfile) {
      if (profileOpts.length > 0) {
        store
          .getState()
          .setGameProfile(editingProfile, { gameName: profileGameName, enabledOptimizations: profileOpts })
      } else {
        store.getState().setGameProfile(editingProfile, null)
      }
    }
    onCancelProfile()
  }, [editingProfile, profileGameName, profileProcessName, profileOpts, store, onCancelProfile])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl transition-all duration-300"
      style={{ border: '1px solid var(--border-default)', background: 'var(--bg-subtle)' }}
    >
      <div className="flex items-center justify-between px-5 py-3.5">
        <div>
          <span className="text-[14px] font-semibold text-zinc-200">{t('profilesTitle')}</span>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t('profilesDesc')}</p>
        </div>
        {editingProfile === null && (
          <button
            type="button"
            onClick={onStartNewProfile}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
          >
            <Plus className="h-3 w-3" />
            {t('profilesAdd')}
          </button>
        )}
      </div>

      {editingProfile !== null && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="profile-game-name" className="mb-1 block text-[11px] font-medium text-zinc-400">
                {t('profilesGameLabel')}
              </label>
              <input
                id="profile-game-name"
                type="text"
                value={profileGameName}
                onChange={(e) => onProfileGameNameChange(e.target.value)}
                placeholder="CS2"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-emerald-500/30"
              />
            </div>
            <div>
              <label htmlFor="profile-process-name" className="mb-1 block text-[11px] font-medium text-zinc-400">
                {t('profilesProcessLabel')}
              </label>
              <input
                id="profile-process-name"
                type="text"
                value={profileProcessName}
                onChange={(e) => onProfileProcessNameChange(e.target.value)}
                placeholder="cs2.exe"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-emerald-500/30"
              />
            </div>
          </div>
          <div className="mb-3">
            <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">{t('profilesOptsLabel')}</span>
            <div className="flex flex-wrap gap-2">
              {OPTIMIZATIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors"
                  style={{
                    background: profileOpts.includes(opt.id) ? 'rgba(34,197,94,0.12)' : 'var(--bg-subtle-2)',
                    color: profileOpts.includes(opt.id) ? '#22c55e' : 'var(--text-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={profileOpts.includes(opt.id)}
                    onChange={() => {
                      onProfileOptsChange(
                        profileOpts.includes(opt.id)
                          ? profileOpts.filter((o) => o !== opt.id)
                          : [...profileOpts, opt.id],
                      )
                    }}
                    className="sr-only"
                  />
                  <span>{t(opt.labelKey)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
              style={{ background: '#22c55e' }}
            >
              {t('profilesSave')}
            </button>
            <button
              type="button"
              onClick={onCancelProfile}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('profilesCancel')}
            </button>
          </div>
        </div>
      )}

      {!editingProfile && hasProfiles && (
        <div className="border-t border-white/[0.06]">
          {Object.entries(gameProfiles).map(([key, profile]) => (
            <div
              key={key}
              className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-white/[0.02]"
            >
              <div>
                <span className="text-[13px] font-medium text-zinc-300">{profile.gameName}</span>
                <p className="mt-0.5 text-[10px] text-zinc-500">{key}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                >
                  {profile.enabledOptimizations.length}
                </span>
                <button
                  type="button"
                  onClick={() => onStartEditProfile(key, profile.gameName, key, [...profile.enabledOptimizations])}
                  className="rounded px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  {t('profilesEdit')}
                </button>
                <button
                  type="button"
                  onClick={() => store.getState().setGameProfile(key, null)}
                  className="rounded px-2 py-1 text-[11px] text-red-400 transition-colors hover:text-red-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!editingProfile && !hasProfiles && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="text-[11px] text-zinc-600">{t('profilesEmpty')}</p>
        </div>
      )}
    </motion.div>
  )
}
