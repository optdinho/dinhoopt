// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B5 — a barra de progresso do Modo de Jogo mostrava o ID CRU da optimizacao
 * (`activate.ts:68` envia `currentLabel: id`, ex.: `svc-diagtrack`) e a pagina
 * imprimia-o tal e qual (`GameModePage.tsx:287`). As chaves
 * `applyingOptimization` / `restoringOptimization` existiam nos 3 locales e
 * nunca eram usadas.
 *
 * A barreira exige o texto humano: `t('applyingOptimization', { label })` com o
 * rotulo da optimizacao resolvido pelo mapa ja' existente em `constants.ts`
 * (`OPTIMIZATIONS[].labelKey`), nunca o id nem a chave do rotulo.
 */
vi.mock('react-i18next', () => {
  const t = (key: string, opts?: { label?: string }) => (opts?.label !== undefined ? `${key}::${opts.label}` : key)
  return { useTranslation: () => ({ t }) }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }))
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => null }))
vi.mock('@/lib/renderer-logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/game-mode/GameModeAudit', () => ({ GameModeAudit: () => null }))
vi.mock('@/components/game-mode/GameModeCategoryCard', () => ({ GameModeCategoryCard: () => null }))
vi.mock('@/components/game-mode/GameModeDirectStorage', () => ({ GameModeDirectStorage: () => null }))
vi.mock('@/components/game-mode/GameModeGpuTweaks', () => ({ GameModeGpuTweaks: () => null }))
vi.mock('@/components/game-mode/GameModeHero', () => ({ GameModeHero: () => null }))
vi.mock('@/components/game-mode/GameModeProfiles', () => ({ GameModeProfiles: () => null }))
// O C4 exercita o toggle real da captura automatica (o unico caminho que
// persiste via `clipsSetConfig`), por isso este componente NAO e' mockado.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: unknown }) => <>{children as never}</>,
  motion: { div: ({ children }: { children?: unknown }) => <div>{children as never}</div> },
}))

import { toast } from 'sonner'
import { useGameModeStore } from '@/stores/game-mode-store'
import { GameModePage } from './GameModePage'

beforeEach(() => {
  vi.clearAllMocks()
  useGameModeStore.getState().setProgress(null)
  useGameModeStore.getState().setStatus('idle')
})

describe('GameModePage progress label (B5)', () => {
  it('shows the readable optimization label, never the raw id', () => {
    useGameModeStore.getState().setStatus('activating')
    useGameModeStore.getState().setProgress({
      phase: 'activating',
      current: 3,
      total: 20,
      currentLabel: 'svc-diagtrack',
    })

    const { container } = render(<GameModePage />)
    const text = container.textContent ?? ''

    expect(text).not.toContain('svc-diagtrack')
    // O rotulo humano de `svc-diagtrack` e' a chave `optSvcDiagtrack`.
    expect(text).toContain('optSvcDiagtrack')
    // E o texto esta' envolvido na chave de progresso que estava morta.
    expect(text).toContain('applyingOptimization')
  })

  it('uses the restoring string while deactivating', () => {
    useGameModeStore.getState().setStatus('deactivating')
    useGameModeStore.getState().setProgress({
      phase: 'deactivating',
      current: 1,
      total: 5,
      currentLabel: 'net-disable-nagle',
    })

    const { container } = render(<GameModePage />)
    const text = container.textContent ?? ''

    expect(text).not.toContain('net-disable-nagle')
    expect(text).toContain('optNetNagle')
    expect(text).toContain('restoringOptimization')
  })

  it('falls back to the raw label when the id is unknown (never blank)', () => {
    useGameModeStore.getState().setStatus('activating')
    useGameModeStore.getState().setProgress({
      phase: 'activating',
      current: 1,
      total: 1,
      currentLabel: 'custom-thing',
    })

    const { container } = render(<GameModePage />)
    const text = container.textContent ?? ''
    expect(text).toContain('custom-thing')
  })
})

describe('GameModePage auto-start capture toggle (C4)', () => {
  function findCaptureToggle(container: HTMLElement): HTMLElement {
    const label = [...container.querySelectorAll('span')].find((s) => s.textContent === 'autoStartCapture')
    if (!label) throw new Error('auto-start capture row not found')
    // Sobe ate' a linha que contem o botao do toggle.
    let node: HTMLElement | null = label.parentElement
    while (node && !node.querySelector('button')) node = node.parentElement
    const button = node?.querySelector('button')
    if (!button) throw new Error('capture toggle not found')
    return button as HTMLElement
  }

  function enableAutoDetect() {
    useGameModeStore.getState().setAutoDetect(true)
    // A pagina le a config da store, mas o toggle hidrata de `clipsGetConfig`.
    ;(window as unknown as { dinho: unknown }).dinho = {
      clipsGetConfig: vi.fn().mockResolvedValue({ autoStartCapture: false }),
      clipsSetConfig: vi.fn(),
    }
  }

  it('reverts the optimistic toggle and warns when the save is rejected', async () => {
    enableAutoDetect()
    const setConfig = vi.fn().mockResolvedValue({ success: false })
    ;((window as unknown as { dinho: { clipsSetConfig: unknown } }).dinho.clipsSetConfig as unknown) = setConfig

    const { container } = render(<GameModePage />)
    // O toggle da captura automatica e' o botao da linha do seu rotulo.
    const captureToggle = findCaptureToggle(container)

    fireEvent.click(captureToggle)
    await waitFor(() => expect(setConfig).toHaveBeenCalledExactlyOnceWith({ autoStartCapture: true }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('toastCaptureToggleFailed'))
  })

  it('does not warn when the save succeeds', async () => {
    enableAutoDetect()
    ;((window as unknown as { dinho: { clipsSetConfig: unknown } }).dinho.clipsSetConfig as unknown) = vi
      .fn()
      .mockResolvedValue({ success: true })

    const { container } = render(<GameModePage />)
    fireEvent.click(findCaptureToggle(container))
    await waitFor(() => expect(toast.error).not.toHaveBeenCalled())
  })
})
